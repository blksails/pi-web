/**
 * Node 级 e2e — 面⑦ per-source 设置面板 M1 全链本地验收(spec source-settings-and-slots,
 * 任务 5.1;Requirements 5.1, 5.4, 5.5, 13.3)。
 *
 * fixture:`examples/module-settings-agent`(`pi-web.json#settings` 声明
 * `scope:"source"` + `title`/`icon` + `widgets:["entity-picker"]`;
 * `settings/schema.json` 覆盖普通 string(`apiBase`)、secret(`apiToken`)、声明
 * widget 的字段(`defaultEntity`)、liveReload 标记字段(`notifyEmail`,仅声明,M3 才消费)
 * 四类;`index.ts` 工厂消费 runner 装配期注入的 `ctx.settings` 并声明两条
 * agent-declared-routes:`get-settings`(回吐 ctx.settings)、`entities`(defaultEntity
 * widget 的动态选项数据源,证明面⑤/⑦互为供给)。
 *
 * 两条互补证据链,合起来覆盖 Req 13.3「声明→端点→面板→落盘→装配注入闭环」:
 *
 *  A) **HTTP 业务层**(端点→落盘→回读):经真实单例 `createPiWebHandler`(与
 *     `source-settings-endpoint.e2e.test.ts` 同一驱动方式)驱动 GET/PUT
 *     `/api/config/source/:sourceKey`——证明 schema 携带 widget 声明 + 清单
 *     title/icon(Req 5.2 附带修复)、secret 三态掩码永不明文、门控关闭时统一 404。
 *
 *  B) **装配注入层**(真实 runner 子进程,与 `settings-assembly-subprocess.test.ts`
 *     任务 3.1 同一技术,stub 抓不到装配期注入类回归):经 agent-declared-routes 非
 *     LLM RPC 通道回吐 `ctx.settings`,证明落盘值真正进了子进程内存(相当于「新会话
 *     systemPrompt/ctx.settings 含存入值」——`get-settings` route 直接回吐同一对象,
 *     `buildSystemPrompt` 是其上的纯函数,route 声明帧能出现即证明工厂未因该值崩溃);
 *     并联带验证 `entities` widget 数据端点可用,以及 project 作用域下「未 trust 不生效」
 *     的降级语义(复用任务 3.1 既有 project fixture,同一技术在本闭环 e2e 内自证)。
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import {
  PiRpcProcess,
  PiSession,
  SourceSettingsCodec,
  sourceKey,
  type ResolvedSource,
} from "@blksails/pi-web-server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// e2e/node -> pi-web root
const REPO_ROOT = path.resolve(HERE, "../..");
const FIXTURE_DIR = path.join(REPO_ROOT, "examples", "module-settings-agent");
const PROJECT_TRUST_FIXTURE_DIR = path.join(
  REPO_ROOT,
  "packages",
  "server",
  "test",
  "runner",
  "fixtures",
  "settings-assembly-project-e2e-agent",
);
const PROJECT_TRUST_FIXTURE_ID = "settings-assembly-project-e2e-agent";

const FIXTURE_SOURCE_KEY = sourceKey("module-settings-agent");

// ─── A) HTTP 业务层:真实 createPiWebHandler 单例 ──────────────────────────────

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-settings-agent-httpdir-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_WEB_DEFAULT_CWD = FIXTURE_DIR;

const api = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
  fs.rmSync(agentDir, { recursive: true, force: true });
});

interface GetResponseBody {
  schema: {
    domain: string;
    title?: string;
    fields: Array<{ key: string; kind: string; widget?: string }>;
  };
  values: Record<string, unknown>;
  scope: string;
  title?: string;
  icon?: string;
}

describe("A) HTTP 业务层 — GET|PUT /api/config/source/:sourceKey(module-settings-agent,真实 handler)", () => {
  it("GET: schema 携带 widget 声明字段 + 清单 title/icon(Req 5.2 附带修复,Req 5.4)", async () => {
    const res = await api.GET(
      new Request(`http://localhost/api/config/source/${FIXTURE_SOURCE_KEY}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GetResponseBody;

    expect(body.scope).toBe("source");
    // 清单级 title/icon(pi-web.json#settings.title/icon)直接透出,不再只靠 schema.title 代理。
    expect(body.title).toBe("Module Settings 示例");
    expect(body.icon).toBe("settings");

    const byKey = new Map(body.schema.fields.map((f) => [f.key, f]));
    expect(byKey.get("apiBase")?.kind).toBe("string");
    expect(byKey.get("apiToken")?.kind).toBe("secret");
    expect(byKey.get("defaultEntity")?.widget).toBe("entity-picker");
    // liveReload 是未定型契约(M3 延后),FormSchemaZodSchema 按 z.object 默认行为静默剥离
    // 该字段上的未知键——字段本身仍存在,只是 liveReload 标记不出现在已校验响应里。
    expect(byKey.has("notifyEmail")).toBe(true);
  });

  it("PUT → GET 回读:apiBase/defaultEntity 落盘可见,apiToken 全程掩码不明文(Req 3.1/3.4/5.4)", async () => {
    const putRes = await api.PUT(
      new Request(`http://localhost/api/config/source/${FIXTURE_SOURCE_KEY}`, {
        method: "PUT",
        body: JSON.stringify({
          values: {
            apiBase: "https://module-settings.example.test/api",
            apiToken: "sk-module-settings-secret-1",
            defaultEntity: "customer",
          },
        }),
      }),
    );
    expect(putRes.status).toBe(200);
    const putRaw = await putRes.text();
    expect(putRaw).not.toContain("sk-module-settings-secret-1");

    const getRes = await api.GET(
      new Request(`http://localhost/api/config/source/${FIXTURE_SOURCE_KEY}`),
    );
    expect(getRes.status).toBe(200);
    const getRaw = await getRes.text();
    expect(getRaw).not.toContain("sk-module-settings-secret-1");

    const body = (await JSON.parse(getRaw)) as GetResponseBody;
    expect(body.values["apiBase"]).toBe("https://module-settings.example.test/api");
    expect(body.values["defaultEntity"]).toBe("customer");
    const mask = body.values["apiToken"] as Record<string, unknown>;
    expect(mask["__secret"]).toBe(true);
    expect(mask["set"]).toBe(true);
  });

  it("gate 关闭(PI_WEB_SOURCE_SETTINGS_DISABLED=1)→ GET/PUT 均统一 404,不泄露端点存在性", async () => {
    process.env.PI_WEB_SOURCE_SETTINGS_DISABLED = "1";
    try {
      const getRes = await api.GET(
        new Request(`http://localhost/api/config/source/${FIXTURE_SOURCE_KEY}`),
      );
      expect(getRes.status).toBe(404);

      const putRes = await api.PUT(
        new Request(`http://localhost/api/config/source/${FIXTURE_SOURCE_KEY}`, {
          method: "PUT",
          body: JSON.stringify({ values: { apiBase: "https://x" } }),
        }),
      );
      expect(putRes.status).toBe(404);
    } finally {
      delete process.env.PI_WEB_SOURCE_SETTINGS_DISABLED;
    }
  });
});

// ─── B) 装配注入层:真实 runner 子进程 ─────────────────────────────────────────

const runnerEntry = path.join(REPO_ROOT, "packages", "server", "src", "runner", "runner.ts");
const serverPkgDir = path.join(REPO_ROOT, "packages", "server");

const spawnedTmpDirs: string[] = [];
function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnedTmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of spawnedTmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

interface SpawnedRunner {
  channel: PiRpcProcess;
  session: PiSession;
}

function spawnRunner(opts: {
  agentPath: string;
  cwd: string;
  agentDir: string;
  trusted?: boolean;
}): SpawnedRunner {
  const resolved: ResolvedSource = {
    mode: "custom",
    trust: opts.trusted === true ? "always" : "ask",
    cwd: opts.cwd,
    spawnSpec: { cmd: process.execPath, args: [], cwd: opts.cwd, env: {} },
  };
  const spec: SpawnSpec = {
    cmd: process.execPath,
    args: [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      opts.agentPath,
      "--cwd",
      opts.cwd,
      "--agent-dir",
      opts.agentDir,
      ...(opts.trusted === true ? ["--trusted"] : []),
    ],
    // jiti/register 从 cwd 解析 node_modules:必须以 server 包为 cwd(既有先例)。
    cwd: serverPkgDir,
    env: { ...process.env } as Record<string, string>,
  };
  const channel = new PiRpcProcess(spec);
  const session = new PiSession({
    id: `module-settings-e2e-${Math.random().toString(36).slice(2)}`,
    resolved,
    channel,
    idleMs: 0,
  });
  return { channel, session };
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function withRunner<T>(
  opts: { agentPath: string; cwd: string; agentDir: string; trusted?: boolean },
  fn: (session: PiSession) => Promise<T>,
): Promise<T> {
  const { session } = spawnRunner(opts);
  try {
    // 就绪锚点:装配期声明帧(routes)已被 PiSession 缓存,RPC 通路已联通(任务 3.1 先例)。
    await waitFor(() => session.agentRoutes.length > 0, "agent-declared routes declaration");
    const commands = await session.getCommands();
    expect(commands.success).toBe(true);
    return await fn(session);
  } finally {
    await session.stop().catch(() => undefined);
  }
}

describe("B) 装配注入层 — 真实 runner 子进程(module-settings-agent,证明 ctx.settings 命中新会话)", () => {
  it("落盘值经装配期真实命中 ctx.settings;systemPrompt 消费不崩溃(route 声明帧能出现即证)", async () => {
    const cwd = makeTmpDir("module-settings-e2e-cwd-");
    const runAgentDir = makeTmpDir("module-settings-e2e-agentdir-");
    const codec = new SourceSettingsCodec(runAgentDir);
    const seeded = {
      apiBase: "https://module-settings.example.test/assembly",
      apiToken: "sk-assembly-secret",
      defaultEntity: "order",
    };
    await codec.save("source", FIXTURE_SOURCE_KEY, seeded);

    const settings = await withRunner(
      { agentPath: FIXTURE_DIR, cwd, agentDir: runAgentDir },
      async (session) => {
        const res = await session.invokeAgentRoute("get-settings", { method: "GET", query: {} });
        expect(res.ok).toBe(true);
        return (res.result as { settings: Readonly<Record<string, unknown>> }).settings;
      },
    );
    expect(settings).toEqual(seeded);
  }, 40_000);

  it("entities widget 数据端点可用(面⑤/⑦互为供给,不依赖第三方 webext)", async () => {
    const cwd = makeTmpDir("module-settings-e2e-entities-cwd-");
    const runAgentDir = makeTmpDir("module-settings-e2e-entities-agentdir-");

    const entities = await withRunner(
      { agentPath: FIXTURE_DIR, cwd, agentDir: runAgentDir },
      async (session) => {
        const res = await session.invokeAgentRoute("entities", { method: "GET", query: {} });
        expect(res.ok).toBe(true);
        return (res.result as { entities: Array<{ value: string; label: string }> }).entities;
      },
    );
    expect(entities.map((e) => e.value)).toEqual(["customer", "order", "invoice"]);
  }, 40_000);

  it("未落盘时 ctx.settings 为空对象(Req 2.4,零变化基线)", async () => {
    const cwd = makeTmpDir("module-settings-e2e-empty-cwd-");
    const runAgentDir = makeTmpDir("module-settings-e2e-empty-agentdir-");

    const settings = await withRunner(
      { agentPath: FIXTURE_DIR, cwd, agentDir: runAgentDir },
      async (session) => {
        const res = await session.invokeAgentRoute("get-settings", { method: "GET", query: {} });
        expect(res.ok).toBe(true);
        return (res.result as { settings: Readonly<Record<string, unknown>> }).settings;
      },
    );
    expect(settings).toEqual({});
  }, 40_000);

  // 降级矩阵①:project 作用域 + 未 trust → 装配期不生效(与本 fixture 同一「面⑦本地验收」
  // 闭环内自证;复用任务 3.1 既有 project-scope fixture,同一 real-subprocess 技术)。
  it("降级矩阵:project 作用域 + 未 trust → ctx.settings 空对象,不生效", async () => {
    const cwd = makeTmpDir("module-settings-e2e-proj-untrusted-cwd-");
    const runAgentDir = makeTmpDir("module-settings-e2e-proj-untrusted-agentdir-");
    const codec = new SourceSettingsCodec(runAgentDir);
    // 文件确实存在于磁盘上,但未信任项目不应读取。
    await codec.save(
      "project",
      sourceKey(PROJECT_TRUST_FIXTURE_ID),
      { theme: "dark" },
      { cwd },
    );

    const settings = await withRunner(
      { agentPath: PROJECT_TRUST_FIXTURE_DIR, cwd, agentDir: runAgentDir },
      async (session) => {
        const res = await session.invokeAgentRoute("get-settings", { method: "GET", query: {} });
        expect(res.ok).toBe(true);
        return (res.result as { settings: Readonly<Record<string, unknown>> }).settings;
      },
    );
    expect(settings).toEqual({});
  }, 40_000);

  // 降级矩阵②:project 作用域 + 受信任 → 装配期生效(对照组,证明①不是「project 恒不生效」而是真 trust 门控)。
  it("降级矩阵:project 作用域 + 受信任 → ctx.settings 命中落盘值(对照组)", async () => {
    const cwd = makeTmpDir("module-settings-e2e-proj-trusted-cwd-");
    const runAgentDir = makeTmpDir("module-settings-e2e-proj-trusted-agentdir-");
    const codec = new SourceSettingsCodec(runAgentDir);
    const seeded = { theme: "dark", limit: 7 };
    await codec.save("project", sourceKey(PROJECT_TRUST_FIXTURE_ID), seeded, { cwd });

    const settings = await withRunner(
      { agentPath: PROJECT_TRUST_FIXTURE_DIR, cwd, agentDir: runAgentDir, trusted: true },
      async (session) => {
        const res = await session.invokeAgentRoute("get-settings", { method: "GET", query: {} });
        expect(res.ok).toBe(true);
        return (res.result as { settings: Readonly<Record<string, unknown>> }).settings;
      },
    );
    expect(settings).toEqual(seeded);
  }, 40_000);
});
