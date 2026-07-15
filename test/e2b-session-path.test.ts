// @vitest-environment node
/**
 * Integration: e2b 会话路径 · 附件降级态下会话其余能力不受影响(spec
 * sandbox-baked-agent-image,任务 4.3;Req 5.3)——`lib/app/pi-handler.ts`
 * createChannel e2b 段 + HTTP 会话命令路径。
 *
 * 任务 4.3 断言面与既有测试的覆盖对照(只补缺口,不重复):
 *  - 模板覆写生效(Req 3.1/3.4)→ 已覆盖:test/e2b-template-overwrite.test.ts
 *    (map→envd、map→ws-runner、仅全局模板向后兼容、三级全空 500)。
 *  - 附件三形态注入规则(Req 5.1/5.2)→ 已覆盖:test/e2b-env-assembly.test.ts
 *    (全远程×envd/ws-runner 注入、混合/未配零注入)。
 *  - providerKeys 白名单并入(Req 4.2)→ 已覆盖:test/e2b-env-assembly.test.ts
 *    (无条件并入 + 与 PI_WEB_E2B_ENV_PASSTHROUGH 合并去重)。
 *  - local 模式零变化(Req 3.5)→ 双重覆盖:两文件各有一条 local 分支用例。
 *  - **Req 5.3(本文件补的缺口)**:附件能力降级(未配拓扑 / 混合拓扑 → e2b 分支
 *    零注入附件 env)时,沙盒会话其余能力不受影响——现无任何测试。
 *
 * Req 5.3 在 pi-handler 集成面上可达的最强断言(真实沙箱/前端不在本层):
 *  1. 降级态会话创建成功(201)且传输构造完成、模板解析照常生效——降级不阻断会话建立。
 *  2. 降级态下 POST /sessions/:id/messages(对话链路)返回 200 且 prompt 真实抵达
 *     会话通道(捕获通道收到的消息)——对话能力不因附件缺失被拒。
 *  3. 降级态下 GET /sessions/:id/commands(命令/工具查询链路)返回 200——装配面
 *     查询路径不因附件缺失被拒。
 *  4. 全远程注入态 vs 降级态的 e2bSpec.env **键集差恰好等于附件键集合**,且
 *     envPassthrough 同理、providerKeys 值两态一致——降级只减附件面,其余装配
 *     env(工具/webext/布局所依赖的 spawn env 与凭据)一字不动。
 *  两个数据面(envd/ws-runner)与两种降级形态(未配拓扑/混合拓扑)交叉取样覆盖。
 *
 * 可测性:沿用 test/e2b-env-assembly.test.ts 的 mock 技术(捕获传输构造参数 +
 * FakeChannel 满足 PiSession 构造期订阅面),并扩展 FakeChannel 的 prompt/getCommands
 * 以打通 HTTP 命令路径。附件拓扑判定是装配期快照,故各形态经重建 handler 单例切换
 * (shutdown + 删 globalThis pin + 重设 PI_WEB_ATTACHMENT_BACKENDS 后 getHandler)。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-e2b-session-path-test-"));

// 装配期 env(handler 单例首次 import 前钉住)。
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = "e2b-session-path-test-secret-0123456789";
process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE = "1";
process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY = "1";
delete process.env.PI_WEB_STUB_AGENT;

// providerKeys 面(装配期 loadConfig 捕获):清空宿主渗漏,只留受控的一个键。
const PROVIDER_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
] as const;
for (const k of PROVIDER_KEY_NAMES) delete process.env[k];
process.env.OPENAI_API_KEY = "test-openai-key";

// 附件凭据变量(拓扑经变量名间接引用;装配期 buildBackends 解引用要求其存在)。
const CLOUD_TOKEN_ENV = "PI_TEST_CLOUD_TOKEN";
const S3_AK_ENV = "PI_TEST_S3_AK";
const S3_SK_ENV = "PI_TEST_S3_SK";
const CLOUD_TOKEN_VALUE = "test-cloud-token-value";
const S3_AK_VALUE = "test-access-key-value";
const S3_SK_VALUE = "test-secret-key-value";

/** 全远程拓扑(注入态,作为差集对照基准)。 */
const ALL_REMOTE_TOPOLOGY = JSON.stringify({
  backends: [
    {
      kind: "cloud-http",
      name: "cloud",
      endpoint: "https://cloud.example.com/attachments",
      tokenEnv: CLOUD_TOKEN_ENV,
    },
    {
      kind: "s3",
      name: "warm",
      bucket: "pi-attach-test",
      accessKeyEnv: S3_AK_ENV,
      secretKeyEnv: S3_SK_ENV,
    },
  ],
  write: "cloud",
});

/** 混合拓扑(含 local-fs)→ e2b 分支零注入 = 降级形态之一(Req 5.2 前提)。 */
const MIXED_TOPOLOGY = JSON.stringify({
  backends: [
    {
      kind: "cloud-http",
      name: "cloud",
      endpoint: "https://cloud.example.com/attachments",
      tokenEnv: CLOUD_TOKEN_ENV,
    },
    { kind: "local-fs", name: "local" },
  ],
  write: "cloud",
});

/** 全远程注入态会注入的附件键集合(差集断言的期望差)。 */
const ATTACHMENT_INJECTED_KEYS = [
  "PI_WEB_ATTACHMENT_BACKENDS",
  CLOUD_TOKEN_ENV,
  S3_AK_ENV,
  S3_SK_ENV,
] as const;

/** 每用例清空的 e2b 配置面(避免宿主 shell 环境渗漏;请求期逐次求值)。 */
const E2B_ENV_KEYS = [
  "PI_WEB_TRANSPORT",
  "E2B_API_KEY",
  "PI_WEB_E2B_TEMPLATE",
  "PI_WEB_E2B_TEMPLATE_MAP",
  "PI_WEB_E2B_TEMPLATE_DERIVE",
  "PI_WEB_E2B_TEMPLATE_DERIVE_TAG",
  "PI_WEB_E2B_DATAPLANE",
  "PI_WEB_E2B_ENV_PASSTHROUGH",
] as const;
for (const k of E2B_ENV_KEYS) delete process.env[k];
delete process.env.PI_WEB_ATTACHMENT_BACKENDS;

type CapturedTransport = {
  spec: { env?: Record<string, string> };
  config: { template?: string; envPassthrough?: readonly string[] };
};
const capturedE2b: CapturedTransport[] = [];
const capturedWs: CapturedTransport[] = [];
const capturedLocalSpecs: Array<{ env?: Record<string, string> }> = [];
/** 会话通道真实收到的 prompt 消息(断言 HTTP 200 确实穿透到 e2b 会话核心)。 */
const promptedMessages: string[] = [];

/**
 * 惰性通道:满足 PiSession 构造期订阅面(onEvent/onExtensionUIRequest/onExit/onLine/
 * onStderr)与收尾 close();不 spawn、不连网。相比 4.1/4.2 的 FakeChannel 额外实现
 * prompt/getCommands:打通 POST messages / GET commands 两条 HTTP 命令路径,使
 * 「降级态下对话与命令查询不受影响」可被端到端(HTTP→PiSession→channel)断言。
 */
class FakeChannel {
  onEvent(): () => void {
    return () => {};
  }
  onExtensionUIRequest(): () => void {
    return () => {};
  }
  onExit(): () => void {
    return () => {};
  }
  onLine(): () => void {
    return () => {};
  }
  onStderr(): () => void {
    return () => {};
  }
  respondExtensionUI(): void {}
  send(): void {}
  async prompt(message: string): Promise<unknown> {
    promptedMessages.push(message);
    return { type: "response", command: "prompt", success: true };
  }
  async getCommands(): Promise<unknown> {
    return {
      type: "response",
      command: "get_commands",
      success: true,
      data: { commands: [] },
    };
  }
  async close(): Promise<void> {}
}

vi.mock("@blksails/pi-web-server", async () => {
  const actual =
    await vi.importActual<typeof import("@blksails/pi-web-server")>("@blksails/pi-web-server");
  class CapturingE2bTransport {
    constructor(spec: CapturedTransport["spec"], config: CapturedTransport["config"]) {
      capturedE2b.push({ spec, config });
    }
  }
  class CapturingSandboxWsTransport {
    constructor(spec: CapturedTransport["spec"], config: CapturedTransport["config"]) {
      capturedWs.push({ spec, config });
    }
  }
  class FakePiRpcSession extends FakeChannel {
    constructor(_transport: unknown) {
      super();
    }
  }
  class FakePiRpcProcess extends FakeChannel {
    constructor(spec: { env?: Record<string, string> }) {
      super();
      capturedLocalSpecs.push(spec);
    }
  }
  return {
    ...actual,
    E2bTransport: CapturingE2bTransport,
    SandboxWsTransport: CapturingSandboxWsTransport,
    PiRpcSession: FakePiRpcSession,
    PiRpcProcess: FakePiRpcProcess,
  };
});

const { getHandler, shutdownHandler } = await import("@/lib/app/pi-handler");

/** pi-handler 的单例 pin 键(Symbol.for 全局注册表,测试可达)。 */
const HANDLER_KEY = Symbol.for("pi-web.app.handler");

/**
 * 以给定附件拓扑形态重建 handler 单例(装配期捕获拓扑判定 + passthroughEnv 快照),
 * 随后**删除**拓扑/凭据 env(反继承纪律,同 test/e2b-env-assembly.test.ts):此后
 * spawn env 里出现这些键只能来自装配期快照的显式注入。`undefined` = 未配拓扑形态。
 */
async function rebuildHandlerWithTopology(topologyRaw: string | undefined): Promise<void> {
  await shutdownHandler();
  delete (globalThis as unknown as Record<symbol, unknown>)[HANDLER_KEY];
  if (topologyRaw === undefined) delete process.env.PI_WEB_ATTACHMENT_BACKENDS;
  else process.env.PI_WEB_ATTACHMENT_BACKENDS = topologyRaw;
  process.env[CLOUD_TOKEN_ENV] = CLOUD_TOKEN_VALUE;
  process.env[S3_AK_ENV] = S3_AK_VALUE;
  process.env[S3_SK_ENV] = S3_SK_VALUE;
  getHandler(); // 装配期一次判定在此发生(与 attachmentStoreConfigFromEnv 同时机)
  delete process.env.PI_WEB_ATTACHMENT_BACKENDS;
  delete process.env[CLOUD_TOKEN_ENV];
  delete process.env[S3_AK_ENV];
  delete process.env[S3_SK_ENV];
}

async function createSession(): Promise<{ res: Response; sessionId: string }> {
  const res = await getHandler()(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ source: "builtin:default-agent" }),
    }),
  );
  let sessionId = "";
  if (res.status === 201) {
    const body = (await res.clone().json()) as { sessionId?: string };
    sessionId = body.sessionId ?? "";
  }
  return { res, sessionId };
}

function postMessage(sessionId: string, message: string): Promise<Response> {
  return getHandler()(
    new Request(`http://localhost/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  );
}

function getCommands(sessionId: string): Promise<Response> {
  return getHandler()(
    new Request(`http://localhost/api/sessions/${sessionId}/commands`, {
      method: "GET",
    }),
  );
}

/** 设置 e2b 会话请求期 env(选择器/配置在会话创建路径逐次求值)。 */
function enableE2b(extra: Partial<Record<(typeof E2B_ENV_KEYS)[number], string>> = {}): void {
  process.env.PI_WEB_TRANSPORT = "e2b";
  process.env.E2B_API_KEY = "test-key";
  process.env.PI_WEB_E2B_TEMPLATE = "tmpl-global";
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

beforeEach(() => {
  capturedE2b.length = 0;
  capturedWs.length = 0;
  capturedLocalSpecs.length = 0;
  promptedMessages.length = 0;
  for (const k of E2B_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of E2B_ENV_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

afterAll(async () => {
  await shutdownHandler();
  rmSync(ATTACH_DIR, { recursive: true, force: true });
});

describe("pi-handler e2b 分支 · 附件降级态下会话其余能力不受影响(sandbox-baked-agent-image 4.3,Req 5.3)", () => {
  it("降级态(未配拓扑)· envd:会话创建/模板解析/对话/命令查询全程不受附件缺失影响", async () => {
    await rebuildHandlerWithTopology(undefined);
    enableE2b({
      PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({
        "builtin:default-agent": "tmpl-degraded-envd",
      }),
    });

    // 1) 会话创建成功且传输构造完成——降级不阻断会话建立。
    const { res, sessionId } = await createSession();
    expect(res.status).toBe(201);
    expect(sessionId).not.toBe("");
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;
    // 降级前提成立:附件 env 确实零注入(否则测不到「降级态下」)。
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBeUndefined();
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBeUndefined();
    // 2) 模板解析照常生效(map 覆写不因附件降级失效)。
    expect(config.template).toBe("tmpl-degraded-envd");
    // 3) providerKeys(模型调用能力)不受附件判定影响。
    expect(spec.env?.OPENAI_API_KEY).toBe("test-openai-key");
    expect(config.envPassthrough ?? []).toContain("OPENAI_API_KEY");

    // 4) 对话链路:POST messages 200 且消息真实抵达会话通道。
    const promptRes = await postMessage(sessionId, "hello from degraded sandbox");
    expect(promptRes.status).toBe(200);
    expect(promptedMessages).toContain("hello from degraded sandbox");

    // 5) 命令/工具查询链路:GET commands 200(装配面查询不因附件缺失被拒)。
    const cmdRes = await getCommands(sessionId);
    expect(cmdRes.status).toBe(200);
    const cmdBody = (await cmdRes.json()) as { commands?: unknown[] };
    expect(Array.isArray(cmdBody.commands)).toBe(true);
  }, 20000);

  it("降级态(混合拓扑)· ws-runner 数据面:同一闭环不受附件降级影响(两数据面对称)", async () => {
    await rebuildHandlerWithTopology(MIXED_TOPOLOGY);
    enableE2b({ PI_WEB_E2B_DATAPLANE: "ws-runner" });

    const { res, sessionId } = await createSession();
    expect(res.status).toBe(201);
    expect(capturedWs).toHaveLength(1);
    expect(capturedE2b).toHaveLength(0);
    const { spec } = capturedWs[0]!;
    // 降级前提成立(混合拓扑 → 零注入)。
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBeUndefined();
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBeUndefined();

    const promptRes = await postMessage(sessionId, "hello via ws-runner degraded");
    expect(promptRes.status).toBe(200);
    expect(promptedMessages).toContain("hello via ws-runner degraded");

    const cmdRes = await getCommands(sessionId);
    expect(cmdRes.status).toBe(200);
  }, 20000);

  it("差集断言:降级态 vs 全远程注入态,spec.env/envPassthrough 只差附件键——其余装配 env 一字不动", async () => {
    // 注入态基准(全远程拓扑)。
    await rebuildHandlerWithTopology(ALL_REMOTE_TOPOLOGY);
    enableE2b();
    const remote = await createSession();
    expect(remote.res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const remoteSpecEnv = capturedE2b[0]!.spec.env ?? {};
    const remoteWl = capturedE2b[0]!.config.envPassthrough ?? [];

    // 降级态(未配拓扑),同一 source、同一 e2b 配置。
    capturedE2b.length = 0;
    await rebuildHandlerWithTopology(undefined);
    enableE2b();
    const degraded = await createSession();
    expect(degraded.res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const degradedSpecEnv = capturedE2b[0]!.spec.env ?? {};
    const degradedWl = capturedE2b[0]!.config.envPassthrough ?? [];

    // spec.env:键集差(注入态 − 降级态)恰好 = 附件键集合;降级态是注入态的子集。
    const remoteKeys = new Set(Object.keys(remoteSpecEnv));
    const degradedKeys = new Set(Object.keys(degradedSpecEnv));
    const missingInDegraded = [...remoteKeys].filter((k) => !degradedKeys.has(k)).sort();
    expect(missingInDegraded).toEqual([...ATTACHMENT_INJECTED_KEYS].sort());
    const extraInDegraded = [...degradedKeys].filter((k) => !remoteKeys.has(k));
    expect(extraInDegraded).toEqual([]);
    // 共有键的值逐一相同(降级不改动任何非附件 env 的值)。
    for (const k of degradedKeys) {
      expect(degradedSpecEnv[k], `spec.env[${k}] 两态应一致`).toBe(remoteSpecEnv[k]);
    }

    // envPassthrough 白名单:同样只差附件键。
    const remoteWlSet = new Set(remoteWl);
    const degradedWlSet = new Set(degradedWl);
    const wlMissing = [...remoteWlSet].filter((k) => !degradedWlSet.has(k)).sort();
    expect(wlMissing).toEqual([...ATTACHMENT_INJECTED_KEYS].sort());
    const wlExtra = [...degradedWlSet].filter((k) => !remoteWlSet.has(k));
    expect(wlExtra).toEqual([]);
  }, 30000);
});
