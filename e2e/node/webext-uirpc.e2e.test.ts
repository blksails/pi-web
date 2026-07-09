/**
 * Node e2e(agent-web-extension 任务 7.x · Tier3 闭环):
 * 经真实 createPiWebHandler(REST + SSE)+ stub agent,验证 UI↔agent RPC 闭环:
 *   POST /sessions/:id/ui-rpc(slash list)→ stub agent 应答 ui_rpc_response →
 *   PiSession 翻译为 control:ui-rpc 帧 → SSE 回传(correlationId 配对)。
 *
 * 这是浏览器 e2e 的离线对应物:走的是浏览器命中的同一 handler/session/channel/SSE 链路。
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
  return { text: () => acc, done, cancel: () => reader.cancel() };
}

describe("Tier3 ui-rpc closed loop (offline)", () => {
  it("POST ui-rpc(slash list)→ SSE control:ui-rpc 帧带同 correlationId 与候选", async () => {
    const id = await createSession("./examples/webext-contrib-agent");

    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.status).toBe(200);

    const correlationId = "corr-slash-1";
    const watch = readUntil(
      stream,
      (t) => t.includes(correlationId) && t.includes("deploy"),
      8000,
    );

    const ack = await route.POST(
      reqOf(`/api/sessions/${id}/ui-rpc`, {
        method: "POST",
        body: JSON.stringify({
          correlationId,
          point: "slash",
          action: "list",
          payload: { query: "/" },
          protocolVersion: "0.1.0",
        }),
      }),
    );
    expect(ack.status).toBe(200);

    await watch.done;
    const text = watch.text();
    await watch.cancel();

    expect(text).toContain("ui-rpc");
    expect(text).toContain(correlationId);
    expect(text).toContain("deploy");
    expect(text).toContain("rollback");
  });
});
