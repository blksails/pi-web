/**
 * 本地开源 agent-sandbox(E2B 兼容,与 ACS ack-sandbox-manager 同协议)集成测试。
 * 仅 `PI_WEB_E2B_LOCAL=1` 时运行;验证我们 e2b 传输配置在真实 E2B 兼容后端上的**控制面**
 * (Sandbox.create → kill)可达。
 *
 * 前置(见 pi-clouds real-machine-verification-checklist §8):
 *   kubectl -n agent-sandbox port-forward svc/agent-sandbox 10000:80 &
 *   node <scratchpad>/e2b-proxy.mjs           # :13000 -> :10000/e2b/v1, Host: localhost
 * 运行:
 *   PI_WEB_E2B_LOCAL=1 E2B_API_KEY=sys-... PI_WEB_E2B_TEMPLATE=aio \
 *   PI_WEB_E2B_DOMAIN=localhost:10000 PI_WEB_E2B_VALIDATE_API_KEY=false \
 *   PI_WEB_E2B_API_URL=http://127.0.0.1:13000 \
 *   npx vitest run test/rpc-channel/e2b-transport.local-sandbox.test.ts
 *
 * e2b JS SDK 2.x 三坑(固化进 beforeAll,与 pi-clouds 一致):
 *  1. SDK 不认 E2B_API_URL → monkeypatch ConnectionConfig.prototype.apiUrl 指本地反代。
 *  2. 不能开 E2B_DEBUG(会短路真实沙箱生命周期)。
 *  3. agent-sandbox 用 sys-* SYSTEM_TOKEN(非 e2b_ 格式)→ validateApiKey:false 由配置产出。
 *
 * ⚠ 数据面(commands.run stdin/stdout)不在本用例:e2b SDK 把 exec 路由到
 * `https://PORT-ID.domain`(getHost),本地 agent-sandbox 0.6.0 无对应 envd 路由/TLS 终止
 * (与 pi-clouds「里程碑 2:getHost 路由改写」同一缺口)。故 E2bTransport 完整 boot(create+run)
 * 在本地会止于 run 阶段;真机完整闭环(prompt→流式回复)需真实 e2b 云或补数据面代理。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Sandbox, ConnectionConfig } from "e2b";
import { e2bTransportConfigFromEnv } from "../../src/rpc-channel/e2b-config.js";

const RUN = process.env.PI_WEB_E2B_LOCAL === "1";
const proxyApiUrl = process.env.PI_WEB_E2B_API_URL ?? "http://127.0.0.1:13000";

describe.skipIf(!RUN)("E2B 传输控制面 @ 本地 agent-sandbox", () => {
  beforeAll(() => {
    process.env.E2B_DEBUG = "false";
    // 坑1:强制 apiUrl 指向本地反代(SDK 非 debug 下会算 https://api.${domain})。
    Object.defineProperty(ConnectionConfig.prototype, "apiUrl", {
      configurable: true,
      get() {
        return proxyApiUrl;
      },
      set() {
        /* 忽略 SDK 计算值 */
      },
    });
  });

  it("配置助手产出的 opts 能在真实后端 create → kill(不泄漏沙箱)", async () => {
    const cfg = e2bTransportConfigFromEnv(process.env);
    // domain/validateApiKey 应由 env 正确解析(自托管 sys-* token 路径)。
    expect(cfg.validateApiKey).toBe(false);
    expect(cfg.domain).toBeTruthy();

    const sbx = await Sandbox.create(cfg.template, {
      apiKey: cfg.apiKey,
      domain: cfg.domain,
      validateApiKey: cfg.validateApiKey,
      timeoutMs: 60_000,
    });
    expect(sbx.sandboxId).toBeTruthy();
    // 真删,断言不泄漏(Req 5.3 的控制面等价)。
    const killed = await sbx.kill();
    expect(killed).toBe(true);
    // kill 后 connect 应为「不存在」。
    await expect(
      Sandbox.connect(sbx.sandboxId, {
        apiKey: cfg.apiKey,
        domain: cfg.domain,
        validateApiKey: cfg.validateApiKey,
      }),
    ).rejects.toBeTruthy();
  }, 120_000);
});
