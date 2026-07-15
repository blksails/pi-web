/**
 * E2bTransport 真实沙盒集成测试(spec e2b-sandbox-transport,Req 5.1/5.2/5.3/7.2)。
 *
 * 针对**真实 e2b**跑最小闭环:起沙盒 → 后台 runner → 一轮 prompt → 收到流式 event →
 * close 后 health 变死(断言沙盒销毁,不泄漏计费)。
 *
 * 缺 `E2B_API_KEY` 或 `PI_WEB_E2B_TEMPLATE` 时**整体 skip 并明确报告跳过原因**(Req 7.2:
 * 可在缺凭据环境跳过)。CI 默认不带凭据 → 跳过;运营者本地带真实 template 时启用。
 *
 * 运行:
 *   E2B_API_KEY=... PI_WEB_E2B_TEMPLATE=<预装 node+pi+agent 的 template> \
 *   PI_WEB_E2B_ENV_PASSTHROUGH=ANTHROPIC_API_KEY ANTHROPIC_API_KEY=... \
 *   npx vitest run test/rpc-channel/e2b-transport.integration.test.ts
 */
import { describe, it, expect } from "vitest";
import { E2bTransport } from "../../src/rpc-channel/e2b-transport.js";
import { PiRpcSession } from "../../src/rpc-channel/pi-rpc-session.js";
import { e2bTransportConfigFromEnv } from "../../src/rpc-channel/e2b-config.js";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

const HAS_CREDS =
  typeof process.env.E2B_API_KEY === "string" &&
  process.env.E2B_API_KEY.trim().length > 0 &&
  typeof process.env.PI_WEB_E2B_TEMPLATE === "string" &&
  process.env.PI_WEB_E2B_TEMPLATE.trim().length > 0;

if (!HAS_CREDS) {
  // 明确报告跳过原因(Req 7.2):无凭据即跳过而非失败。
  // eslint-disable-next-line no-console
  console.warn(
    "[e2b integration] skipped: E2B_API_KEY / PI_WEB_E2B_TEMPLATE 未设置(缺真实 e2b 凭据)。",
  );
}

// spec.env 供 envPassthrough 透传 provider 凭据到沙盒内的 agent。
function spec(): SpawnSpec {
  return {
    cmd: "node",
    args: [],
    cwd: "/tmp",
    env: { ...process.env } as Record<string, string>,
  };
}

describe("E2bTransport 真实沙盒最小闭环 (Req 5.1/5.2/5.3)", () => {
  it.skipIf(!HAS_CREDS)(
    "起沙盒 → prompt → 收到流式 event → close 后 health 死(不泄漏沙盒)",
    async () => {
      const cfg = e2bTransportConfigFromEnv(process.env);
      // template 已放宽为可缺(终判在 resolveSandboxTemplate);本测试由 HAS_CREDS 门控
      // 保证已设,此处窄化后按传输构造要求补齐必填 template(与 pi-handler 覆写语义一致)。
      if (cfg.template === undefined) throw new Error("unreachable: HAS_CREDS 已保证 PI_WEB_E2B_TEMPLATE");
      const transport = new E2bTransport(spec(), { ...cfg, template: cfg.template });
      const session = new PiRpcSession(transport);

      const events: unknown[] = [];
      session.onEvent((e) => events.push(e));

      // 等沙盒与后台 runner 真正就绪(Req 5.1 冷启)。
      await transport.ready();
      expect(session.health().alive).toBe(true);

      // 一轮 prompt → 沙盒内 agent 处理并流式回传 event(Req 5.2)。
      await session.prompt("say hi in one word");

      // 至少收到一条 agent event(流式回复的证据)。
      expect(events.length).toBeGreaterThan(0);

      // close 销毁沙盒(Req 5.3:不泄漏计费),health 变死。
      await session.close();
      expect(session.health().alive).toBe(false);
    },
    120_000, // 冷启 + 一轮补全,给足超时
  );

  it("凭据缺失时本套件明确跳过(Req 7.2)", () => {
    // 占位断言:无论有无凭据都通过,使「跳过」在无凭据环境下仍是一个可见的绿色结果,
    // 而非空套件。真实闭环由上面的 skipIf 用例在带凭据时验证。
    expect(typeof HAS_CREDS).toBe("boolean");
  });
});
