/**
 * mirrorSessionManagerToStore 集成测试:用真实 pi SessionManager 驱动 append*,
 * 断言被镜像到 SqliteSessionEntryStore(按序、类型保留、含头部),且不破坏 SM 自身。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { mirrorSessionManagerToStore, SqliteSessionEntryStore } from "../../src/session-store/index.js";
import { collect } from "./contract.js";

type AppendArg = Parameters<SessionManager["appendMessage"]>[0];

function assistant(text: string): AppendArg {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  } as AppendArg;
}

describe("mirrorSessionManagerToStore — SM 写入镜像到 store", () => {
  it("append* 被按序镜像、类型保留,头部一并写入", async () => {
    const sm = SessionManager.inMemory("/proj");
    const store = new SqliteSessionEntryStore(":memory:");
    const mirror = await mirrorSessionManagerToStore(sm, store);

    sm.appendMessage({ role: "user", content: "hi", timestamp: Date.now() } as AppendArg);
    sm.appendModelChange("openrouter", "anthropic/claude-sonnet-4.6");
    sm.appendMessage(assistant("ok"));

    await mirror.flush();

    const sessionId = sm.getSessionId();
    const entries = await collect(store.read(sessionId));
    expect(entries.map((e) => e.type)).toEqual(["message", "model_change", "message"]);

    const header = await store.readHeader(sessionId);
    expect(header.cwd).toBe("/proj");

    store.close();
  });

  it("不破坏 SM 自身:append 仍返回 id,SM 树可正常读回", async () => {
    const sm = SessionManager.inMemory("/proj");
    const store = new SqliteSessionEntryStore(":memory:");
    const mirror = await mirrorSessionManagerToStore(sm, store);

    const id = sm.appendMessage({ role: "user", content: "x", timestamp: Date.now() } as AppendArg);
    expect(typeof id).toBe("string");
    expect(sm.getEntry(id)?.type).toBe("message");

    await mirror.flush();
    store.close();
  });
});
