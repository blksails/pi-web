// @vitest-environment node
/**
 * Integration: e2b 分支的 aigc key 代理注入切换 + routes 装配(spec aigc-key-proxy,
 * 任务 4.2;Req 1.1/1.2/1.3/1.4/4.1)——`lib/app/pi-handler.ts` createChannel e2b 段
 * 与 `routes` 数组的 createAigcProxyRoutes 接线。
 *
 * 断言面:
 *  - 代理模式(PI_WEB_AIGC_PROXY_PUBLIC_BASE 合法配置):e2bSpec.env 与 envPassthrough
 *    均不含三真实网关键的**值**(三个 `*_API_KEY` 均替换为同一枚会话短期 token,可经
 *    verifySessionToken 验证、sessionId 与会话一致);六个网关键(BASE_URL×3 +
 *    API_KEY×3)在两者中都出现(Req 1.1, 4.1)。
 *  - 兼容模式(未配置):env 组装逐键与现状一致(含三真实键的真实值),额外记一条含
 *    "aigc-proxy" 标识的警告日志(Req 1.2)。
 *  - 非法地址:会话创建路径以 500 失败,错误文案含变量名与修复指引(Req 1.4)。
 *  - local 分支回归:配置代理与否,local 分支 spawnSpec 组装结果逐键一致(负向断言,
 *    Req 1.3)。
 *  - routes 装配:仅当 config.aigcProxyPublicBase 非空时才注册 `/aigc-proxy/:provider/*`
 *    (未注册时打到既有 404;注册后未带 token 的请求命中 401,证明路由确已生效)。
 *
 * 可测性:跟随 test/e2b-env-assembly.test.ts 的 mock 技术(捕获传输构造参数、惰性
 * FakeChannel)。resolveAigcProxyConfig/resolveAigcProxySecret/mintSessionToken 均在
 * **会话创建路径**读取 process.env,故 env 注入面的用例可直接逐用例翻转 env,无需重建
 * handler 单例;仅 routes 装配面(config.aigcProxyPublicBase 是装配期快照)需要重建。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-aigc-proxy-injection-test-"));
const AIGC_SECRET = "aigc-proxy-injection-test-secret-0123456789";

// 装配期 env(handler 单例首次 import 前钉住)。
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = AIGC_SECRET;
process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE = "1";
process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY = "1";
// 兼容模式警告日志走主进程 logger(默认 enabled=false);开启后经 stderr sentinel 断言。
process.env.PI_WEB_LOG_ENABLED = "1";
delete process.env.PI_WEB_STUB_AGENT;
delete process.env.PI_WEB_AIGC_PROXY_PUBLIC_BASE;

// providerKeys 面(装配期 loadConfig 捕获):清空宿主渗漏,只留受控的三个网关真实 key
// (真实值绝不能出现在代理模式的 e2bSpec.env / envPassthrough 里)。
const OTHER_PROVIDER_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "APISERVICES_API_KEY",
] as const;
for (const k of OTHER_PROVIDER_KEY_NAMES) delete process.env[k];
const REAL_NEWAPI_KEY = "sk-real-newapi-secret-0123456789";
const REAL_SUFY_KEY = "sk-real-sufy-secret-0123456789";
const REAL_DASHSCOPE_KEY = "sk-real-dashscope-secret-0123456789";
process.env.NEWAPI_API_KEY = REAL_NEWAPI_KEY;
process.env.SUFY_API_KEY = REAL_SUFY_KEY;
process.env.DASHSCOPE_API_KEY = REAL_DASHSCOPE_KEY;

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
  "PI_WEB_AIGC_PROXY_PUBLIC_BASE",
  "PI_WEB_AIGC_PROXY_TOKEN_TTL_MS",
] as const;
for (const k of E2B_ENV_KEYS) delete process.env[k];

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
const { verifySessionToken } = await import("@blksails/pi-web-server");

/** pi-handler 的单例 pin 键(Symbol.for 全局注册表,测试可达)。 */
const HANDLER_KEY = Symbol.for("pi-web.app.handler");

/**
 * 以给定 aigc 代理配置重建 handler 单例(config.aigcProxyPublicBase 是装配期快照,
 * 只影响 routes 数组是否注册代理路由;createChannel e2b 分支的注入切换在请求期读取
 * process.env,无需重建即可逐用例翻转,见下方 enableE2b/setAigcProxyPublicBase)。
 */
async function rebuildHandlerWithAigcProxyBase(base: string | undefined): Promise<void> {
  await shutdownHandler();
  delete (globalThis as unknown as Record<symbol, unknown>)[HANDLER_KEY];
  if (base === undefined) delete process.env.PI_WEB_AIGC_PROXY_PUBLIC_BASE;
  else process.env.PI_WEB_AIGC_PROXY_PUBLIC_BASE = base;
  getHandler();
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

describe("pi-handler e2b 分支 · aigc key 代理注入切换(aigc-key-proxy 4.2)", () => {
  it("代理模式:e2bSpec.env / envPassthrough 均无真实 key 值,六键均出现,三 *_API_KEY 为同一合法 token(Req 1.1, 4.1)", async () => {
    enableE2b({ PI_WEB_AIGC_PROXY_PUBLIC_BASE: "http://proxy.example.com" });

    const res = await createSession();
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;

    // 六键均出现(BASE_URL ×3 + API_KEY ×3)。
    expect(spec.env?.NEWAPI_BASE_URL).toBe("http://proxy.example.com/api/aigc-proxy/newapi");
    expect(spec.env?.SUFY_BASE_URL).toBe("http://proxy.example.com/api/aigc-proxy/sufy");
    expect(spec.env?.DASHSCOPE_BASE_URL).toBe(
      "http://proxy.example.com/api/aigc-proxy/dashscope",
    );
    const token = spec.env?.NEWAPI_API_KEY;
    expect(token).toBeDefined();
    expect(token).toMatch(/^pwap1\./);
    // 三个 *_API_KEY 均替换为同一枚 token,而非各自的真实 key。
    expect(spec.env?.SUFY_API_KEY).toBe(token);
    expect(spec.env?.DASHSCOPE_API_KEY).toBe(token);
    expect(token).not.toBe(REAL_NEWAPI_KEY);
    expect(token).not.toBe(REAL_SUFY_KEY);
    expect(token).not.toBe(REAL_DASHSCOPE_KEY);
    // token 可验、sessionId 与会话一致。
    const verified = verifySessionToken({ token: token as string, secret: AIGC_SECRET });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.sessionId).toBe(sessionId);
    // 真实 key 值不出现在 env 的任何位置。
    const envValues = Object.values(spec.env ?? {});
    expect(envValues).not.toContain(REAL_NEWAPI_KEY);
    expect(envValues).not.toContain(REAL_SUFY_KEY);
    expect(envValues).not.toContain(REAL_DASHSCOPE_KEY);

    // envPassthrough 白名单同步:六键名并入,真实键值当然也不在白名单里出现(白名单只装键名,
    // 这里额外断言键名本身也确实并入,否则值到不了沙箱)。
    const wl = config.envPassthrough ?? [];
    for (const name of [
      "NEWAPI_BASE_URL",
      "NEWAPI_API_KEY",
      "SUFY_BASE_URL",
      "SUFY_API_KEY",
      "DASHSCOPE_BASE_URL",
      "DASHSCOPE_API_KEY",
    ]) {
      expect(wl).toContain(name);
    }
  }, 20000);

  it("兼容模式:未配置时 env 组装与现状一致(真实 key 原样透传),并记一条含 aigc-proxy 标识的警告日志(Req 1.2)", async () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    enableE2b(); // 不设 PI_WEB_AIGC_PROXY_PUBLIC_BASE。

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    const { spec, config } = capturedE2b[0]!;
    // 现状行为:真实 key 原样出现。
    expect(spec.env?.NEWAPI_API_KEY).toBe(REAL_NEWAPI_KEY);
    expect(spec.env?.SUFY_API_KEY).toBe(REAL_SUFY_KEY);
    expect(spec.env?.DASHSCOPE_API_KEY).toBe(REAL_DASHSCOPE_KEY);
    expect(spec.env?.NEWAPI_BASE_URL).toBeUndefined();
    const wl = config.envPassthrough ?? [];
    expect(wl).toContain("NEWAPI_API_KEY");
    expect(wl).toContain("SUFY_API_KEY");
    expect(wl).toContain("DASHSCOPE_API_KEY");

    // 警告日志:走 stderr sentinel,含可检索标识 "aigc-proxy"。
    const logged = writeSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("aigc-proxy");
  }, 20000);

  it("非法地址:会话创建以 500 失败,错误含变量名与修复指引(Req 1.4)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    enableE2b({ PI_WEB_AIGC_PROXY_PUBLIC_BASE: "not-a-valid-url" });

    const res = await createSession();
    expect(res.status).toBe(500);
    expect(capturedE2b).toHaveLength(0);
    const logged = errSpy.mock.calls
      .map((args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
      .join("\n");
    expect(logged).toContain("PI_WEB_AIGC_PROXY_PUBLIC_BASE");
  }, 20000);

  it("local 分支回归:配置代理与否,local 分支 spawnSpec 组装结果逐键一致(负向断言,Req 1.3)", async () => {
    // 不设 PI_WEB_TRANSPORT → local 分支 PiRpcProcess;先跑一次未配置代理。
    const resWithout = await createSession();
    expect(resWithout.status).toBe(201);
    expect(capturedLocalSpecs).toHaveLength(1);
    const specWithout = capturedLocalSpecs[0]!;

    capturedLocalSpecs.length = 0;
    process.env.PI_WEB_AIGC_PROXY_PUBLIC_BASE = "http://proxy.example.com";
    const resWith = await createSession();
    expect(resWith.status).toBe(201);
    expect(capturedLocalSpecs).toHaveLength(1);
    const specWith = capturedLocalSpecs[0]!;

    // 逐键一致(sessionId 不同故排除会话身份/资源相关键之外全等;这里直接比较真实 key 值,
    // 代理配置存在与否都不影响 local 分支——它压根不读这条配置)。
    expect(specWith.env?.NEWAPI_API_KEY).toBe(specWithout.env?.NEWAPI_API_KEY);
    expect(specWith.env?.SUFY_API_KEY).toBe(specWithout.env?.SUFY_API_KEY);
    expect(specWith.env?.DASHSCOPE_API_KEY).toBe(specWithout.env?.DASHSCOPE_API_KEY);
    expect(specWith.env?.NEWAPI_API_KEY).toBe(REAL_NEWAPI_KEY);
    expect(specWith.env?.NEWAPI_BASE_URL).toBeUndefined();
  }, 20000);
});

describe("pi-handler routes 数组 · createAigcProxyRoutes 装配(aigc-key-proxy 4.2)", () => {
  it("未配置代理地址时不注册代理路由(打到既有 404)", async () => {
    await rebuildHandlerWithAigcProxyBase(undefined);
    const res = await getHandler()(
      new Request("http://localhost/api/aigc-proxy/newapi/v1/images", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  }, 20000);

  it("配置代理地址后注册代理路由(缺 token 命中 401,证明路由已生效而非 404)", async () => {
    await rebuildHandlerWithAigcProxyBase("http://proxy.example.com");
    const res = await getHandler()(
      new Request("http://localhost/api/aigc-proxy/newapi/v1/images", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  }, 20000);
});
