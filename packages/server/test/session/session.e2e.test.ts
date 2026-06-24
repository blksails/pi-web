/**
 * e2e:create → prompt → 订阅者收到完整 UIMessage 流 → getSessionStats → stop 幂等
 * (Req 10.5, 4.x, 6.x, 7.3, 7.4)。
 *
 * 注:protocol 的 UiMessageChunkSchema 不含 AI SDK 的 start/start-step/finish/finish-step
 * 生命周期块;assistant message 的可见边界由 text part 的 text-start/text-end 表达,
 * 流式增量由 text-delta 表达。本 e2e 断言此 schema-valid 的完整序列。
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { SpawnSpec, SseFrame } from "@blksails/protocol";
import { protocolVersion, SseFrameSchema } from "@blksails/protocol";
import { PiRpcProcess } from "../../src/rpc-channel/index.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { makeResolved } from "./fixtures.js";

const STUB = fileURLToPath(
  new URL("./fixtures/session-stub-process.mjs", import.meta.url),
);

function spec(): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [STUB],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.map((c) => c().catch(() => undefined)));
  cleanup = [];
});

function chunkType(f: SseFrame): string {
  return f.kind === "uiMessageChunk" ? f.chunk.type : `control:${f.payload.control}`;
}

describe("session-engine e2e", () => {
  it("create → prompt → full UIMessage stream → stats → idempotent stop", async () => {
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const channel: SessionChannel = new PiRpcProcess(spec());

    const { sessionId, session } = mgr.createSession({
      resolved: makeResolved(),
      channel,
    });
    cleanup.push(() => session.stop());

    expect(store.get(sessionId)).toBe(session);

    const seq: string[] = [];
    const valid: SseFrame[] = [];
    const finished = new Promise<void>((resolve) => {
      session.subscribe((f) => {
        seq.push(chunkType(f));
        valid.push(f);
        if (chunkType(f) === "finish") resolve();
      });
    });

    await session.prompt("say hello");
    await finished;

    // full schema-valid AI-SDK-v5 stream:
    // start → text-start → text-delta… → text-end → finish-step → finish
    expect(seq).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    for (const f of valid) {
      const parsed = SseFrameSchema.parse(f);
      expect(parsed.protocolVersion).toBe(protocolVersion);
    }

    // getSessionStats works and refreshes cache
    const stats = await session.getSessionStats();
    expect(stats.success).toBe(true);
    expect(session.getCachedState()?.stats).toMatchObject({ sessionId: "stub-session" });

    // stop → channel closed, store removed, second stop idempotent
    await session.stop();
    expect(session.status).toBe("stopped");
    expect(store.get(sessionId)).toBeUndefined();
    expect(channel.health().alive).toBe(false);
    await expect(session.stop()).resolves.toBeUndefined();
  });
});
