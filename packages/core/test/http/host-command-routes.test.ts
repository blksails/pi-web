/**
 * 单测:ui-rpc handler 的 host 命令拦截(unified-command-result-layer 任务 2.3)。
 *
 * point=command/execute + 注册表命中 → 服务端同步执行,结果在 HTTP 响应体返回(不转 agent)。
 * 非 host 命令 / 其它 point → 转发 session.uiRpc(既有路径,向后兼容)。
 */
import { describe, expect, it } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { createHostCommandRegistry } from "../../src/commands/host-command-registry.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function setup() {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  store.create(asPiSession(session));
  const hostCommands = createHostCommandRegistry([
    {
      name: "plugin",
      execute: async (ctx) => ({
        command: "plugin",
        effect: "panel-refresh",
        message: `argv=${ctx.argv}`,
      }),
    },
  ]);
  const handler = createPiWebHandler({ manager, store, hostCommands });
  return { handler, session };
}

function uiRpc(point: string, action: string, payload: unknown): Request {
  return new Request("http://x/sessions/sess-1/ui-rpc", {
    method: "POST",
    body: JSON.stringify({
      correlationId: "c1",
      point,
      action,
      payload,
      protocolVersion: "0.1.0",
    }),
  });
}

describe("ui-rpc host 命令拦截", () => {
  it("point=command/execute + 已注册 → 服务端执行,结果在响应体(不转 agent)", async () => {
    const { handler, session } = setup();
    const res = await handler(uiRpc("command", "execute", { name: "plugin", argv: "list" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { command: string; effect: string; message: string };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.effect).toBe("panel-refresh");
    expect(body.result?.message).toBe("argv=list");
    // 未转发 agent。
    expect(session.calls.some((c) => c.method === "uiRpc")).toBe(false);
  });

  it("point=command 但命令未注册 → 转发 session.uiRpc(ack)", async () => {
    const { handler, session } = setup();
    const res = await handler(uiRpc("command", "execute", { name: "ghost" }));
    expect(res.status).toBe(200);
    expect(session.calls.some((c) => c.method === "uiRpc")).toBe(true);
  });

  it("point=slash(非 command)→ 转发 session.uiRpc(既有 Tier3 路径不变)", async () => {
    const { handler, session } = setup();
    const res = await handler(uiRpc("slash", "list", {}));
    expect(res.status).toBe(200);
    expect(session.calls.some((c) => c.method === "uiRpc")).toBe(true);
  });
});
