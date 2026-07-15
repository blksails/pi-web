// @vitest-environment node
/**
 * Integration: e2b 分支附件拓扑条件透传与凭据白名单并入(spec sandbox-baked-agent-image,
 * 任务 4.2;Req 4.2/5.1/5.2)——`lib/app/pi-handler.ts` createChannel e2b 段的 env 组装。
 *
 * 断言面(三种拓扑形态 × env 组装行为):
 *  - 全远程拓扑(全部 backend.kind ∈ {cloud-http, s3})→ attachmentPassthroughEnv
 *    (拓扑原文 + 被引凭据)并入 e2bSpec.env,且其键并入传输 config.envPassthrough
 *    白名单(Req 5.1);envd 与 ws-runner 两数据面同享。
 *  - 混合拓扑(含 local-fs)/ 未配拓扑 → 附件 env **完全不注入**(零键;沙箱内子进程
 *    走既有 fail-closed 附件降级,Req 5.2)。
 *  - providerKeys 键**无条件**并入 envPassthrough(值已在 e2bSpec.env;不受附件判定
 *    影响,Req 4.2);与既有 PI_WEB_E2B_ENV_PASSTHROUGH 配置合并去重。
 *  - local 分支零变化:混合拓扑下本地 spawn 仍无条件注入拓扑透传(既有行为,Req 5.3)。
 *
 * 可测性:跟随 test/e2b-template-overwrite.test.ts 的 mock 技术(捕获传输构造参数)。
 * 拓扑判定与 attachmentPassthroughEnv 均为**装配期快照**(与 attachmentStoreConfigFromEnv
 * 同一时机),故各拓扑形态需重建 handler 单例(shutdown + 删 globalThis pin + 重设
 * PI_WEB_ATTACHMENT_BACKENDS 后再 getHandler)。单例建成后立刻删除拓扑/凭据 env
 * (反继承纪律,同 attachment-backends-spawn-env.test.ts):resolved.spawnSpec.env 在
 * 请求期展开 process.env,删掉后 spawn env 里再出现这些键只能来自装配期快照的显式注入
 * ——这同时钉住「判定在装配期做一次、不在请求期现读 env」的设计约束。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-e2b-env-assembly-test-"));

// 装配期 env(handler 单例首次 import 前钉住)。
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = "e2b-env-assembly-test-secret-0123456789";
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

/** 全远程拓扑:cloud-http + s3(两种远程 kind 都覆盖),无 local-fs。 */
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

/** 混合拓扑:含 local-fs → e2b 分支必须完全不注入(Req 5.2)。 */
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

/**
 * 惰性通道:满足 PiSession 构造期的订阅面(onEvent/onExtensionUIRequest/onExit/onLine/
 * onStderr)与收尾 close();不 spawn、不连网。readiness 握手已经 env 关闭,无探针调用。
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
 * 随后**删除**拓扑/凭据 env:此后 spawn env 里出现这些键只能来自装配期快照的显式注入
 * (反继承纪律)。`topologyRaw === undefined` = 未配拓扑形态。
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

function createSession(): Promise<Response> {
  return getHandler()(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ source: "builtin:default-agent" }),
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

describe("pi-handler e2b 分支 · 附件拓扑条件透传 + 凭据白名单(sandbox-baked-agent-image 4.2)", () => {
  it("全远程拓扑:passthroughEnv 并入 e2bSpec.env 且键并入 envPassthrough(Req 5.1)", async () => {
    await rebuildHandlerWithTopology(ALL_REMOTE_TOPOLOGY);
    enableE2b();

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;
    // 拓扑原文 + 被引凭据值来自装配期快照的显式注入(process.env 已删,继承不可能满足)。
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBe(ALL_REMOTE_TOPOLOGY);
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBe(CLOUD_TOKEN_VALUE);
    expect(spec.env?.[S3_AK_ENV]).toBe(S3_AK_VALUE);
    expect(spec.env?.[S3_SK_ENV]).toBe(S3_SK_VALUE);
    // 注入键并入传输白名单(E2bTransport 只下发白名单键,缺这步值到不了沙箱)。
    const wl = config.envPassthrough ?? [];
    expect(wl).toContain("PI_WEB_ATTACHMENT_BACKENDS");
    expect(wl).toContain(CLOUD_TOKEN_ENV);
    expect(wl).toContain(S3_AK_ENV);
    expect(wl).toContain(S3_SK_ENV);
  }, 20000);

  it("全远程拓扑 · ws-runner 数据面同享注入(Req 5.1)", async () => {
    await rebuildHandlerWithTopology(ALL_REMOTE_TOPOLOGY);
    enableE2b({ PI_WEB_E2B_DATAPLANE: "ws-runner" });

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedWs).toHaveLength(1);
    expect(capturedE2b).toHaveLength(0);
    const { spec, config } = capturedWs[0]!;
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBe(ALL_REMOTE_TOPOLOGY);
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBe(CLOUD_TOKEN_VALUE);
    const wl = config.envPassthrough ?? [];
    expect(wl).toContain("PI_WEB_ATTACHMENT_BACKENDS");
    expect(wl).toContain(CLOUD_TOKEN_ENV);
  }, 20000);

  it("providerKeys 键无条件并入 envPassthrough,并与既有配置合并去重(Req 4.2)", async () => {
    await rebuildHandlerWithTopology(ALL_REMOTE_TOPOLOGY);
    // 既有 CSV 白名单里已含 OPENAI_API_KEY(重复来源)+ 一个自定义键。
    enableE2b({ PI_WEB_E2B_ENV_PASSTHROUGH: "OPENAI_API_KEY,MY_EXTRA_VAR" });

    const res = await createSession();
    expect(res.status).toBe(201);
    const wl = capturedE2b[0]!.config.envPassthrough ?? [];
    // providerKeys 值本就在 e2bSpec.env(既有代码),键并入白名单后才真正可达沙箱。
    expect(wl).toContain("OPENAI_API_KEY");
    expect(wl.filter((k) => k === "OPENAI_API_KEY")).toHaveLength(1);
    // 既有配置键保留,不被覆盖。
    expect(wl).toContain("MY_EXTRA_VAR");
  }, 20000);

  it("混合拓扑(含 local-fs):附件 env 零注入,providerKeys 键仍并入白名单(Req 5.2/4.2)", async () => {
    await rebuildHandlerWithTopology(MIXED_TOPOLOGY);
    enableE2b();

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;
    // 完全不注入:拓扑原文与被引凭据一个键都不出现(沙箱内走既有 fail-closed 降级)。
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBeUndefined();
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBeUndefined();
    const wl = config.envPassthrough ?? [];
    expect(wl).not.toContain("PI_WEB_ATTACHMENT_BACKENDS");
    expect(wl).not.toContain(CLOUD_TOKEN_ENV);
    // providerKeys 白名单并入不受附件判定影响(无条件)。
    expect(wl).toContain("OPENAI_API_KEY");
  }, 20000);

  it("未配拓扑:附件 env 零注入,providerKeys 键仍并入白名单(Req 5.2/4.2)", async () => {
    await rebuildHandlerWithTopology(undefined);
    enableE2b();

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBeUndefined();
    const wl = config.envPassthrough ?? [];
    expect(wl).not.toContain("PI_WEB_ATTACHMENT_BACKENDS");
    expect(wl).toContain("OPENAI_API_KEY");
  }, 20000);

  it("local 分支零变化:混合拓扑下本地 spawn 仍无条件注入拓扑透传(既有行为,Req 5.3)", async () => {
    await rebuildHandlerWithTopology(MIXED_TOPOLOGY);
    // 不设 PI_WEB_TRANSPORT → local 分支 PiRpcProcess。

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedLocalSpecs).toHaveLength(1);
    expect(capturedE2b).toHaveLength(0);
    expect(capturedWs).toHaveLength(0);
    const spec = capturedLocalSpecs[0]!;
    // 本地子进程与主进程同机共享后端,混合拓扑照样透传(4.2 的条件判定只作用于 e2b 分支)。
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBe(MIXED_TOPOLOGY);
    expect(spec.env?.[CLOUD_TOKEN_ENV]).toBe(CLOUD_TOKEN_VALUE);
  }, 20000);
});
