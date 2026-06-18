/**
 * Node-level e2e — extension UI 的 select → confirm 闭环(离线 stub,无 LLM 成本)。
 *
 * 经真实 HTTP handler(REST + SSE)驱动 stub agent:prompt 含 `ext-select` sentinel 时,
 * stub 先发 select 扩展 UI 请求并暂停;应答后发 confirm 请求并暂停;再应答后结束本轮。
 * 证明 `extension_ui_request(select/confirm)` → SSE control 帧 → `ui-response` 回传 →
 * 续跑 的完整闭环(对应 examples/ui-demo-agent 的 ctx.ui.select/confirm 交互)。
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

async function postJson(pathname: string, body: unknown): Promise<Response> {
  const res = await route.POST(reqOf(pathname, { method: "POST", body: JSON.stringify(body) }));
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  return res;
}

describe("extension UI select → confirm 闭环(离线 stub)", () => {
  it("select 与 confirm 各自经 extension_ui_request 弹出,ui-response 续跑直到 finish", async () => {
    const id = await createSession("./examples/ui-demo-agent");

    // Phase 1:带 ext-select sentinel 的 prompt → stub 发 select 请求并暂停。
    const s1 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    expect(s1.headers.get("content-type")).toContain("text/event-stream");
    const p1 = readUntil(s1, (t) => t.includes('"sel-1"'), 15000);
    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "deploy please (ext-select)" }),
      }),
    );
    expect(promptRes.status).toBe(200);
    await p1.done;
    const t1 = p1.text();
    expect(t1).toContain("extension-ui");
    expect(t1).toContain('"sel-1"');
    await p1.cancel();

    // Phase 2:应答 select(value) → stub 发 confirm 请求并暂停。
    const s2 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    const p2 = readUntil(s2, (t) => t.includes('"ext-1"'), 15000);
    await postJson(`/api/sessions/${id}/ui-response`, {
      type: "extension_ui_response",
      id: "sel-1",
      value: "staging",
    });
    await p2.done;
    const t2 = p2.text();
    expect(t2).toContain("extension-ui");
    expect(t2).toContain('"ext-1"');
    await p2.cancel();

    // Phase 3:应答 confirm(confirmed) → 本轮续跑并结束。
    const s3 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    const p3 = readUntil(s3, (t) => t.includes('"finish"'), 15000);
    await postJson(`/api/sessions/${id}/ui-response`, {
      type: "extension_ui_response",
      id: "ext-1",
      confirmed: true,
    });
    await p3.done;
    const t3 = p3.text();
    expect(t3).toContain("Continuing");
    expect(t3).toContain('"finish"');
    await p3.cancel();
  }, 45000);
});
