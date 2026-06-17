/**
 * 单元:POST /sessions/:id/reload(Req 4.x/7.x/6.x/10.1)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  makeReloadSessionHandler,
  ReloadNotConfiguredError,
} from "../../src/extensions/routes/reload-session.js";
import { defaultTrustPolicy } from "../../src/agent-source/index.js";
import { createDefaultAdminPolicy } from "../../src/extensions/security/admin-policy.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { MockSession, asPiSession } from "../http/helpers.js";
import { adminAuth, anonAuth, readJson, userAuth } from "./helpers.js";
import type { AuthContext, RequestContext } from "../../src/http/index.js";
import type {
  SessionReloader,
  TrustDecision,
  TrustFragment,
} from "../../src/extensions/ext.types.js";

const adminPolicy = createDefaultAdminPolicy({ adminUserIds: ["root"] });

function ctx(sessionId: string, auth: AuthContext): RequestContext {
  const url = new URL(`http://x/sessions/${sessionId}/reload`);
  return { req: new Request(url, { method: "POST" }), auth, url, sessionId };
}

function storeWith(mock: MockSession): InMemorySessionStore {
  const store = new InMemorySessionStore(true);
  // MockSession 不带 mode;reload 读 session.mode 计算信任片段,注入 cli 模式。
  (mock as unknown as { mode: string }).mode = "cli";
  store.create(asPiSession(mock));
  return store;
}

describe("POST /sessions/:id/reload", () => {
  it("reloads an active session and acks, passing the trust fragment", async () => {
    const mock = new MockSession("sess-1");
    const store = storeWith(mock);
    const seen: TrustFragment[] = [];
    const reloadSession: SessionReloader = (_s, frag) => {
      seen.push(frag);
      return Promise.resolve();
    };
    const trustPolicy = (_s: string): TrustDecision => "always";

    const res = await makeReloadSessionHandler({
      store,
      adminPolicy,
      reloadSession,
      trustPolicy,
    })(ctx("sess-1", adminAuth));

    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["ok"]).toBe(true);
    expect(body["reloaded"]).toBe("sess-1");
    // cli mode + always → --approve fragment.
    expect(seen[0]!.extraArgs).toEqual(["--approve"]);
  });

  it("returns 404 when the session is not in the store", async () => {
    const store = new InMemorySessionStore(true);
    const res = await makeReloadSessionHandler({
      store,
      adminPolicy,
      reloadSession: () => Promise.resolve(),
      trustPolicy: defaultTrustPolicy,
    })(ctx("ghost", adminAuth));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the session is stopped (does not reload)", async () => {
    const mock = new MockSession("sess-1");
    mock.status = "stopped";
    const store = storeWith(mock);
    const reload = vi.fn<SessionReloader>(() => Promise.resolve());
    const res = await makeReloadSessionHandler({
      store,
      adminPolicy,
      reloadSession: reload,
      trustPolicy: defaultTrustPolicy,
    })(ctx("sess-1", adminAuth));
    expect(res.status).toBe(409);
    expect(reload).not.toHaveBeenCalled();
  });

  it("rejects a non-admin with 403 / anonymous with 401", async () => {
    const mock = new MockSession("sess-1");
    const store = storeWith(mock);
    const deps = {
      store,
      adminPolicy,
      reloadSession: (): Promise<void> => Promise.resolve(),
      trustPolicy: defaultTrustPolicy,
    };
    expect((await makeReloadSessionHandler(deps)(ctx("sess-1", userAuth))).status).toBe(403);
    expect((await makeReloadSessionHandler(deps)(ctx("sess-1", anonAuth))).status).toBe(401);
  });

  it("default reloader surfaces an explicit 501 (not silently dropped)", async () => {
    const mock = new MockSession("sess-1");
    const store = storeWith(mock);
    const res = await makeReloadSessionHandler({
      store,
      adminPolicy,
      reloadSession: () => Promise.reject(new ReloadNotConfiguredError()),
      trustPolicy: defaultTrustPolicy,
    })(ctx("sess-1", adminAuth));
    expect(res.status).toBe(501);
    const body = await readJson(res);
    const err = body["error"] as Record<string, unknown>;
    expect(err["code"]).toBe("RELOAD_NOT_CONFIGURED");
  });
});
