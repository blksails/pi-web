/**
 * 集成:真实 SessionManager + rpc-channel stub agent。
 * 起 createPiWebHandler,POST /sessions → GET /stream → POST /messages,
 * 断言命令经引擎转发且 SSE 上收到对应帧序列(Req 10.2,3.1,5.1,5.2)。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { makeRealEngine, readStream } from "./helpers.js";
import type { SessionManager } from "../../src/session/index.js";

let managers: SessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.map((m) => m.shutdown().catch(() => undefined)));
  managers = [];
});

describe("http-api integration (real engine + stub agent)", () => {
  it("POST /sessions → subscribe SSE → POST /messages → frames stream through", async () => {
    const { manager, store, createChannel, resolver } = makeRealEngine();
    managers.push(manager);
    const handler = createPiWebHandler({
      manager,
      store,
      resolver,
      createChannel,
      sse: { heartbeatMs: 0 },
    });

    const createRes = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "./agent" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const { sessionId } = (await createRes.json()) as { sessionId: string };
    expect(store.get(sessionId)).toBeDefined();

    const streamRes = await handler(
      new Request(`http://x/sessions/${sessionId}/stream`, { method: "GET" }),
    );
    expect(streamRes.headers.get("Content-Type")).toBe("text/event-stream");

    // begin reading the stream concurrently
    const collected = readStream(streamRes, {
      until: (t) => t.includes('"finish"'),
      maxMs: 8000,
    });

    const msgRes = await handler(
      new Request(`http://x/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(msgRes.status).toBe(200);

    const text = await collected;
    expect(text).toContain("event: uiMessageChunk");
    expect(text).toContain("text-delta");
    expect(text).toContain('"finish"');
  });
});
