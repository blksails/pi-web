/**
 * Node-level e2e — fake 402 provider auto-retry → exhausted-retries fallback
 * (spec 402-UI, point ③ acceptance).
 *
 * Wiring choice: drives the real HTTP handler → session engine → SSE encoder →
 * translate layer (packages/server/src/session/translate/translate-event.ts)
 * exactly like e2e/node/streaming.e2e.test.ts, feeding it protocol-conformant
 * `auto_retry_start` / `auto_retry_end` / `agent_end` events (the exact wire
 * shapes `AgentEventSchema` in packages/protocol/src/rpc/event.ts declares)
 * from the stub agent process instead of a real pi subprocess hitting a fake
 * HTTP 402 upstream.
 *
 * Why not a real pi subprocess + fake HTTP 402 server: the actual retry
 * classifier lives in the external `@earendil-works/pi-ai` dependency
 * (dist/utils/retry.js `isRetryableAssistantError`). Its retryable-error regex
 * matches `429|5xx|overloaded|rate limit|timeout|...` but NOT `402`, and its
 * non-retryable regex explicitly force-rejects `insufficient_quota|billing|
 * quota exceeded` — the exact vocabulary a realistic 402 "insufficient
 * balance" body would contain. So a literal fake-402-body-over-real-network
 * rig would either (a) not trigger auto_retry at all with a faithful 402
 * body, or (b) need to embed retryable substrings (e.g. "503") into the body
 * to force a retry, which stops being a faithful 402 fixture. That
 * third-party classification logic is also outside this repo's control and
 * could change independently of the 402-UI feature under test here.
 *
 * The stub agent speaks the same JSONL RPC protocol a real agent does (see
 * lib/app/stub-agent-process.mjs header comment), so this test exercises the
 * real, production translate-event.ts code for both ① (auto-retry status
 * frames) and ② (empty-handed-turn fallback synthesis) on a real SSE stream.
 * UI-level rendering of these frames (status bar / error bubble DOM) is
 * covered by packages/ui/test/chat/part-renderer.test.tsx.
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
});

function reqOf(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function createSession(source: string): Promise<string> {
  const res = await route.POST(
    reqOf("/api/sessions", { method: "POST", body: JSON.stringify({ source }) }),
  );
  expect([200, 201]).toContain(res.status);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

function readUntil(
  res: Response,
  predicate: (text: string) => boolean,
  maxMs: number,
): { text: () => string; done: Promise<void>; cancel: () => Promise<void> } {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + maxMs;
  const done = (async () => {
    while (Date.now() < deadline) {
      const { done: d, value } = await reader.read();
      if (value !== undefined) acc += decoder.decode(value, { stream: true });
      if (d) break;
      if (predicate(acc)) break;
    }
  })();
  return {
    text: () => acc,
    done,
    cancel: () => reader.cancel(),
  };
}

describe("fake 402 provider — auto-retry exhausted fallback (offline, real translate layer)", () => {
  it("streams auto-retry status frames, then a synthesized error, then finish — in that order", async () => {
    const id = await createSession("./examples/hello-agent");

    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const phase = readUntil(stream, (t) => t.includes('"type":"finish"'), 15000);

    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "trigger 402-retry please" }),
      }),
    );
    expect(promptRes.status).toBe(200);

    await phase.done;
    const text = phase.text();

    // 1) auto-retry status frames appear, carrying the 402 errorMessage.
    const autoRetryStartIdx = text.indexOf('"data-pi-auto-retry"');
    expect(autoRetryStartIdx).toBeGreaterThan(-1);
    expect(text).toContain('"phase":"start"');
    expect(text).toContain('"attempt":1');
    expect(text).toContain("insufficient_balance");
    // Two retry attempts configured by the sentinel.
    expect(text).toContain('"attempt":2');
    expect((text.match(/"data-pi-auto-retry"/g) ?? []).length).toBeGreaterThanOrEqual(4); // 2×start + 2×end

    // 2) after retries are exhausted, the translate layer synthesizes an
    //    error chunk (Req 402-UI ②) — no assistant text was ever produced.
    const errorIdx = text.indexOf('"type":"error"');
    expect(errorIdx).toBeGreaterThan(-1);
    expect(text).toContain("多次重试后未获模型响应");
    expect(text).toContain("insufficient_balance");
    expect(text).not.toContain('"type":"text-start"');

    // 3) ordering: auto-retry frames precede the error, and finish trails it.
    const finishIdx = text.indexOf('"type":"finish"');
    expect(autoRetryStartIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(finishIdx);

    await phase.cancel();
  }, 20000);
});
