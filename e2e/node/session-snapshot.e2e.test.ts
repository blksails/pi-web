/**
 * Node-level e2e — session-snapshot-authority(Req 2.3, 4.1, 7.3)。
 *
 * 经真实 createPiWebHandler(HTTP + SSE)+ stub agent,验证权威 busy 端到端:
 *   - 发 prompt → 出现 control:session-state busy=true(轮次开始)。
 *   - 轮次中途重连 → 回放即收敛到 busy=true(粘性,迟到订阅不丢)。
 *   - 响应权限对话 → 轮次结束 → 末态 busy=false(不卡死)。
 * 经 pi-handler 默认开启 snapshotAuthority;离线 stub,无浏览器、无 LLM。
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
  return ((await res.json()) as { sessionId: string }).sessionId;
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

/** 抽取 SSE 文本中所有 session-state 快照的 busy 序列。 */
function busySeq(text: string): boolean[] {
  return [...text.matchAll(/"busy":(true|false)/g)].map((m) => m[1] === "true");
}

describe("session-snapshot-authority — 权威 busy 端到端(offline)", () => {
  it("busy goes true on turn start, replays sticky on reconnect, and falls back to false at turn end (no stuck busy)", async () => {
    const id = await createSession("./examples/hello-agent");

    // Phase 1: 流到权限对话暂停,期间应见 busy=true。
    const stream = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    const phase1 = readUntil(stream, (t) => t.includes("extension-ui"), 30000);
    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "say hello" }),
      }),
    );
    expect(promptRes.status).toBe(200);
    await phase1.done;
    const t1 = phase1.text();
    expect(t1).toContain('"control":"session-state"');
    expect(busySeq(t1)).toContain(true); // 轮次开始 → busy=true
    await phase1.cancel();

    // Phase 2: 轮次中途重连 → 回放即应收敛到 busy=true(粘性,Req 4.1)。
    const stream2 = await route.GET(reqOf(`/api/sessions/${id}/stream`, { method: "GET" }));
    const phase2 = readUntil(
      stream2,
      // 等到 busy 序列以 false 收尾(且已见 true):轮次真正结束。busy=false 现先于 finish 帧广播
      // (避免前端关流丢帧),故不依赖 finish 位置,只看 busy 序列末值。
      (t) => {
        const seq = busySeq(t);
        return seq.includes(true) && seq.at(-1) === false;
      },
      30000,
    );
    const uiRes = await route.POST(
      reqOf(`/api/sessions/${id}/ui-response`, {
        method: "POST",
        body: JSON.stringify({ type: "extension_ui_response", id: "ext-1", confirmed: true }),
      }),
    );
    expect(uiRes.status).toBeGreaterThanOrEqual(200);
    expect(uiRes.status).toBeLessThan(300);

    await phase2.done;
    const seq2 = busySeq(phase2.text());
    expect(seq2[0]).toBe(true); // 重连首帧回放:仍在忙(粘性收敛)
    expect(seq2.at(-1)).toBe(false); // 轮次结束:busy 回落 false,不卡死
    await phase2.cancel();
  }, 90000);
});
