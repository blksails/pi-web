/**
 * 单元:wireAttachmentCatalogBridge — 物化通路(幂等/串行化/落库)(spec
 * agent-attachment-catalog,任务 2.2;Req 3.1-3.3, 3.5, 5.3)。
 *
 * 用注入的 stdin(EventEmitter)/stdout(捕获)+ 一个内存态假 `ChildAttachmentStore` 验证:
 *  - 幂等三态:内存命中(同进程重复 materialize 同 entryId+version)/ meta 扫描命中
 *    (内存映射清空但落盘 meta 仍在,模拟热重载)/ version 变更 → 新落库
 *  - 并发串行化:同一 entryId 并发请求只 resolve 一次
 *  - 落库继承 origin:"tool-output"(经 store.put)
 *  - resolve 抛错:曾被 list 过 → CATALOG_ERROR;从未被 list 过 → ENTRY_NOT_FOUND
 *  - store 不可用(undefined)→ CATALOG_ERROR,不崩
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { wireAttachmentCatalogBridge } from "../../src/runner/attachment-catalog-wiring.js";
import type { AgentAttachmentCatalogDecl } from "../../src/runner/agent-definition.js";
import type { ChildAttachmentStore } from "../../src/attachment-bridge/child-store.js";
import type { Attachment } from "@blksails/pi-web-protocol";

/** 内存态假 store:只实现桥实际调用的四个方法(put/listBySession/getMeta/setMeta)。 */
function makeFakeStore(): {
  store: ChildAttachmentStore;
  putCalls: Array<{ bytes: Uint8Array; name: string; mimeType: string; origin: string }>;
} {
  const attachments = new Map<string, Attachment>();
  const metaByAttId = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const putCalls: Array<{ bytes: Uint8Array; name: string; mimeType: string; origin: string }> =
    [];

  const store = {
    async put(input: {
      bytes: Uint8Array;
      name: string;
      mimeType: string;
      size: number;
      sessionId: string;
      origin: string;
    }): Promise<Attachment> {
      counter += 1;
      const id = `att_fake_${counter}`;
      putCalls.push({
        bytes: input.bytes as Uint8Array,
        name: input.name,
        mimeType: input.mimeType,
        origin: input.origin,
      });
      const att: Attachment = {
        id,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        origin: input.origin as Attachment["origin"],
        sessionId: input.sessionId,
        createdAt: new Date().toISOString(),
      };
      attachments.set(id, att);
      return att;
    },
    async listBySession(sessionId: string): Promise<Attachment[]> {
      return [...attachments.values()].filter((a) => a.sessionId === sessionId);
    },
    async getMeta(id: string): Promise<Record<string, unknown> | undefined> {
      return metaByAttId.get(id);
    },
    async setMeta(id: string, meta: Record<string, unknown>): Promise<void> {
      metaByAttId.set(id, meta);
    },
  } as unknown as ChildAttachmentStore;

  return { store, putCalls };
}

type Harness = {
  stdin: EventEmitter;
  lines: string[];
  feed: (obj: unknown) => void;
};

function makeHarness(catalog: AgentAttachmentCatalogDecl, store?: ChildAttachmentStore): Harness {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  (stdin as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  const lines: string[] = [];
  const stdout = { write: (s: string) => (lines.push(s), true) };
  const stderr = { write: () => true };
  wireAttachmentCatalogBridge({ sessionId: "sess-1", catalog, store, stdin, stdout, stderr });
  const feed = (obj: unknown): void => {
    stdin.emit("data", JSON.stringify(obj) + "\n");
  };
  return { stdin, lines, feed };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

function listReq(id: string, query = ""): unknown {
  return { type: "piweb_attachment_catalog_request", id, op: "list", query };
}
function materializeReq(id: string, entryId: string): unknown {
  return { type: "piweb_attachment_catalog_request", id, op: "materialize", entryId };
}
function results(lines: string[]): Array<{
  id: string;
  ok: boolean;
  attachmentId?: string;
  entries?: unknown[];
  error?: { code: string; message: string };
}> {
  return lines.slice(1).map((l) => JSON.parse(l)); // [0] = declaration frame
}

describe("materialize — 落库与幂等(Req 3.1-3.3/3.5)", () => {
  it("首次 materialize:resolve → store.put(origin:tool-output) → 回 attachmentId", async () => {
    const { store, putCalls } = makeFakeStore();
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "Report" }],
      resolve: (id) => {
        expect(id).toBe("entry-1");
        return { bytes: new Uint8Array([1, 2, 3]), name: "report.pdf", mimeType: "application/pdf" };
      },
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(listReq("list-1")); // 回填 lastKnownVersion
    await flush();
    feed(materializeReq("mat-1", "entry-1"));
    await flush();
    const res = results(lines);
    const materializeResult = res.find((r) => r.id === "mat-1");
    expect(materializeResult?.ok).toBe(true);
    expect(materializeResult?.attachmentId).toMatch(/^att_fake_/);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.origin).toBe("tool-output");
    expect(putCalls[0]?.name).toBe("report.pdf");
  });

  it("内存命中:同进程重复 materialize 同 entryId → 不再调用 resolve/put", async () => {
    const { store, putCalls } = makeFakeStore();
    const resolveSpy = vi.fn(() => ({
      bytes: new Uint8Array([9]),
      name: "x.bin",
      mimeType: "application/octet-stream",
    }));
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X" }],
      resolve: resolveSpy,
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(listReq("list-1"));
    await flush();
    feed(materializeReq("mat-1", "entry-1"));
    await flush();
    feed(materializeReq("mat-2", "entry-1"));
    await flush();
    const res = results(lines);
    const first = res.find((r) => r.id === "mat-1");
    const second = res.find((r) => r.id === "mat-2");
    expect(first?.attachmentId).toBe(second?.attachmentId);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(putCalls).toHaveLength(1);
  });

  it("meta 扫描命中:内存映射清空(模拟热重载)但落盘 meta 仍在 → 复用不新落库", async () => {
    const { store, putCalls } = makeFakeStore();
    const resolveSpy = vi.fn(() => ({
      bytes: new Uint8Array([9]),
      name: "x.bin",
      mimeType: "application/octet-stream",
    }));
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X", version: "v1" }],
      resolve: resolveSpy,
    };
    // 第一个桥实例(旧进程/旧内存态):落库一次,setMeta 固化幂等锚。
    let firstAttachmentId: string | undefined;
    {
      const { feed, lines } = makeHarness(catalog, store);
      feed(listReq("list-1"));
      await flush();
      feed(materializeReq("mat-1", "entry-1"));
      await flush();
      const res = results(lines).find((r) => r.id === "mat-1");
      expect(res?.ok).toBe(true);
      firstAttachmentId = res?.attachmentId;
    }
    expect(putCalls).toHaveLength(1);
    // 第二个桥实例(新内存态,同 store/落盘 meta):必须先 list 回填相同 version 才能算出
    // 同一幂等键,再 materialize 命中 meta 扫描而不新落库。
    {
      const { feed, lines } = makeHarness(catalog, store);
      feed(listReq("list-2"));
      await flush();
      feed(materializeReq("mat-2", "entry-1"));
      await flush();
      const res = results(lines).find((r) => r.id === "mat-2");
      expect(res?.ok).toBe(true);
      expect(res?.attachmentId).toBe(firstAttachmentId);
    }
    expect(putCalls).toHaveLength(1); // 未新落库
    expect(resolveSpy).toHaveBeenCalledTimes(1); // 第二次 materialize 未再调用 resolve
  });

  it("version 变更 → 视为新内容,新落库(不复用旧幂等锚)", async () => {
    const { store, putCalls } = makeFakeStore();
    let currentVersion = "v1";
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X", version: currentVersion }],
      resolve: () => ({
        bytes: new Uint8Array([1]),
        name: "x.bin",
        mimeType: "application/octet-stream",
      }),
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(listReq("list-1"));
    await flush();
    feed(materializeReq("mat-1", "entry-1"));
    await flush();
    currentVersion = "v2";
    feed(listReq("list-2")); // 回填新 version
    await flush();
    feed(materializeReq("mat-2", "entry-1"));
    await flush();
    const res = results(lines);
    const first = res.find((r) => r.id === "mat-1");
    const second = res.find((r) => r.id === "mat-2");
    expect(first?.attachmentId).not.toBe(second?.attachmentId);
    expect(putCalls).toHaveLength(2);
  });
});

describe("materialize — 并发串行化(Req 5.3)", () => {
  it("同一 entryId 并发请求只 resolve 一次,复用同一结果", async () => {
    const { store, putCalls } = makeFakeStore();
    let resolveCallCount = 0;
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X" }],
      resolve: async () => {
        resolveCallCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { bytes: new Uint8Array([1]), name: "x.bin", mimeType: "application/octet-stream" };
      },
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(listReq("list-1"));
    await flush();
    feed(materializeReq("mat-a", "entry-1"));
    feed(materializeReq("mat-b", "entry-1"));
    await new Promise((r) => setTimeout(r, 50));
    const res = results(lines);
    const a = res.find((r) => r.id === "mat-a");
    const b = res.find((r) => r.id === "mat-b");
    expect(a?.attachmentId).toBeDefined();
    expect(a?.attachmentId).toBe(b?.attachmentId);
    expect(resolveCallCount).toBe(1);
    expect(putCalls).toHaveLength(1);
  });
});

describe("materialize — 错误分支(Req 3.4/5.3 兼容,design.md 错误处理)", () => {
  it("resolve 抛错(entryId 曾被 list 过)→ CATALOG_ERROR", async () => {
    const { store } = makeFakeStore();
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X" }],
      resolve: () => {
        throw new Error("transient fetch failure");
      },
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(listReq("list-1"));
    await flush();
    feed(materializeReq("mat-1", "entry-1"));
    await flush();
    const res = results(lines).find((r) => r.id === "mat-1");
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("CATALOG_ERROR");
  });

  it("resolve 抛错(entryId 从未被 list 过)→ ENTRY_NOT_FOUND", async () => {
    const { store } = makeFakeStore();
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [],
      resolve: () => {
        throw new Error("no such entry");
      },
    };
    const { feed, lines } = makeHarness(catalog, store);
    feed(materializeReq("mat-1", "ghost-entry"));
    await flush();
    const res = results(lines).find((r) => r.id === "mat-1");
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("ENTRY_NOT_FOUND");
  });

  it("store 不可用(undefined)→ CATALOG_ERROR,不崩", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [{ id: "entry-1", name: "X" }],
      resolve: () => ({ bytes: new Uint8Array([1]), name: "x.bin", mimeType: "application/octet-stream" }),
    };
    const { feed, lines } = makeHarness(catalog, undefined);
    feed(listReq("list-1"));
    await flush();
    feed(materializeReq("mat-1", "entry-1"));
    await flush();
    const res = results(lines).find((r) => r.id === "mat-1");
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("CATALOG_ERROR");
  });
});
