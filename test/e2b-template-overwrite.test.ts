// @vitest-environment node
/**
 * Integration: e2b 分支的三级沙箱模板解析接线(spec sandbox-baked-agent-image,
 * 任务 4.1;Req 3.1/3.4/3.5)——`lib/app/pi-handler.ts` createChannel e2b 段。
 *
 * 断言面:
 *  - map 命中(rawSource=opts.source 键)→ 会话创建成功且传输构造收到**覆写后的 template**
 *    (via resolveSandboxTemplate;旧「临时终判」桥只认全局 PI_WEB_E2B_TEMPLATE,此用例 RED)。
 *  - envd(E2bTransport)与 ws-runner(SandboxWsTransport)两数据面同享覆写。
 *  - 三级全空 → 会话创建失败(500),抛出的错误文案含三种修复路径(MAP / DERIVE / 全局
 *    TEMPLATE;经 mapEngineError 的 console.error 捕获——HTTP 体按既有语义不泄露细节)。
 *  - 全局模板既有部署(仅 PI_WEB_E2B_TEMPLATE)行为不变(Req 3.5 向后兼容)。
 *  - local 分支零变化:未设 PI_WEB_TRANSPORT 时仍走 PiRpcProcess,不触任何 e2b 传输
 *    (Req 3.5)。
 *
 * 可测性:e2b 传输构造有真实副作用(沙箱创建),故 mock `@blksails/pi-web-server` 把
 * E2bTransport/SandboxWsTransport 换成捕获构造参数的假类,PiRpcSession/PiRpcProcess 换成
 * 惰性 FakeChannel(满足 PiSession 构造期订阅面,不 spawn/不连网)。selectTransport 与
 * resolveSandboxTemplate 直接读 process.env(会话创建路径逐次求值),故各用例在请求前
 * 就地翻 env,不需重建 handler 单例。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-e2b-template-test-"));

// 装配期 env(handler 单例首次 import 前钉住)。
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = "e2b-template-overwrite-test-secret-0123456789";
process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE = "1";
process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY = "1";
delete process.env.PI_WEB_STUB_AGENT;

/** 每用例清空的 e2b 配置面(避免宿主 shell 环境渗漏)。 */
const E2B_ENV_KEYS = [
  "PI_WEB_TRANSPORT",
  "E2B_API_KEY",
  "PI_WEB_E2B_TEMPLATE",
  "PI_WEB_E2B_TEMPLATE_MAP",
  "PI_WEB_E2B_TEMPLATE_DERIVE",
  "PI_WEB_E2B_TEMPLATE_DERIVE_TAG",
  "PI_WEB_E2B_DATAPLANE",
] as const;
for (const k of E2B_ENV_KEYS) delete process.env[k];

type CapturedTransport = {
  spec: { env?: Record<string, string> };
  config: { template?: string };
};
const capturedE2b: CapturedTransport[] = [];
const capturedWs: CapturedTransport[] = [];
const capturedLocalSpecs: unknown[] = [];

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
    constructor(spec: unknown) {
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

function createSession(): Promise<Response> {
  return getHandler()(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ source: "builtin:default-agent" }),
    }),
  );
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

describe("pi-handler e2b 分支 · 三级模板解析接线(sandbox-baked-agent-image 4.1)", () => {
  it("map 命中(source 串键)→ 会话创建成功且 E2bTransport 收到映射模板(Req 3.1)", async () => {
    process.env.PI_WEB_TRANSPORT = "e2b";
    process.env.E2B_API_KEY = "test-key";
    process.env.PI_WEB_E2B_TEMPLATE_MAP = JSON.stringify({
      "builtin:default-agent": "tmpl-mapped",
    });

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    expect(capturedE2b[0]!.config.template).toBe("tmpl-mapped");
    expect(capturedWs).toHaveLength(0);
    expect(capturedLocalSpecs).toHaveLength(0);
  }, 15000);

  it("ws-runner 数据面同享覆写:SandboxWsTransport 收到映射模板(Req 3.1)", async () => {
    process.env.PI_WEB_TRANSPORT = "e2b";
    process.env.E2B_API_KEY = "test-key";
    process.env.PI_WEB_E2B_DATAPLANE = "ws-runner";
    process.env.PI_WEB_E2B_TEMPLATE_MAP = JSON.stringify({
      "builtin:default-agent": "tmpl-mapped-ws",
    });

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedWs).toHaveLength(1);
    expect(capturedWs[0]!.config.template).toBe("tmpl-mapped-ws");
    expect(capturedE2b).toHaveLength(0);
  }, 15000);

  it("三级全空 → 会话创建失败(500)且错误含三种修复路径(Req 3.4)", async () => {
    process.env.PI_WEB_TRANSPORT = "e2b";
    process.env.E2B_API_KEY = "test-key";
    // 不设 TEMPLATE / TEMPLATE_MAP / TEMPLATE_DERIVE。

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createSession();
    expect(res.status).toBe(500);
    // mapEngineError 把根因打到 stderr;在此断言抛出的错误文案含三种修复路径。
    const logged = errSpy.mock.calls
      .map((args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
      .join("\n");
    expect(logged).toContain("PI_WEB_E2B_TEMPLATE_MAP");
    expect(logged).toContain("PI_WEB_E2B_TEMPLATE_DERIVE");
    expect(logged).toContain("PI_WEB_E2B_TEMPLATE");
    // 失败即不构造任何传输(不静默回退 local)。
    expect(capturedE2b).toHaveLength(0);
    expect(capturedWs).toHaveLength(0);
    expect(capturedLocalSpecs).toHaveLength(0);
  }, 15000);

  it("仅配全局模板的既有部署行为不变(Req 3.5 向后兼容)", async () => {
    process.env.PI_WEB_TRANSPORT = "e2b";
    process.env.E2B_API_KEY = "test-key";
    process.env.PI_WEB_E2B_TEMPLATE = "tmpl-global";

    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedE2b).toHaveLength(1);
    expect(capturedE2b[0]!.config.template).toBe("tmpl-global");
  }, 15000);

  it("local 分支零变化:未设 PI_WEB_TRANSPORT 走 PiRpcProcess,不触 e2b 传输(Req 3.5)", async () => {
    const res = await createSession();
    expect(res.status).toBe(201);
    expect(capturedLocalSpecs).toHaveLength(1);
    expect(capturedE2b).toHaveLength(0);
    expect(capturedWs).toHaveLength(0);
  }, 15000);
});
