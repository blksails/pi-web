/**
 * Node e2e(state-injection-bridge · 双向闭环):经真实 createPiWebHandler(REST + SSE)+ stub agent,
 * 验证状态注入桥两条边走的是浏览器命中的同一 handler/session/channel/SSE 链路:
 *
 *  1. 下行(agent→UI):prompt(含 `state-bridge` sentinel)→ stub 发 piweb_state 行 →
 *     PiSession.handleRawLine → control:"state" 帧 → SSE(count=1)。
 *  2. 写回(UI→agent):POST /sessions/:id/state {key:count,value:42} → PiSession.setState →
 *     stub 收 piweb_state_set → 回 piweb_state 行 → control:"state" 帧 → SSE(count=42)。
 *
 * stub 代替「真实 agent + wireStateBridge」模拟权威 KV;server 链路全程真实。
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

const route = await import("@/app/api/sessions/[[...path]]/route");
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

describe("state-injection-bridge closed loop (offline)", () => {
  it("下行:prompt(state-bridge)→ SSE control:state 帧带 count=1", async () => {
    const id = await createSession("./examples/state-bridge-agent");
    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.status).toBe(200);

    const watch = readUntil(
      stream,
      (t) => t.includes('"control":"state"') && t.includes('"key":"count"'),
      8000,
    );

    const ack = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "please run state-bridge demo" }),
      }),
    );
    expect([200, 201]).toContain(ack.status);

    await watch.done;
    const text = watch.text();
    await watch.cancel();

    expect(text).toContain('"control":"state"');
    expect(text).toContain('"key":"count"');
    expect(text).toContain('"value":1');
  });

  it("写回:POST /state {count:42} → SSE control:state 帧收敛到 42", async () => {
    const id = await createSession("./examples/state-bridge-agent");
    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.status).toBe(200);

    const watch = readUntil(
      stream,
      (t) => t.includes('"control":"state"') && t.includes('"value":42'),
      8000,
    );

    const ack = await route.POST(
      reqOf(`/api/sessions/${id}/state`, {
        method: "POST",
        body: JSON.stringify({ key: "count", value: 42 }),
      }),
    );
    expect(ack.status).toBe(200);
    expect(((await ack.json()) as { ok: boolean }).ok).toBe(true);

    await watch.done;
    const text = watch.text();
    await watch.cancel();

    expect(text).toContain('"control":"state"');
    expect(text).toContain('"key":"count"');
    expect(text).toContain('"value":42');
  });

  it("写回校验:非法负载(缺 key)→ 400,不发帧", async () => {
    const id = await createSession("./examples/state-bridge-agent");
    const res = await route.POST(
      reqOf(`/api/sessions/${id}/state`, {
        method: "POST",
        body: JSON.stringify({ value: 1 }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
