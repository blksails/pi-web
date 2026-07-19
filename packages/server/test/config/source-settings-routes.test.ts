/**
 * 集成:GET|PUT /config/source/:sourceKey 端点(spec: source-settings-and-slots,
 * 任务 2.2;Req 3.1-3.6)。经 `createPiWebHandler({ routes })` 注入接缝,与
 * `config-routes.test.ts` 同款写法。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FormSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  createSourceSettingsRoutes,
  type ResolvedSourceSettings,
  SOURCE_SETTINGS_DISABLED_ENV,
} from "../../src/config/source-settings-routes.js";
import { SourceSettingsCodec } from "../../src/config/source-settings-codec.js";
import { sourceKey } from "../../src/source-key.js";
import type { AuthContext } from "../../src/http/index.js";

let tmpDir: string;
let projectDir: string;

const SK = sourceKey("registry://example/crm-agent");
const UNKNOWN_SK = sourceKey("registry://example/does-not-exist");

beforeEach(async () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = join(tmpdir(), `source-settings-routes-agent-${nonce}`);
  projectDir = join(tmpdir(), `source-settings-routes-project-${nonce}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
  delete process.env[SOURCE_SETTINGS_DISABLED_ENV];
});

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** 测试用 FormSchema:一个必填 string、一个 secret、一个非必填 number。 */
const TEST_SCHEMA: FormSchema = {
  domain: "source",
  title: "CRM Agent Settings",
  fields: [
    { key: "apiBase", kind: "string", label: "API Base", required: true },
    { key: "apiKey", kind: "secret", label: "API Key", required: false },
    { key: "timeoutMs", kind: "number", label: "Timeout", required: false },
  ],
};

function makeResolveSettings(
  scope: ResolvedSourceSettings["scope"] = "source",
): (sk: string) => Promise<ResolvedSourceSettings | undefined> {
  return async (sk: string) => {
    if (sk === SK) return { schema: TEST_SCHEMA, scope };
    return undefined;
  };
}

function makeHandler(opts: {
  auth?: AuthContext;
  resolveSettings?: (sk: string) => Promise<ResolvedSourceSettings | undefined>;
  scope?: ResolvedSourceSettings["scope"];
  defaultCwd?: string;
  onSaved?: (
    sk: string,
    payload: { readonly values: Readonly<Record<string, unknown>>; readonly liveReloadKeys: readonly string[] },
  ) => void | Promise<void>;
}) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const resolveSettings = opts.resolveSettings ?? makeResolveSettings(opts.scope);
  const routes = createSourceSettingsRoutes({
    rootDir: tmpDir,
    resolveSettings,
    ...(opts.defaultCwd !== undefined ? { defaultCwd: opts.defaultCwd } : {}),
    ...(opts.onSaved !== undefined ? { onSaved: opts.onSaved } : {}),
  });
  const handler = createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => opts.auth ?? { anonymous: true },
  });
  return { handler, resolveSettings };
}

// ─── GET ────────────────────────────────────────────────────────────────────

describe("GET /config/source/:sourceKey", () => {
  it("200: returns schema + masked values for a known source with no settings on disk yet", async () => {
    const { handler } = makeHandler({});
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    expect(res.status).toBe(200);

    const body = await readJson(res);
    expect(body["schema"]).toEqual(TEST_SCHEMA);
    expect(body["values"]).toEqual({});
    expect(body["scope"]).toBe("source");
  });

  it("200: masks secret field, never exposes plaintext (Req 3.1/3.4)", async () => {
    const codec = new SourceSettingsCodec(tmpDir);
    await codec.save("source", SK, { apiBase: "https://crm.example.com", apiKey: "sk-plaintext-1234" });

    const { handler } = makeHandler({});
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    const raw = await res.text();

    expect(raw).not.toContain("sk-plaintext-1234");

    const body = JSON.parse(raw) as Record<string, unknown>;
    const values = body["values"] as Record<string, unknown>;
    expect(values["apiBase"]).toBe("https://crm.example.com");
    const mask = values["apiKey"] as Record<string, unknown>;
    expect(mask["__secret"]).toBe(true);
    expect(mask["set"]).toBe(true);
  });

  it("400: sourceKey shape is invalid (not 16-hex)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(new Request("http://x/config/source/not-a-valid-key"));
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("INVALID_SOURCE_KEY");
  });

  it("404: sourceKey has valid shape but resolveSettings returns undefined (unknown source)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(new Request(`http://x/config/source/${UNKNOWN_SK}`));
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("SOURCE_NOT_FOUND");
  });

  it("gate closed: PI_WEB_SOURCE_SETTINGS_DISABLED=1 → 404, resolveSettings never called", async () => {
    process.env[SOURCE_SETTINGS_DISABLED_ENV] = "1";
    const resolveSettings = vi.fn(makeResolveSettings());
    const { handler } = makeHandler({ resolveSettings });
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    expect(res.status).toBe(404);
    expect(resolveSettings).not.toHaveBeenCalled();
  });

  it("200: propagates manifest-level title/icon (Req 5.2, task 5.1 附带修复)", async () => {
    const { handler } = makeHandler({
      resolveSettings: async (sk: string) =>
        sk === SK
          ? { schema: TEST_SCHEMA, scope: "source" as const, title: "清单标题", icon: "🔧" }
          : undefined,
    });
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["title"]).toBe("清单标题");
    expect(body["icon"]).toBe("🔧");
  });

  it("200: omits title/icon when resolveSettings doesn't provide them (back-compat)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    const body = await readJson(res);
    expect(body["title"]).toBeUndefined();
    expect(body["icon"]).toBeUndefined();
  });

  it("project scope: reads from <cwd>/.pi/source-settings/<sourceKey>.json", async () => {
    const codec = new SourceSettingsCodec(tmpDir);
    await codec.save("project", SK, { apiBase: "https://project-scoped.example.com" }, { cwd: projectDir });

    const { handler } = makeHandler({ scope: "project", defaultCwd: projectDir });
    const res = await handler(new Request(`http://x/config/source/${SK}`));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect((body["values"] as Record<string, unknown>)["apiBase"]).toBe(
      "https://project-scoped.example.com",
    );
    expect(body["scope"]).toBe("project");

    const onDisk = JSON.parse(
      await fs.readFile(join(projectDir, ".pi", "source-settings", `${SK}.json`), "utf8"),
    );
    expect(onDisk["apiBase"]).toBe("https://project-scoped.example.com");
  });
});

// ─── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /config/source/:sourceKey", () => {
  it("200: saves values to disk (source scope)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://crm.example.com" } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["ok"]).toBe(true);

    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk["apiBase"]).toBe("https://crm.example.com");
  });

  it("400: required field missing → validation fails, does not write to disk (Req 3.3)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { timeoutMs: 5000 } }), // apiBase required, missing
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("VALIDATION_FAILED");

    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk).toEqual({});
  });

  it("400: field type mismatch → validation fails, does not write to disk (Req 3.3)", async () => {
    const { handler } = makeHandler({});
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://crm.example.com", timeoutMs: "not-a-number" } }),
      }),
    );
    expect(res.status).toBe(400);

    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk).toEqual({});
  });

  it("404: unknown sourceKey", async () => {
    const { handler } = makeHandler({});
    const res = await handler(
      new Request(`http://x/config/source/${UNKNOWN_SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://x.example.com" } }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400: invalid sourceKey shape", async () => {
    const { handler } = makeHandler({});
    const res = await handler(
      new Request("http://x/config/source/short", {
        method: "PUT",
        body: JSON.stringify({ values: {} }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("gate closed: PUT also 404s, resolveSettings/codec never touched", async () => {
    process.env[SOURCE_SETTINGS_DISABLED_ENV] = "1";
    const resolveSettings = vi.fn(makeResolveSettings());
    const { handler } = makeHandler({ resolveSettings });
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://x.example.com" } }),
      }),
    );
    expect(res.status).toBe(404);
    expect(resolveSettings).not.toHaveBeenCalled();

    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk).toEqual({});
  });

  it("secret roundtrip: PUT sets a secret value, response never echoes plaintext, subsequent GET never exposes plaintext (硬性不变量)", async () => {
    const { handler } = makeHandler({});
    const putRes = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({
          values: { apiBase: "https://crm.example.com", apiKey: "sk-super-secret-999" },
        }),
      }),
    );
    expect(putRes.status).toBe(200);
    const putRaw = await putRes.text();
    expect(putRaw).not.toContain("sk-super-secret-999");

    const getRes = await handler(new Request(`http://x/config/source/${SK}`));
    const getRaw = await getRes.text();
    expect(getRaw).not.toContain("sk-super-secret-999");
    const getBody = JSON.parse(getRaw) as Record<string, unknown>;
    const values = getBody["values"] as Record<string, unknown>;
    const mask = values["apiKey"] as Record<string, unknown>;
    expect(mask["__secret"]).toBe(true);
    expect(mask["set"]).toBe(true);

    // Disk itself does hold the plaintext (codec is secret-agnostic by design) —
    // assert directly against the codec to prove the *value* was actually persisted,
    // while only the HTTP responses above are asserted secret-free.
    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk["apiKey"]).toBe("sk-super-secret-999");
  });

  it("secret keep semantics: PUT without apiKey preserves the previously-set disk value (mergeSecrets keep)", async () => {
    const codec = new SourceSettingsCodec(tmpDir);
    await codec.save("source", SK, { apiBase: "https://crm.example.com", apiKey: "sk-keep-me" });

    const { handler } = makeHandler({});
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://crm2.example.com" } }),
      }),
    );
    expect(res.status).toBe(200);

    const onDisk = await codec.load("source", SK);
    expect(onDisk["apiKey"]).toBe("sk-keep-me");
    expect(onDisk["apiBase"]).toBe("https://crm2.example.com");
  });

  it("project scope: PUT writes to <cwd>/.pi/source-settings/<sourceKey>.json", async () => {
    const { handler } = makeHandler({ scope: "project", defaultCwd: projectDir });
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://project-scoped.example.com" } }),
      }),
    );
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(
      await fs.readFile(join(projectDir, ".pi", "source-settings", `${SK}.json`), "utf8"),
    );
    expect(onDisk["apiBase"]).toBe("https://project-scoped.example.com");
  });
});

// ─── onSaved 通道 b(任务 7.2,运行期实时下发,Req 7.1)────────────────────────────

/** liveReload 混合 schema:一个 liveReload 键(notifyEmail)+ 一个非 liveReload 键(apiBase)+
 * 一个 secret 键(apiKey,永不下发明文)。 */
const LIVE_RELOAD_SCHEMA: FormSchema = {
  domain: "source",
  fields: [
    { key: "apiBase", kind: "string", label: "API Base", required: false },
    { key: "apiKey", kind: "secret", label: "API Key", required: false },
    {
      key: "notifyEmail",
      kind: "string",
      label: "Notify Email",
      required: false,
      liveReload: true,
    },
  ],
};

describe("PUT /config/source/:sourceKey — onSaved 通道 b(任务 7.2)", () => {
  it("落盘成功后调用 onSaved,携带 sourceKey + 已掩码 values + liveReloadKeys 子集", async () => {
    const onSaved = vi.fn();
    const { handler } = makeHandler({
      resolveSettings: async (sk) =>
        sk === SK ? { schema: LIVE_RELOAD_SCHEMA, scope: "source" } : undefined,
      onSaved,
    });

    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({
          values: {
            apiBase: "https://crm.example.com",
            apiKey: "sk-secret-value",
            notifyEmail: "ops@example.com",
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    expect(onSaved).toHaveBeenCalledTimes(1);
    const [calledSk, payload] = onSaved.mock.calls[0] as [
      string,
      { values: Record<string, unknown>; liveReloadKeys: string[] },
    ];
    expect(calledSk).toBe(SK);
    expect(payload.liveReloadKeys).toEqual(["notifyEmail"]);
    expect(payload.values["apiBase"]).toBe("https://crm.example.com");
    expect(payload.values["notifyEmail"]).toBe("ops@example.com");
    // secret 字段必须掩码,onSaved 收到的 payload 里不含明文(同 GET/PUT 响应体的不变量)。
    const mask = payload.values["apiKey"] as Record<string, unknown>;
    expect(mask["__secret"]).toBe(true);
    expect(JSON.stringify(payload.values)).not.toContain("sk-secret-value");
  });

  it("onSaved 抛出异常不影响 PUT 200 响应(best-effort,Req 7.1 的 MAY 语义)", async () => {
    const onSaved = vi.fn(() => {
      throw new Error("boom");
    });
    const { handler } = makeHandler({
      resolveSettings: async (sk) =>
        sk === SK ? { schema: LIVE_RELOAD_SCHEMA, scope: "source" } : undefined,
      onSaved,
    });

    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://crm.example.com" } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(onSaved).toHaveBeenCalledTimes(1);

    const codec = new SourceSettingsCodec(tmpDir);
    const onDisk = await codec.load("source", SK);
    expect(onDisk["apiBase"]).toBe("https://crm.example.com");
  });

  it("未声明 onSaved 时行为与 M1/M2 完全一致(不调用任何回调)", async () => {
    const { handler } = makeHandler({
      resolveSettings: async (sk) =>
        sk === SK ? { schema: LIVE_RELOAD_SCHEMA, scope: "source" } : undefined,
    });
    const res = await handler(
      new Request(`http://x/config/source/${SK}`, {
        method: "PUT",
        body: JSON.stringify({ values: { apiBase: "https://crm.example.com" } }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
