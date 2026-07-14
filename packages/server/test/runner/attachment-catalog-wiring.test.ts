/**
 * 单元:wireAttachmentCatalogBridge — 骨架(声明/枚举/隔离)(spec agent-attachment-catalog,
 * 任务 2.1;Req 1.2, 1.3, 6.1, 6.2, 6.3)。
 *
 * 用注入的 stdin(EventEmitter)/stdout(捕获)验证:
 *  - 无声明 → 零帧零 reader(Req 1.2)
 *  - 有声明 → 装配期单帧(纯投影,handler 不出进程)
 *  - list 派发:query 透传、entries 形状回包
 *  - list handler 抛错 → 类型化 CATALOG_ERROR 结果帧,不崩(Req 6.1/6.2)
 *  - 非本桥帧/畸形帧放行,不回包(Req 6.3)
 *  - 并发多请求独立配对回包
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { wireAttachmentCatalogBridge } from "../../src/runner/attachment-catalog-wiring.js";
import type { AgentAttachmentCatalogDecl } from "../../src/runner/agent-definition.js";

type Harness = {
  stdin: EventEmitter;
  lines: string[];
  errors: string[];
  wiring: ReturnType<typeof wireAttachmentCatalogBridge>;
  feed: (obj: unknown) => void;
  feedRaw: (text: string) => void;
};

function makeHarness(catalog: AgentAttachmentCatalogDecl | undefined): Harness {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  (stdin as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  const lines: string[] = [];
  const errors: string[] = [];
  const stdout = { write: (s: string) => (lines.push(s), true) };
  const stderr = { write: (s: string) => (errors.push(s), true) };
  const wiring = wireAttachmentCatalogBridge({
    sessionId: "s1",
    catalog,
    stdin,
    stdout,
    stderr,
  });
  const feedRaw = (text: string): void => {
    stdin.emit("data", text);
  };
  const feed = (obj: unknown): void => {
    feedRaw(JSON.stringify(obj) + "\n");
  };
  return { stdin, lines, errors, wiring, feed, feedRaw };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function listRequest(over: Partial<Record<string, unknown>> = {}): unknown {
  return {
    type: "piweb_attachment_catalog_request",
    id: "req-1",
    op: "list",
    query: "",
    ...over,
  };
}

function parsed(lines: string[]): unknown[] {
  return lines.map((l) => {
    expect(l.endsWith("\n")).toBe(true);
    return JSON.parse(l);
  });
}

describe("wireAttachmentCatalogBridge — 装配期声明帧(Req 1.2)", () => {
  it("无声明(undefined):零帧、不装 reader", () => {
    const { lines, wiring } = makeHarness(undefined);
    expect(lines).toEqual([]);
    expect(wiring.installed).toBe(false);
  });

  it("有声明:单行 agent_attachment_catalog 帧,available:true", () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [],
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { lines, wiring } = makeHarness(catalog);
    expect(wiring.installed).toBe(true);
    const frames = parsed(lines);
    expect(frames).toEqual([{ type: "agent_attachment_catalog", available: true }]);
  });
});

describe("wireAttachmentCatalogBridge — list 派发(Req 1.3)", () => {
  it("list 成功:query 透传,entries 回包", async () => {
    let seenQuery: string | undefined;
    const catalog: AgentAttachmentCatalogDecl = {
      list: (query) => {
        seenQuery = query;
        return [{ id: "entry-1", name: "Report" }];
      },
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, lines } = makeHarness(catalog);
    feed(listRequest({ id: "req-1", query: "rep" }));
    await flush();
    expect(seenQuery).toBe("rep");
    const frames = parsed(lines.slice(1)); // [0] = declaration frame
    expect(frames).toEqual([
      {
        type: "piweb_attachment_catalog_result",
        id: "req-1",
        ok: true,
        entries: [{ id: "entry-1", name: "Report" }],
      },
    ]);
  });

  it("list handler 抛错 → CATALOG_ERROR 结果帧,不崩(Req 6.1/6.2)", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => {
        throw new Error("boom");
      },
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, lines } = makeHarness(catalog);
    feed(listRequest({ id: "req-err" }));
    await flush();
    const frames = parsed(lines.slice(1)) as Array<{
      ok: boolean;
      error?: { code: string; message: string };
    }>;
    expect(frames[0]?.ok).toBe(false);
    expect(frames[0]?.error?.code).toBe("CATALOG_ERROR");
    expect(frames[0]?.error?.message).toContain("boom");
  });

  it("async list handler 支持(Promise 返回)", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return [{ id: "entry-async", name: "Async Report" }];
      },
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, lines } = makeHarness(catalog);
    feed(listRequest({ id: "req-async" }));
    await new Promise((r) => setTimeout(r, 20));
    const frames = parsed(lines.slice(1)) as Array<{ ok: boolean; entries?: unknown[] }>;
    expect(frames[0]?.ok).toBe(true);
    expect(frames[0]?.entries).toHaveLength(1);
  });

  it("并发多请求独立配对回包", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: (query) => [{ id: `entry-${query}`, name: query }],
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, lines } = makeHarness(catalog);
    feed(listRequest({ id: "req-a", query: "a" }));
    feed(listRequest({ id: "req-b", query: "b" }));
    await flush();
    const frames = parsed(lines.slice(1)) as Array<{ id: string; entries: Array<{ id: string }> }>;
    const byId = new Map(frames.map((f) => [f.id, f]));
    expect(byId.get("req-a")?.entries[0]?.id).toBe("entry-a");
    expect(byId.get("req-b")?.entries[0]?.id).toBe("entry-b");
  });
});

describe("wireAttachmentCatalogBridge — 隔离(Req 6.3)", () => {
  it("非本桥帧放行,不回包", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [],
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, lines } = makeHarness(catalog);
    feed({ type: "piweb_agent_route_request", id: "x", name: "y", method: "GET", query: {} });
    await flush();
    expect(lines).toHaveLength(1); // 仅装配期声明帧
  });

  it("畸形请求帧(op 未知)放行,不回包", async () => {
    const catalog: AgentAttachmentCatalogDecl = {
      list: () => [],
      resolve: () => {
        throw new Error("not reached");
      },
    };
    const { feed, feedRaw, lines } = makeHarness(catalog);
    feed({ type: "piweb_attachment_catalog_request", id: "x", op: "unknown-op" });
    feedRaw("not json at all\n");
    await flush();
    expect(lines).toHaveLength(1);
  });
});
