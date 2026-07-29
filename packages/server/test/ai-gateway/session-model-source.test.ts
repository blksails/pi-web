/**
 * ai-gateway · 会话侧模型来源单测(spec ai-gateway-session-models,任务 1.1/0.1,
 * Req 1.1/2.4/3.1/3.2)。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_GATEWAY_PROVIDER_NAME,
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
  isSessionCapableGatewayModel,
  registerAiGatewayProvider,
  resolveAiGatewaySessionSpecFromEnv,
} from "../../src/ai-gateway/session-model-source.js";
import {
  createSharedModelServices,
  registerEgressProvider,
  resolveEgressSpecFromEnv,
} from "../../src/auth/egress-model-source.js";

function envOf(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gw.example.com/compat/v1",
    [RUNNER_AI_GATEWAY_KEY_ENV]: "cf-token-abc",
    [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify([
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
    ]),
    ...over,
  };
}

describe("resolveAiGatewaySessionSpecFromEnv", () => {
  it("三件套齐全 → 解析出 spec", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(envOf());
    expect(spec).toEqual({
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "cf-token-abc",
      modelIds: ["anthropic/claude-opus-5", "openai/gpt-5.5"],
    });
  });

  it("剥离 baseUrl 尾斜杠", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(
      envOf({ [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gw.example.com/compat/v1//" }),
    );
    expect(spec?.baseUrl).toBe("https://gw.example.com/compat/v1");
  });

  it.each([
    ["base 缺失", RUNNER_AI_GATEWAY_BASE_ENV],
    ["key 缺失", RUNNER_AI_GATEWAY_KEY_ENV],
    ["models 缺失", RUNNER_AI_GATEWAY_MODELS_ENV],
  ])("%s → undefined(视为未启用)", (_label, key) => {
    expect(resolveAiGatewaySessionSpecFromEnv(envOf({ [key]: undefined }))).toBeUndefined();
  });

  it.each([
    ["base 空白", RUNNER_AI_GATEWAY_BASE_ENV],
    ["key 空白", RUNNER_AI_GATEWAY_KEY_ENV],
  ])("%s → undefined", (_label, key) => {
    expect(resolveAiGatewaySessionSpecFromEnv(envOf({ [key]: "   " }))).toBeUndefined();
  });

  // 配置异常不该打断本地会话路径(与 egress 同惯例:返回 undefined 而非抛)。
  it("models 非法 JSON → undefined 且不抛", () => {
    expect(() =>
      resolveAiGatewaySessionSpecFromEnv(
        envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: "{不是数组" }),
      ),
    ).not.toThrow();
    expect(
      resolveAiGatewaySessionSpecFromEnv(
        envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: "{不是数组" }),
      ),
    ).toBeUndefined();
  });

  it("models 是 JSON 但非数组 → undefined", () => {
    expect(
      resolveAiGatewaySessionSpecFromEnv(
        envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: '{"a":1}' }),
      ),
    ).toBeUndefined();
  });

  // 没有模型的 provider 无意义:注册了只会让 find 徒劳失败。
  it("models 为空数组 → undefined(不注册空 provider)", () => {
    expect(
      resolveAiGatewaySessionSpecFromEnv(
        envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: "[]" }),
      ),
    ).toBeUndefined();
  });

  it("剔除非字符串与空白项", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(
      envOf({
        [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify([
          "openai/gpt-5.5",
          "",
          "   ",
          42,
          null,
          " anthropic/claude-sonnet-5 ",
        ]),
      }),
    );
    expect(spec?.modelIds).toEqual(["openai/gpt-5.5", "anthropic/claude-sonnet-5"]);
  });
});

// Req 4.1(任务 4.1):判据由 2026-07-29 对真实 CF 目录的统计得出 ——
// 470 条中含冒号者 68 条,分布 :batch 25 / :free 20 / :beta 14 / :thinking 3 /
// :extended · :nitro · :exacto 各 1。故只能排除 :batch,一刀切会误伤 43 条合法模型。
describe("isSessionCapableGatewayModel", () => {
  it(":batch 变体不可用于会话(实测 401,需另一套凭据)", () => {
    expect(isSessionCapableGatewayModel("openai/gpt-4-turbo:batch")).toBe(false);
    expect(isSessionCapableGatewayModel("anthropic/claude-opus-4.1:batch")).toBe(false);
  });

  // ★这些后缀是正常对话模型的路由变体 —— 排除它们才是缺陷。
  it.each([
    "meta/llama:free",
    "anthropic/claude-sonnet-4:beta",
    "google/gemini:thinking",
    "openai/gpt-4o:extended",
    "x/y:nitro",
    "x/y:exacto",
  ])("%s 仍可用于会话(不误伤)", (id) => {
    expect(isSessionCapableGatewayModel(id)).toBe(true);
  });

  it("不含冒号的常规 id 恒可用", () => {
    expect(isSessionCapableGatewayModel("anthropic/claude-opus-5")).toBe(true);
    expect(isSessionCapableGatewayModel("openai/gpt-5.5")).toBe(true);
  });

  // 只按后缀判定,不做子串匹配 —— 否则 `x/batch-model` 之类会被误伤。
  it("冒号在中间而非后缀 → 不排除", () => {
    expect(isSessionCapableGatewayModel("owner/model:batch-preview")).toBe(true);
    expect(isSessionCapableGatewayModel("owner/batch:free")).toBe(true);
  });
});

describe("registerAiGatewayProvider", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-gw-session-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ★任务 0.1 的实证钉死在测试里:research §五标记的唯一未实证前提 ——
  // pi SDK 是否对含斜杠的 modelId 做二次切分。含斜杠是 ai-gateway 目录的**常态**
  // (`anthropic/claude-opus-5`),若被切分则整套方案不成立。
  it("★带斜杠的 modelId 可被 find 解析", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["anthropic/claude-opus-5", "openai/gpt-5.5"],
    });
    const found = modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5");
    expect(found).toBeDefined();
    expect(found?.id).toBe("anthropic/claude-opus-5");
    expect(found?.provider).toBe(AI_GATEWAY_PROVIDER_NAME);
  });

  it("未注册的 modelId → undefined", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5"],
    });
    expect(modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "nope/nope")).toBeUndefined();
  });

  // ★端到端揪出的真实缺陷(2026-07-29):pi SDK 的 openai-completions 默认发 `max_tokens`,
  // OpenAI 推理模型(gpt-5.5)拒收 → assistant content 为空 + stopReason=error,服务端无日志。
  // 三家上游实调确认均接受 max_completion_tokens,故统一设置。
  // 移除此 compat 会让 gpt-5 系模型在真机上静默失败,而其他单测都发现不了 —— 故钉死。
  it("★模型附 compat.maxTokensField=max_completion_tokens", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5", "anthropic/claude-opus-5"],
    });
    for (const id of ["openai/gpt-5.5", "anthropic/claude-opus-5"]) {
      // compat 是跨 api 的联合类型(openai-completions / responses / anthropic-messages),
      // maxTokensField 只存在于 openai-completions 分支;此处 api 恒为前者,故收窄读取。
      const compat = modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, id)?.compat as
        | { maxTokensField?: string }
        | undefined;
      expect(compat?.maxTokensField, `模型 ${id} 缺 compat`).toBe("max_completion_tokens");
    }
  });

  it("baseUrl 落到 model 上(转发目标正确)", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5"],
    });
    expect(modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "openai/gpt-5.5")?.baseUrl).toBe(
      "https://gw.example.com/compat/v1",
    );
  });

  // Req 2.3/7.1:可观测但绝不泄露凭据。
  it("日志记 provider 与条目数,不含凭据", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    const lines: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    registerAiGatewayProvider(
      modelRegistry,
      {
        baseUrl: "https://gw.example.com/compat/v1",
        apiKey: "super-secret-token",
        modelIds: ["openai/gpt-5.5", "anthropic/claude-opus-5"],
      },
      { info: (msg, data) => lines.push({ msg, ...(data ? { data } : {}) }) },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.data).toMatchObject({
      provider: AI_GATEWAY_PROVIDER_NAME,
      models: 2,
    });
    expect(JSON.stringify(lines)).not.toContain("super-secret-token");
  });
});

// Req 3.1/3.4:两个来源必须共存 —— 谁自建 registry 谁就顶掉对方。
describe("egress 与 ai-gateway 共存(design.md §D2)", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-gw-coexist-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("同一 registry 注册两个来源 → 两侧模型均可解析", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerEgressProvider(modelRegistry, {
      egressBaseUrl: "https://egress.example.com/v1",
      credential: "desktop-cred",
      models: [{ id: "cloud-model-a" }],
    });
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "cf-token",
      modelIds: ["anthropic/claude-opus-5"],
    });

    expect(modelRegistry.find("pi-cloud", "cloud-model-a")).toBeDefined();
    expect(
      modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5"),
    ).toBeDefined();
  });

  it("仅 egress 时网关模型不可解析(反向锚定)", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerEgressProvider(modelRegistry, {
      egressBaseUrl: "https://egress.example.com/v1",
      credential: "desktop-cred",
      models: [{ id: "cloud-model-a" }],
    });
    expect(
      modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5"),
    ).toBeUndefined();
  });

  it("egress 解析器对网关 env 无反应(两来源判据互不干扰)", () => {
    expect(resolveEgressSpecFromEnv(envOf())).toBeUndefined();
  });
});
