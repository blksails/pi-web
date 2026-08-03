/**
 * 建会话时记录所属 agent-source(spec session-meta-index, 任务 3.3 / Req 1.1, 3.5)。
 *
 * 来源取 `ResolvedSource.policySource`(resolver 的稳定来源标识,公共实现恒赋值);
 * 缺省时**不写**该字段 —— 宁可列表不显示来源,也不用 cwd 冒充。
 */
import { describe, expect, it, vi } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { MockChannel } from "../session/mock-channel.js";
import { makeResolved } from "./helpers.js";
import type { ResolvedSource } from "../../src/agent-source/index.js";
import type {
  SessionMetaEntry,
  SessionMetaIndex,
} from "../../src/session-meta/types.js";

/** 记账用的内存索引(观测 merge 调用,不碰磁盘)。 */
function recordingIndex(): SessionMetaIndex & {
  entries: Map<string, SessionMetaEntry>;
  mergeCalls: () => number;
} {
  const entries = new Map<string, SessionMetaEntry>();
  let calls = 0;
  return {
    entries,
    mergeCalls: () => calls,
    read: () => Promise.resolve(entries),
    merge: (sessionId, patch) => {
      calls += 1;
      entries.set(sessionId, { ...entries.get(sessionId), ...patch });
      return Promise.resolve();
    },
    remove: (sessionId) => {
      entries.delete(sessionId);
      return Promise.resolve();
    },
    prune: () => Promise.resolve(0),
  };
}

function deps(resolved: ResolvedSource) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const resolver = { resolve: (): Promise<ResolvedSource> => Promise.resolve(resolved) };
  const createChannel = (): SessionChannel => new MockChannel();
  return { store, manager, resolver, createChannel };
}

const createReq = (): Request =>
  new Request("http://x/sessions", {
    method: "POST",
    body: JSON.stringify({ source: "./agent" }),
  });

describe("建会话记录 agent-source(Req 1.1)", () => {
  it("policySource 存在 → 写入索引", async () => {
    const idx = recordingIndex();
    const d = deps(makeResolved({ policySource: "builtin:aigc-canvas" }));
    const handler = createPiWebHandler({ ...d, sessionMetaIndex: idx });
    const res = await handler(createReq());
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    await vi.waitFor(() => {
      expect(idx.entries.get(sessionId)?.agentSource).toBe("builtin:aigc-canvas");
    });
  });

  it("policySource 缺省 → 不写该字段(不用 cwd 冒充来源)", async () => {
    const idx = recordingIndex();
    const d = deps(makeResolved()); // 无 policySource
    const handler = createPiWebHandler({ ...d, sessionMetaIndex: idx });
    expect((await handler(createReq())).status).toBe(201);
    // 给 fire-and-forget 一点时间,然后断言「什么都没写」
    await new Promise((r) => setTimeout(r, 30));
    expect(idx.mergeCalls()).toBe(0);
    expect(idx.entries.size).toBe(0);
  });

  it("未注入索引时建会话行为不变", async () => {
    const d = deps(makeResolved({ policySource: "builtin:x" }));
    const handler = createPiWebHandler(d);
    expect((await handler(createReq())).status).toBe(201);
  });

  it("索引写入恒失败时建会话仍 201(Req 3.5)", async () => {
    const hostile: SessionMetaIndex = {
      read: () => Promise.reject(new Error("boom")),
      merge: () => Promise.reject(new Error("boom")),
      remove: () => Promise.reject(new Error("boom")),
      prune: () => Promise.reject(new Error("boom")),
    };
    const d = deps(makeResolved({ policySource: "builtin:x" }));
    const handler = createPiWebHandler({ ...d, sessionMetaIndex: hostile });
    const res = await handler(createReq());
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(d.store.get(sessionId)).toBeDefined();
  });
});
