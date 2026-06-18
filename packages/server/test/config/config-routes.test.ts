/**
 * 集成:GET/PUT /config/:domain 端点经 createPiWebHandler routes? 注入。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createConfigRoutes } from "../../src/config/config-routes.js";
import type { AuthContext } from "../../src/http/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `cfg-routes-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function makeHandler(
  auth: AuthContext = { anonymous: true },
  adminPolicy?: (a: AuthContext) => boolean,
) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createConfigRoutes({ rootDir: tmpDir, adminPolicy });
  const handler = createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => auth,
  });
  return handler;
}

// ─── GET tests ────────────────────────────────────────────────────────────────

describe("GET /config/:domain", () => {
  it("returns formSchema + masked values for auth domain", async () => {
    // Pre-populate auth.json.
    await fs.writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({ anthropic: { apiKey: "sk-test-1234" } }),
    );

    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/auth"));
    expect(res.status).toBe(200);

    const body = await readJson(res);
    expect(body["formSchema"]).toBeDefined();
    const formSchema = body["formSchema"] as Record<string, unknown>;
    expect(formSchema["domain"]).toBe("auth");

    // values must NOT contain plaintext secret.
    const values = body["values"] as Record<string, unknown>;
    const json = JSON.stringify(values);
    expect(json).not.toContain("sk-test-1234");

    // apiKey must be a mask object.
    const provider = (values["anthropic"] as Record<string, unknown>);
    const apiKeyMask = provider["apiKey"] as Record<string, unknown>;
    expect(apiKeyMask["__secret"]).toBe(true);
    expect(apiKeyMask["set"]).toBe(true);
  });

  it("returns formSchema + values for settings domain", async () => {
    await fs.writeFile(
      join(tmpDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "openai" }),
    );

    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/settings"));
    expect(res.status).toBe(200);

    const body = await readJson(res);
    const formSchema = body["formSchema"] as Record<string, unknown>;
    expect(formSchema["domain"]).toBe("settings");

    const values = body["values"] as Record<string, unknown>;
    expect(values["theme"]).toBe("dark");
    expect(values["defaultProvider"]).toBe("openai");
  });

  it("returns 404 for unknown domain", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/unknown-domain"));
    expect(res.status).toBe(404);
  });

  it("returns empty values object when file not found (first access)", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/settings"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["values"]).toEqual({});
  });
});

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe("PUT /config/:domain", () => {
  it("returns 400 for invalid JSON body", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/settings", {
        method: "PUT",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when body missing 'values' field", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/settings", {
        method: "PUT",
        body: JSON.stringify({ wrong: "field" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown domain", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/no-such-domain", {
        method: "PUT",
        body: JSON.stringify({ values: {} }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("writes settings successfully and returns 200", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/settings", {
        method: "PUT",
        body: JSON.stringify({ values: { theme: "light", defaultProvider: "anthropic" } }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);

    // Verify file was written.
    const text = await fs.readFile(join(tmpDir, "settings.json"), "utf8");
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect(saved["theme"]).toBe("light");
    expect(saved["defaultProvider"]).toBe("anthropic");
  });

  it("preserves disk secret when empty sentinel (mask) is sent back", async () => {
    // Pre-set apiKey.
    await fs.writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({ anthropic: { apiKey: "sk-original", baseURL: "https://a.com" } }),
    );

    const handler = makeHandler();
    // Send back a mask (simulating frontend not changing the secret).
    const res = await handler(
      new Request("http://x/config/auth", {
        method: "PUT",
        body: JSON.stringify({
          values: {
            anthropic: { apiKey: { __secret: true, set: true, hint: "inal" }, baseURL: "https://b.com" },
          },
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);

    const text = await fs.readFile(join(tmpDir, "auth.json"), "utf8");
    const saved = JSON.parse(text) as Record<string, unknown>;
    const provider = saved["anthropic"] as Record<string, unknown>;
    // Original apiKey preserved.
    expect(provider["apiKey"]).toBe("sk-original");
    // baseURL updated.
    expect(provider["baseURL"]).toBe("https://b.com");
  });

  it("overwrites apiKey with new plaintext value", async () => {
    await fs.writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({ anthropic: { apiKey: "sk-old" } }),
    );

    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/auth", {
        method: "PUT",
        body: JSON.stringify({ values: { anthropic: { apiKey: "sk-brand-new" } } }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);

    const text = await fs.readFile(join(tmpDir, "auth.json"), "utf8");
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect((saved["anthropic"] as Record<string, unknown>)["apiKey"]).toBe("sk-brand-new");
  });

  it("provider 删除(null)经路由后磁盘上确实被移除,不被 codec 复活(C2 回归)", async () => {
    await fs.writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({
        anthropic: { apiKey: "sk-keep" },
        openai: { apiKey: "sk-remove" },
      }),
    );
    const handler = makeHandler();
    // 删除 openai(provider=null);anthropic 保留(掩码 keep)。
    const res = await handler(
      new Request("http://x/config/auth", {
        method: "PUT",
        body: JSON.stringify({
          values: {
            anthropic: { apiKey: { __secret: true, action: "keep" } },
            openai: null,
          },
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);

    const saved = JSON.parse(
      await fs.readFile(join(tmpDir, "auth.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    // openai 已删除,不会从磁盘原值复活。
    expect(saved["openai"]).toBeUndefined();
    // anthropic 保留原 apiKey。
    expect(saved["anthropic"]?.["apiKey"]).toBe("sk-keep");
  });
});

// ─── adminPolicy ─────────────────────────────────────────────────────────────

describe("adminPolicy", () => {
  it("GET returns 403 when adminPolicy rejects authenticated user", async () => {
    const auth: AuthContext = { anonymous: false, userId: "alice" };
    const handler = makeHandler(auth, () => false);
    const res = await handler(new Request("http://x/config/settings"));
    expect(res.status).toBe(403);
  });

  it("GET returns 401 when adminPolicy rejects anonymous user", async () => {
    const auth: AuthContext = { anonymous: true };
    const handler = makeHandler(auth, () => false);
    const res = await handler(new Request("http://x/config/settings"));
    expect(res.status).toBe(401);
  });

  it("PUT returns 403 when adminPolicy rejects authenticated user", async () => {
    const auth: AuthContext = { anonymous: false, userId: "bob" };
    const handler = makeHandler(auth, () => false);
    const res = await handler(
      new Request("http://x/config/settings", {
        method: "PUT",
        body: JSON.stringify({ values: { theme: "dark" } }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("GET succeeds when adminPolicy allows", async () => {
    const auth: AuthContext = { anonymous: false, userId: "admin" };
    const handler = makeHandler(auth, () => true);
    const res = await handler(new Request("http://x/config/settings"));
    expect(res.status).toBe(200);
  });
});
