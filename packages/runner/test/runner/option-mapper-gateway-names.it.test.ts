/**
 * option-mapper · 网关失败文案的来源判据取自「声明」而非「已解析」
 * (spec multi-gateway-providers,任务 3.7,Req 6.5)。
 *
 * **问题(完整性复查抓到,详见 tasks.md「Implementation Notes」第三批②)**:上一版
 * `option-mapper.ts` 从 `resolved`(本次已**成功**解析出 spec 的模型源)取
 * `gatewayProviderNames`;网关来源本次未解析出 spec(套件未启用、凭据缺失、会话侧
 * 未注册)时,该值为 `undefined`,`resolveModel` 回退到模块内的缺省单实例常量。
 * 而失败文案本身把「网关套件未启用、凭据缺失、会话侧未注册」列为头号成因 ——
 * 于是恰在该场景下,非缺省实例名(如 `cloudflare`/`blksails-ai`)仍拿裸的
 * "Model not found in registry" 文案,拿不到来源专属指引。
 *
 * ★ 本文件的核心用例("spec 解析失败 → 非缺省实例名仍得到来源专属文案")在改动前
 *   必须报红:改动前 `option-mapper.ts` 只从 `resolved`(要求 `resolveSpecFromEnv`
 *   成功)取值,一个 `resolveSpecFromEnv` 恒返回 `undefined` 的网关来源不会出现在
 *   `resolved` 里,`gatewayProviderNames` 落到 `undefined` → `resolveModel` 用缺省
 *   单实例常量 `["ai-gateway"]`,`"cloudflare"`/`"blksails-ai"` 均不在其中,仍会
 *   命中裸文案分支 —— 与本用例的断言矛盾,必然失败。
 *
 * 经 `buildRuntimeFactory` 的公开路径验证(`resolveModel`/`gatewayProviderNames` 均为
 * 模块私有),与 `option-mapper-model-source.it.test.ts` 同惯例;额外注册一个**自定义**
 * (非真实 ai-gateway 实现的)`ModelSourceRegistrar`,以精确控制「spec 解析是否成功」
 * 与「声明的实例名集合」两者独立可控 —— 这是本用例要验证的核心区分点。
 *
 * ★ 本文件测的是 option-mapper 这一**消费侧机制**(接缝本身),不是生产接线证据 ——
 *   生产侧唯一注册点是否真的实现并接线了 `declaredProviderNamesFromEnv`,由
 *   `packages/server/test/host-assembly/model-sources-gateway-names.it.test.ts`
 *   经真实 `registerBuiltinModelSources()` 覆盖(该文件不造假 registrar)。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
import { buildRuntimeFactory } from "../../src/runner/option-mapper.js";
import {
  registerModelSource,
  resetModelSourcesForTest,
  type ModelSourceRegistrar,
} from "../../src/runner/model-source-registrar.js";

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

/** 一个恒使 spec 解析失败的假网关来源;`register`/`providerNamesOf` 不应被调用到。 */
function makeUnresolvableGatewaySource(
  declaredProviderNamesFromEnv?: (env: NodeJS.ProcessEnv) => readonly string[],
): ModelSourceRegistrar<{ marker: true }> {
  const registrar: ModelSourceRegistrar<{ marker: true }> = {
    sourceId: AI_GATEWAY_PROVIDER_NAME,
    // 模拟「网关套件未启用或凭据缺失」—— 与失败文案的头号成因一致,resolveSpecFromEnv
    // 整体返回 undefined(fail-soft,不抛)。
    resolveSpecFromEnv: () => undefined,
    providerNamesOf: () => {
      throw new Error("不应被调用:spec 本次未解析成功,不存在可回读的 spec");
    },
    register: () => {
      throw new Error("不应被调用:resolveSpecFromEnv 返回 undefined 时不会注册");
    },
  };
  if (declaredProviderNamesFromEnv !== undefined) {
    return { ...registrar, declaredProviderNamesFromEnv };
  }
  return registrar;
}

describe("buildRuntimeFactory — 网关来源判据取自「声明」(任务 3.7,Req 6.5)", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-optmap-gwnames-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    resetModelSourcesForTest();
  });

  it("网关源已登记但 spec 解析失败(凭据缺失场景)→ 非缺省实例名仍得到来源专属文案", async () => {
    registerModelSource(
      makeUnresolvableGatewaySource(() => ["cloudflare", "blksails-ai"]),
    );

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

  it("声明集合不含的 provider 名 → 仍退回裸文案(判据是成员测试,不是「来源已登记就一律命中」)", async () => {
    registerModelSource(
      makeUnresolvableGatewaySource(() => ["cloudflare", "blksails-ai"]),
    );

    await expect(
      attemptBuild("some-other-provider", "nonexistent-model", agentDir),
    ).rejects.toThrow(/^Model not found in registry/);
    await expect(
      attemptBuild("some-other-provider", "nonexistent-model", agentDir),
    ).rejects.not.toThrow(/ai-gateway 目录/);
  });

  it("机制测试(非生产场景):来源未实现 declaredProviderNamesFromEnv → 退回既有判据,不比改造前差", async () => {
    // ★ 本用例造的是一个**测试专用**假来源,不代表真实 ai-gateway 生产 registrar 仍有
    //   此缺口 —— 生产唯一注册点(`packages/server/src/host-assembly/model-sources.ts`)
    //   已经实现了 `declaredProviderNamesFromEnv`(见 `model-sources-gateway-names.it.test.ts`)。
    //   本用例只验证:option-mapper 消费该**可选**方法时,对"未实现"这一分支的兜底
    //   行为安全(不崩溃、不比改造前差),这是接口契约层面的机制测试。
    registerModelSource(makeUnresolvableGatewaySource());

    // 缺省实例名本身仍命中(DEFAULT_GATEWAY_PROVIDER_NAMES 回退,逐字节等价改造前)。
    await expect(
      attemptBuild(AI_GATEWAY_PROVIDER_NAME, "nonexistent-model", agentDir),
    ).rejects.toThrow(/ai-gateway 目录/);
    // 非缺省实例名在这个测试专用来源没有声明回读能力时确实拿不到来源专属文案 ——
    // 证明本轮修复的增益专门来自 `declaredProviderNamesFromEnv`,而非其他旁路。
    await expect(
      attemptBuild("cloudflare", "nonexistent-model", agentDir),
    ).rejects.toThrow(/^Model not found in registry/);
  });
});
