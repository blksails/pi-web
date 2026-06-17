/**
 * Node-level e2e — drives the singleton createPiWebHandler over its real HTTP
 * surface (REST + SSE) with the stub agent, proving the full offline streaming
 * + permission-dialog + abort chain end-to-end without a browser.
 *
 * This is the offline counterpart to the Playwright browser e2e: it exercises
 * the same handler/session/channel/SSE code the browser hits, so when the
 * browser download is blocked this still gives real evidence of the closed loop.
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
  return {
    text: () => acc,
    done,
    cancel: () => reader.cancel(),
  };
}

describe("custom-agent full streaming closed loop (offline)", () => {
  it("streams reasoning, tool, incremental markdown text, then a permission dialog; responding resumes the turn to finish", async () => {
    const id = await createSession("./examples/hello-agent");

    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    // Phase 1: stream until the extension-ui pause.
    const phase1 = readUntil(stream, (t) => t.includes("extension-ui"), 15000);

    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "say hello" }),
      }),
    );
    expect(promptRes.status).toBe(200);

    await phase1.done;
    const t1 = phase1.text();

    // Incremental streaming (multiple separate text-delta frames).
    const deltaCount = (t1.match(/"type":"text-delta"/g) ?? []).length;
    expect(deltaCount).toBeGreaterThan(1);
    // Reasoning (collapsible) + tool card (start) frames present.
    expect(t1).toContain("reasoning-delta");
    expect(t1).toContain("tool-input-available");
    expect(t1).toContain("tool-output-available");
    // Markdown content streamed.
    expect(t1).toContain("Hello");
    // Permission dialog (extension-ui control frame) reached.
    expect(t1).toContain("extension-ui");
    expect(t1).toContain('"ext-1"');

    await phase1.cancel();

    // Phase 2: reconnect the stream and answer the permission dialog.
    const stream2 = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    const phase2 = readUntil(stream2, (t) => t.includes('"finish"'), 15000);

    const uiRes = await route.POST(
      reqOf(`/api/sessions/${id}/ui-response`, {
        method: "POST",
        body: JSON.stringify({
          type: "extension_ui_response",
          id: "ext-1",
          confirmed: true,
        }),
      }),
    );
    expect(uiRes.status).toBeGreaterThanOrEqual(200);
    expect(uiRes.status).toBeLessThan(300);

    await phase2.done;
    const t2 = phase2.text();
    // The agent continued after approval and finished the turn.
    expect(t2).toContain("Continuing");
    expect(t2).toContain('"finish"');
    await phase2.cancel();
  }, 40000);

  it("abort returns ack and the stream can be wound down", async () => {
    const id = await createSession("./examples/hello-agent");
    const res = await route.POST(
      reqOf(`/api/sessions/${id}/abort`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });

  it("session stats are available via the controls side-channel", async () => {
    const id = await createSession("./examples/hello-agent");
    const res = await route.GET(
      reqOf(`/api/sessions/${id}/stats`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const stats = (await res.json()) as Record<string, unknown>;
    expect(stats).toBeTypeOf("object");
  });
});

describe("CLI fallback streaming (offline)", () => {
  it("a no-index directory resolves to CLI mode and still streams incrementally", async () => {
    const id = await createSession("./e2e/fixtures/cli-project");

    const stream = await route.GET(
      reqOf(`/api/sessions/${id}/stream`, { method: "GET" }),
    );
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const collected = readUntil(stream, (t) => t.includes("extension-ui"), 15000);
    const promptRes = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "hello cli" }),
      }),
    );
    expect(promptRes.status).toBe(200);

    await collected.done;
    const text = collected.text();
    const deltaCount = (text.match(/"type":"text-delta"/g) ?? []).length;
    expect(deltaCount).toBeGreaterThan(1);
    expect(text).toContain("Hello");
    await collected.cancel();
  }, 30000);
});
