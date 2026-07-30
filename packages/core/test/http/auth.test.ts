/**
 * auth 单测:默认放行;authResolver 拒绝→401;authorizeSession false→403(Req 8.x)。
 *
 * 经 createPiWebHandler 端到端验证调用点。
 */
import { describe, expect, it } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function setup(): { store: InMemorySessionStore; manager: SessionManager } {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  store.create(asPiSession(new MockSession("sess-1")));
  return { store, manager };
}

describe("auth seams", () => {
  it("default-allow: no seams → request reaches handler", async () => {
    const { store, manager } = setup();
    const handler = createPiWebHandler({ manager, store });
    const res = await handler(
      new Request("http://x/sessions/sess-1/abort", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });

  it("authResolver reject → 401", async () => {
    const { store, manager } = setup();
    const handler = createPiWebHandler({
      manager,
      store,
      authResolver: () => Promise.resolve({ reject: 401 }),
    });
    const res = await handler(
      new Request("http://x/sessions/sess-1/abort", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("authorizeSession false → 403", async () => {
    const { store, manager } = setup();
    const handler = createPiWebHandler({
      manager,
      store,
      authorizeSession: () => Promise.resolve(false),
    });
    const res = await handler(
      new Request("http://x/sessions/sess-1/abort", { method: "POST" }),
    );
    expect(res.status).toBe(403);
  });
});
