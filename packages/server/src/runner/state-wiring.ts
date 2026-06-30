/**
 * 状态注入桥 · runner 子进程装配接线 `wireStateBridge`(state-injection-bridge, Task 2.1)。
 *
 * 把 pi-web **自建**的会话级权威状态核(`SessionStateStore`)接到 agent 子进程的 stdin/stdout
 * 与 globalThis seam,实现 context 外的双向共享状态:
 *
 *  1. **seam 透出**:把 `{get,set,delete,snapshot}` provider 挂到 `__piWebSessionState__`,供运行在
 *     子进程的作者工具经 `@blksails/pi-web-tool-kit` 的 `getSessionState()` 同步读写。
 *  2. **下行(agent→UI)**:订阅状态核变更,将每次 `StateChange` 写为**完整** stdout JSON 行
 *     `{"type":"piweb_state",key,value,rev,deleted}`。server 的 `PiSession.handleRawLine` 截获该行
 *     翻译为 SSE `control:"state"` 帧(不进 LLM 历史)。
 *  3. **写回(UI→agent)**:在进入 RPC 模式**之前**为 `process.stdin` 挂**第二个** JSONL 读取器,
 *     截获 `{"type":"piweb_state_set"|"piweb_state_delete",key,value}` → 改权威态(触发下行)。
 *     pi 自身的 stdin 读取器(`attachJsonlLineReader`,仅 `on("data")` 不独占)也会看到该行并回一条
 *     无害的 `Unknown command`(server 端 id=undefined 无 pending → 丢弃),不影响本路径。
 *
 * 优雅降级(对齐 `wireAttachmentBridge`):任何挂载步骤失败 → 记诊断、能力降级、**不抛**,使会话
 * 仍以「无状态桥」正常启动。无订阅变更时不发任何帧(惰性,Req 2.3)。
 */
import { writeSync } from "node:fs";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { StateSetLineSchema } from "@blksails/pi-web-protocol";
import { JsonlLineReader } from "../rpc-channel/jsonl-reader.js";
import {
  createSessionStateStore,
  type SessionStateStore,
} from "../state/session-state-store.js";

/** 约定 globalThis seam key(必须与 tool-kit `SESSION_STATE_SEAM_KEY` 一致)。 */
export const SESSION_STATE_SEAM_KEY = "__piWebSessionState__";

/** seam 上挂载的 provider(tool-kit `getSessionState` 据此判形并代理)。 */
interface SeamProvider {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

/** data 监听器签名。 */
type DataListener = (chunk: string | Buffer) => void;
/** 监听增删的统一签名(规避 EventEmitter 泛型重载的 this 不兼容)。 */
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

export interface WireStateBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 下行帧出口(默认 process.stdout)。 */
  readonly stdout?: WritableLike;
  /** 写回行入口(默认 process.stdin)。 */
  readonly stdin?: ReadableLike;
  /** globalThis 宿主(默认 globalThis),便于测试隔离。 */
  readonly globalScope?: Record<string, unknown>;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface StateBridgeWiring {
  /** 权威状态核(始终创建;降级时仍可用于进程内读写,只是不接 UI)。 */
  readonly store: SessionStateStore;
  /** stdin 写回读取器是否挂上。 */
  readonly installed: boolean;
  /** 取消订阅 + 卸载 stdin 读取器 + 清 seam(幂等)。 */
  cleanup(): void;
}

/**
 * 装配状态桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**调用。
 */
export function wireStateBridge(
  _runtime: AgentSessionRuntime,
  input: WireStateBridgeInput,
): StateBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const globalScope =
    input.globalScope ?? (globalThis as unknown as Record<string, unknown>);
  const store = createSessionStateStore();

  // 1) seam 透出:作者工具经 getSessionState() 读写;set/delete 走 store(触发下行)。
  const provider: SeamProvider = {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    delete: (key) => {
      store.delete(key);
    },
    snapshot: () => {
      const out: Record<string, unknown> = {};
      for (const [k, entry] of store.snapshot()) out[k] = entry.value;
      return out;
    },
  };
  try {
    globalScope[SESSION_STATE_SEAM_KEY] = provider;
  } catch (err) {
    stderr.write(`runner: state-bridge seam install error: ${String(err)}\n`);
  }

  // 2) 下行:订阅变更 → 写完整 JSON 行到**真实 stdout(fd1)**。
  //    ⚠ 不能用 process.stdout.write:pi 的 runRpcMode `takeOverStdout()` 会把
  //    process.stdout.write 劫持重定向到 stderr(防 agent 杂散输出污染 RPC 流),而 RPC 帧经
  //    pi 内部保存的原始 fd1 写出。server 的 PiRpcProcess 读的是子进程 fd1,故本桥也必须写 fd1。
  //    `fs.writeSync(1, …)` 直写 fd1(takeOverStdout 不触碰底层 fd),且单次系统调用原子,不与 pi 的
  //    异步写交织成半行。测试可经 input.stdout 注入捕获写出。无变更不发(惰性)。
  const writeLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          writeSync(1, s);
        };
  const unsubscribe = store.subscribe((change) => {
    try {
      const line = JSON.stringify({
        type: "piweb_state",
        key: change.key,
        value: change.value,
        rev: change.rev,
        ...(change.deleted ? { deleted: true } : {}),
      });
      writeLine(line + "\n");
    } catch (err) {
      stderr.write(`runner: state-bridge down-frame error: ${String(err)}\n`);
    }
  });

  // 3) 写回:第二个 stdin JSONL 读取器,截获 piweb_state_set / piweb_state_delete。
  const stdin = input.stdin ?? process.stdin;
  let installed = false;
  let onData: ((chunk: string | Buffer) => void) | undefined;
  try {
    stdin.setEncoding?.("utf8");
    const reader = new JsonlLineReader();
    onData = (chunk: string | Buffer): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of reader.push(text)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // 非 JSON(或 pi 命令的部分)— 与本桥无关,忽略
        }
        const res = StateSetLineSchema.safeParse(parsed);
        if (!res.success) continue; // 非 state 写回行 — 交由 pi 处理,本桥不干预
        if (res.data.type === "piweb_state_delete") {
          store.delete(res.data.key);
        } else {
          store.set(res.data.key, res.data.value);
        }
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(`runner: state-bridge stdin reader install error: ${String(err)}\n`);
  }

  let cleanedUp = false;
  return {
    store,
    installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribe();
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined) stdin.removeListener("data", onData);
      }
      if (globalScope[SESSION_STATE_SEAM_KEY] === provider) {
        delete globalScope[SESSION_STATE_SEAM_KEY];
      }
    },
  };
}
