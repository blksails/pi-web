/**
 * Integration: catch-all session route forwards to createPiWebHandler and
 * returns its Response unchanged, incl. the SSE stream endpoint; plus config
 * injection / secret-safety checks.
 *
 * Runs with the stub agent (PI_WEB_STUB_AGENT=1) so it is offline + deterministic
 * and exercises the real handler/session/channel chain.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";

// Stub mode BEFORE importing the route (config + handler read env at first use).
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");
const { loadConfig, ConfigError } = await import("@/lib/app/config");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

// 旧宿主要求每个 route 文件声明 `export const runtime = "nodejs"` / `dynamic = "force-dynamic"`
// (否则会话 API 被放到 Edge/Serverless,子进程与 SSE 长连接均不可用)。该约束随 Next 一并消失:
// 新宿主是普通 Node 进程,不存在 runtime 选择。故此处不再有对应断言。

describe("config injection + secret safety", () => {
  it("loads defaults and never includes secret values in errors", () => {
    const config = loadConfig({
      PI_WEB_STUB_AGENT: "1",
      PI_WEB_DEFAULT_MODEL: "stub-model",
    } as NodeJS.ProcessEnv);
    expect(config.defaultModel).toBe("stub-model");
    expect(config.stubAgent).toBe(true);
  });

  it("does NOT require a provider key in real mode; resolves the pi agent dir for auth.json/settings.json", () => {
    // No provider key, no stub: credentials come from ~/.pi/agent/auth.json,
    // so loadConfig must not throw and must resolve the pi agent dir.
    const cfg = loadConfig({ SOME_OTHER: "x" } as unknown as NodeJS.ProcessEnv);
    expect(cfg.stubAgent).toBe(false);
    expect(cfg.providerKeys).toEqual({});
    expect(cfg.defaultModel).toBeUndefined(); // settings.json decides
    expect(cfg.agentDir).toMatch(/[\\/]\.pi[\\/]agent$/);
    // ConfigError remains exported for other recognizable config failures.
    expect(typeof ConfigError).toBe("function");
  });

  it("passes provider env keys through (additive) and honors PI_WEB_AGENT_DIR override", () => {
    const secret = "sk-super-secret-value-1234567890";
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: secret,
      PI_WEB_AGENT_DIR: "/custom/agent",
    } as NodeJS.ProcessEnv);
    expect(cfg.agentDir).toBe("/custom/agent");
    expect(cfg.providerKeys.ANTHROPIC_API_KEY).toBe(secret);
  });

  it("recognizes DASHSCOPE_API_KEY as a provider key (sandbox baked-image entrypoint depends on it)", () => {
    // spec sandbox-baked-agent-image:e2b 分支把 providerKeys 键自动并入 envPassthrough,
    // 基座镜像 entrypoint 以容器 env DASHSCOPE_API_KEY 注入容器内 models.json。
    const secret = "sk-sp-test-dashscope-key";
    const cfg = loadConfig({ DASHSCOPE_API_KEY: secret } as unknown as NodeJS.ProcessEnv);
    expect(cfg.providerKeys.DASHSCOPE_API_KEY).toBe(secret);
  });
});

describe("POST /api/sessions → create → stream → messages (forwarded to handler)", () => {
  let sessionId: string;

  beforeAll(async () => {
    const res = await route.POST(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { sessionId: string };
    sessionId = body.sessionId;
    expect(typeof sessionId).toBe("string");
  });

  it("GET /api/sessions/:id/stream returns text/event-stream (not buffered)", async () => {
    const streamRes = await route.GET(
      req(`/api/sessions/${sessionId}/stream`, { method: "GET" }),
    );
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    expect(streamRes.body).not.toBeNull();

    // Collect incremental frames until the extension-ui pause (proves SSE chain).
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 20000;

    const collect = (async () => {
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (value !== undefined) text += decoder.decode(value, { stream: true });
        if (done) break;
        if (text.includes("extension-ui") || text.includes('"finish"')) break;
      }
    })();

    // Send a prompt after the stream is open.
    const promptRes = await route.POST(
      req(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "say hello" }),
      }),
    );
    expect(promptRes.status).toBe(200);

    await collect;
    await reader.cancel();

    // Incremental text deltas + tool + reasoning frames appear before pause.
    expect(text).toContain("text-delta");
    expect(text).toContain("tool-input-available");
    expect(text).toContain("reasoning-delta");
    // The stub pauses on an extension-ui control frame (permission dialog).
    expect(text).toContain("extension-ui");
  }, 25000);

  it("DELETE /api/sessions/:id is forwarded and returns ok", async () => {
    const res = await route.DELETE(
      req(`/api/sessions/${sessionId}`, { method: "DELETE" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});
