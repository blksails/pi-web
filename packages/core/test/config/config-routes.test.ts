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
import { createConfigRoutes } from "../../src/http/routes/config-routes.js";
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

// ─── aigc domain(aigc-tool-settings)─────────────────────────────────────────

describe("config domain: aigc", () => {
  it("GET 缺省 → formSchema + 空 values;PUT 后回读 disabledModels + enablePromptOptimization", async () => {
    const handler = makeHandler();
    // GET 缺省
    const g0 = await handler(new Request("http://x/config/aigc"));
    expect(g0.status).toBe(200);
    const b0 = await readJson(g0);
    expect(b0.formSchema).toBeDefined();

    // PUT 设置被禁模型 + 开启优化
    const put = await handler(
      new Request("http://x/config/aigc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: { disabledModels: ["gpt-image-2"], enablePromptOptimization: true },
        }),
      }),
    );
    expect(put.status).toBe(200);

    // 落盘文件形态正确(aigcExtension 装配期即读此文件)
    const raw = await fs.readFile(join(tmpDir, "aigc.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      disabledModels: ["gpt-image-2"],
      enablePromptOptimization: true,
    });

    // 回读一致
    const g1 = await handler(new Request("http://x/config/aigc"));
    const b1 = await readJson(g1);
    expect(b1.values).toMatchObject({
      disabledModels: ["gpt-image-2"],
      enablePromptOptimization: true,
    });
  });

  it("PUT 非法 disabledModels(非数组)→ 422", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/aigc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { disabledModels: "nope" } }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

// ─── providers domain(multi-gateway-providers 任务 5.4;Req 7.1, 7.3, 7.6, 11.7)──
//
// providers 域的 secret 嵌在 objectList 条目内(`providers[].apiKey`),这是通用
// `maskSecrets`/`mergeSecrets` 的已知盲点(见 `provider-secrets.ts` 头注释)——本组
// 用例专门盯这条:若把 config-routes.ts 的 domain 分支改回通用实现,下面第一条用例
// 必须转红(apiKey 明文会出现在响应体里)。

describe("config domain: providers", () => {
  it("GET 缺省(文件不存在)→ formSchema + 空 values(与其余域同惯例)", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/providers"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const formSchema = body["formSchema"] as Record<string, unknown>;
    expect(formSchema["domain"]).toBe("providers");
    expect(body["values"]).toEqual({});
  });

  it("PUT 新增自定义 provider → 200,磁盘明文,GET 回读时 apiKey 已掩码(不泄漏明文)", async () => {
    const handler = makeHandler();
    const putRes = await handler(
      new Request("http://x/config/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            providers: [
              {
                id: "my-provider",
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-plaintext-secret",
                models: [{ id: "model-a" }],
              },
            ],
          },
        }),
      }),
    );
    expect(putRes.status).toBe(200);

    // 磁盘落的是明文(装配期需要真实凭据发起请求)。
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "providers.json"), "utf8")) as {
      providers: readonly Record<string, unknown>[];
    };
    expect(onDisk.providers[0]?.["apiKey"]).toBe("sk-plaintext-secret");

    // 回读:明文绝不出现在响应体里,apiKey 是掩码对象(Req 7.3)。
    const getRes = await handler(new Request("http://x/config/providers"));
    const body = await readJson(getRes);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("sk-plaintext-secret");
    const values = body["values"] as { providers: readonly Record<string, unknown>[] };
    const apiKeyMask = values.providers[0]?.["apiKey"] as Record<string, unknown>;
    expect(apiKeyMask["__secret"]).toBe(true);
    expect(apiKeyMask["set"]).toBe(true);
  });

  it("PUT 保留名冲突(如 anthropic)→ 422,不写盘", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: { providers: [{ id: "anthropic", baseUrl: "https://api.example.com/v1" }] },
        }),
      }),
    );
    expect(res.status).toBe(422);
    await expect(fs.readFile(join(tmpDir, "providers.json"), "utf8")).rejects.toThrow();
  });

  it("PUT 两条同标识 → 422", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            providers: [
              { id: "dup", baseUrl: "https://a.example.com/v1" },
              { id: "dup", baseUrl: "https://b.example.com/v1" },
            ],
          },
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("PUT 回传 keep 掩码 → 磁盘密钥不变;更新的字段(baseUrl)生效", async () => {
    await fs.writeFile(
      join(tmpDir, "providers.json"),
      JSON.stringify({
        providers: [
          {
            id: "my-provider",
            baseUrl: "https://old.example.com/v1",
            apiKey: "sk-original",
            models: [],
          },
        ],
      }),
    );
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            providers: [
              {
                id: "my-provider",
                baseUrl: "https://new.example.com/v1",
                apiKey: { __secret: true, action: "keep" },
                models: [],
              },
            ],
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "providers.json"), "utf8")) as {
      providers: readonly Record<string, unknown>[];
    };
    expect(onDisk.providers[0]?.["apiKey"]).toBe("sk-original");
    expect(onDisk.providers[0]?.["baseUrl"]).toBe("https://new.example.com/v1");
  });
});
