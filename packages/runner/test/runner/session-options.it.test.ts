/**
 * session-options · `resolveModel` 失败文案的来源判据(spec multi-gateway-providers,
 * 任务 3.7,Req 6.5)。
 *
 * **问题**:改动前,`resolveModel` 内部的来源判据是模块级常量
 * `[AI_GATEWAY_PROVIDER_NAME]`(即 `"ai-gateway"` 单元素数组)。多网关实例落地后,
 * 一个网关来源可同时产出多个 provider(如 `cloudflare` / `blksails-ai`),但该常量
 * 从未随实例数伸缩 —— 非缺省实例名解析失败时,判据不命中,退回裸的
 * "Model not found in registry" 文案,拿不到「网关套件未启用 / 凭据缺失 / 目录已
 * 变化」这类来源专属指引。
 *
 * ★ 本文件的核心用例("非缺省实例名 …")在改动前必须报红:改动前 `resolveModel`
 *   只接受两个参数,传第三个 `gatewayProviderNames` 会被 TS 判为「传参过多」
 *   (compile error),该用例因而无法通过 —— 这正是判据仍是模块级常量、而非
 *   运行时可传入的动态集合的直接证据。
 *
 * 用真实 `ModelRegistry`(而非 mock)驱动:与 `model-source-registrar.it.test.ts`
 * 的最后一例同惯例 —— 只 mock `resolveModel` 本身会削弱判据是否真的按
 * `registry.find()` 的结果分支这件事。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
import { resolveModel } from "../../src/runner/session-options.js";

describe("resolveModel — 来源判据覆盖全部实例名(Req 6.5)", () => {
  let agentDir: string;
  let registry: ModelRegistry;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-session-options-"));
    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("缺省实例名(未传第三参)→ 仍命中网关文案,与改动前逐字节等价", () => {
    expect(() =>
      resolveModel({ provider: AI_GATEWAY_PROVIDER_NAME, modelId: "nonexistent" }, registry),
    ).toThrow(/ai-gateway 目录/);
  });

  it("非网关来源(未传第三参)→ 不命中网关文案,行为不变", () => {
    expect(() => resolveModel({ provider: "openrouter", modelId: "nope" }, registry)).toThrow(
      /^Model not found in registry/,
    );
  });

  it("非缺省实例名 + 未传运行时集合 → 退回裸文案(证明「仅靠模块常量」确实覆盖不到)", () => {
    expect(() =>
      resolveModel({ provider: "cloudflare", modelId: "nonexistent" }, registry),
    ).toThrow(/^Model not found in registry/);
  });

  it("非缺省实例名 + 传入运行时实际注册的 provider 名集合 → 命中网关文案", () => {
    // `cloudflare` 与 `blksails-ai` 是同一个网关来源(design.md「adapters /
    // GatewayInstances」)运行时按 PI_WEB_GATEWAYS 解析出的两个实例标识
    // —— 由 `option-mapper.ts` 经 `providerNamesOf` 回读后传入,不再是硬编码。
    expect(() =>
      resolveModel(
        { provider: "cloudflare", modelId: "nonexistent" },
        registry,
        ["cloudflare", "blksails-ai"],
      ),
    ).toThrow(/ai-gateway 目录/);
  });

  it("集合中的另一个非缺省实例名同样命中(覆盖面随集合伸缩,不是逐个硬编码)", () => {
    expect(() =>
      resolveModel(
        { provider: "blksails-ai", modelId: "nonexistent" },
        registry,
        ["cloudflare", "blksails-ai"],
      ),
    ).toThrow(/ai-gateway 目录/);
  });

  it("传入的集合不含该 provider → 仍退回裸文案(判据是成员测试,不是「传了就一律命中」)", () => {
    expect(() =>
      resolveModel(
        { provider: "some-other-provider", modelId: "nonexistent" },
        registry,
        ["cloudflare", "blksails-ai"],
      ),
    ).toThrow(/^Model not found in registry/);
  });

  it("已注册的模型仍可正常解析(判据只影响失败分支,不影响成功路径)", () => {
    registry.registerProvider("cloudflare", {
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      api: "openai-completions",
      authHeader: true,
      models: [
        {
          id: "model-1",
          name: "model-1",
          api: "openai-completions",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8_192,
          maxTokens: 4_096,
        },
      ],
    } as Parameters<ModelRegistry["registerProvider"]>[1]);

    const resolved = resolveModel(
      { provider: "cloudflare", modelId: "model-1" },
      registry,
      ["cloudflare", "blksails-ai"],
    );
    expect(resolved).toBeDefined();
  });
});
