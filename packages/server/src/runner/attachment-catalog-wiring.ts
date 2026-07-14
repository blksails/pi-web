/**
 * agent-attachment-catalog · runner 子进程分发桥 `wireAttachmentCatalogBridge`
 * (spec agent-attachment-catalog,任务 2.1/2.2/2.3)。
 *
 * 与 `wireAgentRoutesBridge`/`wireAttachmentProfile` 同族的三段先例复制:
 *
 *  1. **装配期声明帧**:声明存在时,经 stdout 写一条 `{"type":"agent_attachment_catalog",
 *     available:true}` JSONL 帧(纯投影,handler 函数不过进程边界)。未声明 → 零帧零读取器,
 *     存量 source 零行为变化(Req 1.2)。调用点在 `runRpcMode` **之前**。
 *  2. **第二 stdin reader**:只消费 `piweb_attachment_catalog_request` 帧,其余行放行不干预。
 *     `op:"list"` 派发到 `catalog.list(query)`;`op:"materialize"` 派发到本模块的物化通路
 *     (幂等/串行化/落库,见下)。handler 抛错 / 结果不可序列化 → 类型化错误结果帧,**永不抛出**
 *     到 runner 主流程(不崩会话,Req 6.1/6.2)。
 *  3. **fd1 直写回流**:结果帧单次原子 `fs.writeSync(1)`(runRpcMode 接管 stdout 后必须绕行)。
 *
 * ## 物化通路(materialize,Req 3.1-3.3/3.5/5.3)
 *
 * - **in-flight 串行化**:同一 `entryId` 并发 materialize 请求复用同一 in-flight `Promise`,
 *   不重复调用 `resolve`/落库(design.md §行为规约)。
 * - **幂等锚与 version 判定**:请求帧只携带 `entryId`(不携带 `version`)——本模块以最近一次
 *   `list()` 响应中该 `entryId` 对应的 `version` 作为「当前应产出的内容版本」(`lastKnownVersion`
 *   映射,由每次 list 派发的结果回填);从未被 list 过的 `entryId` 视为 `version:undefined`
 *   (即「无版本 = 恒同内容」,design.md §幂等持久化依据的既定语义)。
 *   幂等键 = `entryId + version`;内存映射命中直接复用;miss 则扫 `store.listBySession` +
 *   `getMeta` 匹配 `{catalogEntry:{entryId,version}}` 命中复用(子进程热重载后内存映射清空
 *   但落盘 meta 仍在,由此兜底,Req 3.3);双重 miss 才真正调用 `catalog.resolve` 落库。
 * - **落库**:`resolve` 取字节 → `store.put(origin:"tool-output")`(继承拓扑/profile 写路由,
 *   Req 3.5)→ `store.setMeta({catalogEntry:{entryId,version}})` 固化幂等锚。
 * - **错误分类(设计取舍,design.md 未逐字规定,此处显式决策)**:`resolve` 抛错时,若该
 *   `entryId` **从未经 list 枚举过**(`lastKnownVersion` 无记录)→ 判定 `ENTRY_NOT_FOUND`
 *   (没有任何依据认为这是一个有效条目);若曾被枚举过 → 判定 `CATALOG_ERROR`(内容曾存在,
 *   本次取失败视为处理器侧错误,如临时性故障)。`store` 不可用(附件能力未配置)统一判
 *   `CATALOG_ERROR`。
 *
 * 优雅降级(对齐 `wireAgentRoutesBridge`):挂载失败 → 记诊断、能力降级、**不抛**。
 */
import { writeSync } from "node:fs";
import {
  AttachmentCatalogRequestFrameSchema,
  type AgentAttachmentCatalogFrame,
  type AttachmentCatalogRequestFrame,
  type AttachmentCatalogResultFrame,
  type CatalogEntryDto,
} from "@blksails/pi-web-protocol";
import { JsonlLineReader } from "../rpc-channel/jsonl-reader.js";
import type { AgentAttachmentCatalogDecl } from "./agent-definition.js";
import type { ChildAttachmentStore } from "../attachment-bridge/child-store.js";

/** data 监听器签名(agent-routes-wiring 同构)。 */
type DataListener = (chunk: string | Buffer) => void;
type ListenerOp = (event: "data", listener: DataListener) => unknown;

/** 可读流的最小视图(便于测试注入)。 */
interface ReadableLike {
  on(event: "data", listener: DataListener): unknown;
  off?: ListenerOp;
  removeListener?: ListenerOp;
  setEncoding?(encoding: string): unknown;
}

/** 可写流的最小视图。 */
interface WritableLike {
  write(s: string): unknown;
}

export interface WireAttachmentCatalogBridgeInput {
  /** 当前会话 id(落库属主 + 诊断维度)。 */
  readonly sessionId: string;
  /** 归一化的目录声明(list/resolve handler;无声明为 undefined)。 */
  readonly catalog?: AgentAttachmentCatalogDecl;
  /** 子进程 store 客户端(env 缺失时为 undefined,materialize 时能力降级)。 */
  readonly store?: ChildAttachmentStore;
  /** 请求帧入口(默认 process.stdin)。 */
  readonly stdin?: ReadableLike;
  /** 帧出口(默认:声明帧走装配窗口 stdout,结果帧直写 fd1)。注入后二者都经此捕获(单测接缝)。 */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface AttachmentCatalogBridgeWiring {
  /** stdin 请求读取器是否挂上(无声明恒 false)。 */
  readonly installed: boolean;
  /** 卸载 stdin 读取器(幂等)。 */
  cleanup(): void;
}

/** 归一化错误:code + message(与 agent-routes 结果帧的 error 形状一致)。 */
class CatalogMaterializeError extends Error {
  constructor(
    public readonly code: "ENTRY_NOT_FOUND" | "CATALOG_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "CatalogMaterializeError";
  }
}

/** materialize 通路的进程内可变状态(每个桥实例一份,不跨会话共享)。 */
interface MaterializeState {
  /** entryId → 在途 Promise(并发串行化)。 */
  readonly inFlight: Map<string, Promise<string>>;
  /** `${entryId}::${version ?? ""}` → attachmentId(内存幂等映射)。 */
  readonly memoryIdempotent: Map<string, string>;
  /** entryId → 最近一次 list() 回填的 version(未被 list 过则无记录)。 */
  readonly lastKnownVersion: Map<string, string | undefined>;
}

function idemKey(entryId: string, version: string | undefined): string {
  return `${entryId}::${version ?? ""}`;
}

/** 按 entryId 扫 `listBySession` + `getMeta`,匹配 `{catalogEntry:{entryId,version}}`。 */
async function scanMetaForIdempotentMatch(
  store: ChildAttachmentStore,
  sessionId: string,
  entryId: string,
  version: string | undefined,
): Promise<string | undefined> {
  const attachments = await store.listBySession(sessionId);
  for (const att of attachments) {
    const meta = await store.getMeta(att.id);
    const catalogEntry = (meta as { catalogEntry?: { entryId?: unknown; version?: unknown } } | undefined)
      ?.catalogEntry;
    if (
      catalogEntry !== undefined &&
      catalogEntry.entryId === entryId &&
      catalogEntry.version === version
    ) {
      return att.id;
    }
  }
  return undefined;
}

/** 单次 materialize 的实际工作(不含 in-flight 复用包装)。 */
async function doMaterialize(
  entryId: string,
  state: MaterializeState,
  catalog: AgentAttachmentCatalogDecl,
  store: ChildAttachmentStore | undefined,
  sessionId: string,
): Promise<string> {
  const version = state.lastKnownVersion.get(entryId);
  const key = idemKey(entryId, version);

  const memHit = state.memoryIdempotent.get(key);
  if (memHit !== undefined) return memHit;

  if (store === undefined) {
    throw new CatalogMaterializeError(
      "CATALOG_ERROR",
      "attachment capability unavailable: store not configured",
    );
  }

  const metaHit = await scanMetaForIdempotentMatch(store, sessionId, entryId, version);
  if (metaHit !== undefined) {
    state.memoryIdempotent.set(key, metaHit);
    return metaHit;
  }

  const everListed = state.lastKnownVersion.has(entryId);
  let resolved: { bytes: Uint8Array; name: string; mimeType: string };
  try {
    resolved = await catalog.resolve(entryId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CatalogMaterializeError(everListed ? "CATALOG_ERROR" : "ENTRY_NOT_FOUND", message);
  }

  let attachmentId: string;
  try {
    const att = await store.put({
      bytes: resolved.bytes,
      name: resolved.name,
      mimeType: resolved.mimeType,
      size: resolved.bytes.length,
      sessionId,
      origin: "tool-output",
    });
    attachmentId = att.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CatalogMaterializeError("CATALOG_ERROR", message);
  }

  try {
    await store.setMeta(attachmentId, {
      catalogEntry: { entryId, ...(version !== undefined ? { version } : {}) },
    });
  } catch {
    // 幂等锚写入失败不撤销已落库的附件(附件本身有效可用);仅意味着下次重复 materialize
    // 可能不会命中该锚,退化为再落一份(功能上无害,只是不复用)。不阻断本次成功。
  }

  state.memoryIdempotent.set(key, attachmentId);
  return attachmentId;
}

/** in-flight 串行化包装:同一 entryId 并发请求复用同一 Promise。 */
function materializeEntry(
  entryId: string,
  state: MaterializeState,
  catalog: AgentAttachmentCatalogDecl,
  store: ChildAttachmentStore | undefined,
  sessionId: string,
): Promise<string> {
  const existing = state.inFlight.get(entryId);
  if (existing !== undefined) return existing;
  const promise = doMaterialize(entryId, state, catalog, store, sessionId).finally(() => {
    state.inFlight.delete(entryId);
  });
  state.inFlight.set(entryId, promise);
  return promise;
}

function toEntryDto(entry: {
  id: string;
  name: string;
  description?: string;
  mimeType?: string;
  sizeHint?: number;
  version?: string;
}): CatalogEntryDto {
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.mimeType !== undefined ? { mimeType: entry.mimeType } : {}),
    ...(entry.sizeHint !== undefined ? { sizeHint: entry.sizeHint } : {}),
    ...(entry.version !== undefined ? { version: entry.version } : {}),
  };
}

/**
 * 装配附件目录分发桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**调用。
 * 无声明(undefined)→ 零帧、零读取器、`installed:false`(存量 source 零行为变化)。
 */
export function wireAttachmentCatalogBridge(
  input: WireAttachmentCatalogBridgeInput,
): AttachmentCatalogBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const catalog = input.catalog;

  if (catalog === undefined) {
    return { installed: false, cleanup() {} };
  }

  const writeDeclarationLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          process.stdout.write(s);
        };

  const writeResultLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          writeSync(1, s);
        };

  try {
    const frame: AgentAttachmentCatalogFrame = {
      type: "agent_attachment_catalog",
      available: true,
    };
    writeDeclarationLine(JSON.stringify(frame) + "\n");
  } catch (err) {
    stderr.write(`runner: attachment-catalog bridge declaration-frame error: ${String(err)}\n`);
  }

  const state: MaterializeState = {
    inFlight: new Map(),
    memoryIdempotent: new Map(),
    lastKnownVersion: new Map(),
  };

  const emitResult = (result: AttachmentCatalogResultFrame): void => {
    let line: string;
    try {
      line = JSON.stringify(result) + "\n";
    } catch (err) {
      const fallback: AttachmentCatalogResultFrame = {
        type: "piweb_attachment_catalog_result",
        id: result.id,
        ok: false,
        error: {
          code: "CATALOG_ERROR",
          message: `catalog result is not JSON-serializable: ${String(err)}`,
        },
      };
      line = JSON.stringify(fallback) + "\n";
    }
    try {
      writeResultLine(line);
    } catch (err) {
      stderr.write(`runner: attachment-catalog bridge result-line error: ${String(err)}\n`);
    }
  };

  const handleRequest = async (frame: AttachmentCatalogRequestFrame): Promise<void> => {
    if (frame.op === "list") {
      try {
        const entries = await catalog.list(frame.query);
        for (const entry of entries) {
          state.lastKnownVersion.set(entry.id, entry.version);
        }
        emitResult({
          type: "piweb_attachment_catalog_result",
          id: frame.id,
          ok: true,
          entries: entries.map(toEntryDto),
        });
      } catch (err) {
        emitResult({
          type: "piweb_attachment_catalog_result",
          id: frame.id,
          ok: false,
          error: {
            code: "CATALOG_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return;
    }
    // op === "materialize"
    try {
      const attachmentId = await materializeEntry(
        frame.entryId,
        state,
        catalog,
        input.store,
        input.sessionId,
      );
      emitResult({
        type: "piweb_attachment_catalog_result",
        id: frame.id,
        ok: true,
        attachmentId,
      });
    } catch (err) {
      const code =
        err instanceof CatalogMaterializeError ? err.code : "CATALOG_ERROR";
      emitResult({
        type: "piweb_attachment_catalog_result",
        id: frame.id,
        ok: false,
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const stdin = input.stdin ?? process.stdin;
  let installed = false;
  let onData: DataListener | undefined;
  try {
    stdin.setEncoding?.("utf8");
    const reader = new JsonlLineReader();
    onData = (chunk: string | Buffer): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of reader.push(text)) {
        let parsedLine: unknown;
        try {
          parsedLine = JSON.parse(line);
        } catch {
          continue; // 非 JSON — 与本桥无关,忽略
        }
        if (
          typeof parsedLine !== "object" ||
          parsedLine === null ||
          (parsedLine as { type?: unknown }).type !== "piweb_attachment_catalog_request"
        ) {
          continue; // 其余行(他桥/pi RPC/畸形帧)放行,不干预不回包
        }
        const req = AttachmentCatalogRequestFrameSchema.safeParse(parsedLine);
        if (!req.success) continue; // 畸形请求帧 — 放行(主进程侧按超时收敛)
        void handleRequest(req.data).catch((err) => {
          stderr.write(`runner: attachment-catalog bridge dispatch error: ${String(err)}\n`);
        });
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(`runner: attachment-catalog bridge stdin reader install error: ${String(err)}\n`);
  }

  let cleanedUp = false;
  return {
    installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined) stdin.removeListener("data", onData);
      }
    },
  };
}
