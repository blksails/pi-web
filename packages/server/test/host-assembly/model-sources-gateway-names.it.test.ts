/**
 * host-assembly · 网关失败文案的来源判据 —— 经**真实生产 registrar**验证
 * (spec multi-gateway-providers,任务 3.7,Req 6.5)。
 *
 * **为什么本文件必须存在,而不是只靠 `packages/runner/test/runner/
 * option-mapper-gateway-names.it.test.ts`**:那个文件里的 `ModelSourceRegistrar` 是
 * 测试专造的假实现 —— 它证明 option-mapper 这一**消费侧机制**是对的,但不证明
 * `declaredProviderNamesFromEnv` 真的接进了全仓唯一的生产注册点
 * (`packages/server/src/host-assembly/model-sources.ts` 的
 * `registerBuiltinModelSources()`)。上一轮正是卡在这里:契约声明了、消费侧接线了,
 * 唯独生产 registrar 没实现该方法,于是生产环境里判据仍恒为 `undefined`。
 *
 * 场景:部署侧声明了两个网关实例(`PI_WEB_GATEWAYS=cloudflare,blksails-ai`),但**不给**
 * 任何会话侧三件套 —— 模拟「网关套件已声明但凭据缺失 / 会话侧未注册」,这正是失败文案
 * 本身列出的头号成因。`resolveAiGatewaySessionSpecsFromEnv` 在此场景下必返回空数组,
 * `resolveSpecFromEnv` 因而返回 `undefined`,`gatewayResolvedEntry` 不存在 —— 判据只能
 * 靠 `declaredProviderNamesFromEnv` 才能命中。
 *
 * ★ 报红证明(执行记录见任务交付说明):把 `model-sources.ts` 里的
 *   `declaredProviderNamesFromEnv` 一项删掉重跑本文件,第一个 `it` 必须转红
 *   (`cloudflare`/`blksails-ai` 会退回裸文案,断言 `/ai-gateway 目录/` 落空)。
 *
 * 经 `buildRuntimeFactory` 的公开路径驱动(与 `option-mapper-model-source.it.test.ts`/
 * `option-mapper-gateway-names.it.test.ts` 同惯例;`resolveModel`/`gatewayProviderNames`
 * 均为 runner 模块私有,不可直调)。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntimeFactory } from "@blksails/pi-web-runner/runner/option-mapper.js";
import { resetModelSourcesForTest } from "@blksails/pi-web-runner/runner/model-source-registrar.js";
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
import { registerBuiltinModelSources } from "../../src/host-assembly/model-sources.js";

/** 本用例会触碰的全部网关 env 名(部署侧 + 会话侧),测试前后逐一存/还原。 */
const TOUCHED_ENV_NAMES = [
  "PI_WEB_GATEWAYS",
  "PI_WEB_AI_GATEWAY_SESSIONS",
  "PI_WEB_AI_GATEWAY_SESSION_BASE",
  "PI_WEB_AI_GATEWAY_SESSION_KEY",
  "PI_WEB_AI_GATEWAY_SESSION_MODELS",
  "BLKSAILS_GATEWAY_BASE_URL",
  "AI_GATEWAY_BASE_URL",
] as const;

async function attemptBuild(provider: string, modelId: string, agentDir: string) {
  const factory = buildRuntimeFactory(
    { name: "t", model: { provider, modelId } } as never,
    async () => "trusted" as never,
  );
  return await factory({
    cwd: agentDir,
    agentDir,
    sessionManager: undefined as never,
  } as never);
}

describe("registerBuiltinModelSources — 网关失败文案的来源判据(真实 registrar,任务 3.7,Req 6.5)", () => {
  let agentDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-server-gwnames-"));
    savedEnv = {};
    for (const name of TOUCHED_ENV_NAMES) savedEnv[name] = process.env[name];
    for (const name of TOUCHED_ENV_NAMES) delete process.env[name];
    resetModelSourcesForTest();
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    for (const name of TOUCHED_ENV_NAMES) {
      const value = savedEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetModelSourcesForTest();
  });

  it("PI_WEB_GATEWAYS 声明两实例,会话侧三件套全缺(凭据缺失场景) → 非缺省实例名仍得到来源专属文案", async () => {
    process.env.PI_WEB_GATEWAYS = "cloudflare,blksails-ai";
    registerBuiltinModelSources();

    await expect(
      attemptBuild("cloudflare", "nonexistent-model", agentDir),
    ).rejects.toThrow(/ai-gateway 目录/);
    await expect(
      attemptBuild("cloudflare", "nonexistent-model", agentDir),
    ).rejects.toThrow(/常见成因/);
    await expect(
      attemptBuild("blksails-ai", "nonexistent-model", agentDir),
    ).rejects.toThrow(/ai-gateway 目录/);
  });

  it("同一场景下,不在声明集合里的 provider 名仍退回裸文案(判据是成员测试)", async () => {
    process.env.PI_WEB_GATEWAYS = "cloudflare,blksails-ai";
    registerBuiltinModelSources();

    await expect(
      attemptBuild("some-other-provider", "nonexistent-model", agentDir),
    ).rejects.toThrow(/^Model not found in registry/);
  });

  it("全无网关 env(零实例基线) → 缺省名 ai-gateway 仍命中来源文案(Req 9.1 不回归)", async () => {
    registerBuiltinModelSources();

    await expect(
      attemptBuild(AI_GATEWAY_PROVIDER_NAME, "nonexistent-model", agentDir),
    ).rejects.toThrow(/ai-gateway 目录/);
  });
});
