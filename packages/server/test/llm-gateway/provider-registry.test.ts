/**
 * llm-gateway · provider 登记表单元测试(design.md ProviderRegistry,Req 3.1)。
 *
 * 断言:
 * - 内置表查得(newapi/sufy/dashscope 的 upstreamBase 与 aigc-proxy/provider-registry.ts
 *   逐字一致——该模块在任务 3.1 摘除 aigc-proxy 后不复存在,故不做跨文件运行期 import,值已
 *   在实现期人工核对并固化为字面量断言;其余 openrouter/anthropic/openai/google/mistral 亦可
 *   查得);
 * - `PI_WEB_LLM_GATEWAY_PROVIDERS` JSON 同名覆盖生效;
 * - JSON 追加新 provider 生效(内置表不受影响);
 * - 非法 JSON / 不符 schema → fail-fast 抛 `LlmGatewayProviderConfigError`;
 * - token env 名派生规则正确(大写、`-` → `_`、前缀 `PI_LLM_TOKEN_`)。
 */
import { describe, expect, it } from "vitest";
import {
  LLM_GATEWAY_PROVIDERS_ENV,
  LlmGatewayProviderConfigError,
  llmGatewayTokenEnvName,
  lookupLlmGatewayProvider,
  resolveLlmGatewayProviderTable,
} from "../../src/llm-gateway/provider-registry.js";

describe("resolveLlmGatewayProviderTable — 内置表", () => {
  it("env 未设置时返回内置表", () => {
    const table = resolveLlmGatewayProviderTable({});
    expect(Object.keys(table).sort()).toEqual(
      [
        "anthropic",
        "dashscope",
        "google",
        "mistral",
        "newapi",
        "openai",
        "openrouter",
        "sufy",
      ].sort(),
    );
  });

  it("env 为空字符串时视同未设置", () => {
    const table = resolveLlmGatewayProviderTable({ [LLM_GATEWAY_PROVIDERS_ENV]: "  " });
    expect(lookupLlmGatewayProvider(table, "newapi")).toBeDefined();
  });

  it("newapi/sufy/dashscope 的 upstreamBase 与 aigc-proxy/provider-registry.ts(权威参照)逐字一致", () => {
    // aigc-proxy 已在任务 3.1 摘除,这里的期望值是实现期从
    // `packages/server/src/aigc-proxy/provider-registry.ts` 人工核对固化的字面量
    // (revalidation trigger:该权威参照若在摘除前发生变更,须同步更新此处)。
    const table = resolveLlmGatewayProviderTable({});
    expect(lookupLlmGatewayProvider(table, "newapi")).toEqual({
      upstreamBase: "https://www.apiservices.top/v1",
      keyEnvCandidates: ["NEWAPI_API_KEY", "APISERVICES_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "sufy")).toEqual({
      upstreamBase: "https://openai.sufy.com/v1",
      keyEnvCandidates: ["SUFY_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "dashscope")).toEqual({
      upstreamBase: "https://dashscope.aliyuncs.com/api/v1",
      keyEnvCandidates: ["DASHSCOPE_API_KEY"],
    });
  });

  it("其余内置 provider(openrouter/anthropic/openai/google/mistral)可查得", () => {
    const table = resolveLlmGatewayProviderTable({});
    expect(lookupLlmGatewayProvider(table, "openrouter")).toEqual({
      upstreamBase: "https://openrouter.ai/api/v1",
      keyEnvCandidates: ["OPENROUTER_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "anthropic")).toEqual({
      upstreamBase: "https://api.anthropic.com",
      keyEnvCandidates: ["ANTHROPIC_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "openai")).toEqual({
      upstreamBase: "https://api.openai.com/v1",
      keyEnvCandidates: ["OPENAI_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "google")).toEqual({
      upstreamBase: "https://generativelanguage.googleapis.com",
      keyEnvCandidates: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "mistral")).toEqual({
      upstreamBase: "https://api.mistral.ai/v1",
      keyEnvCandidates: ["MISTRAL_API_KEY"],
    });
  });

  it("未知 providerId 查表返回 undefined,不抛", () => {
    const table = resolveLlmGatewayProviderTable({});
    expect(lookupLlmGatewayProvider(table, "unknown-provider")).toBeUndefined();
    expect(lookupLlmGatewayProvider(table, "")).toBeUndefined();
  });
});

describe("resolveLlmGatewayProviderTable — JSON 覆盖/追加", () => {
  it("同名覆盖:替换内置 provider 的 upstreamBase/keyEnvCandidates", () => {
    const table = resolveLlmGatewayProviderTable({
      [LLM_GATEWAY_PROVIDERS_ENV]: JSON.stringify({
        newapi: {
          upstreamBase: "https://custom.example.com/v1",
          keyEnvCandidates: ["CUSTOM_NEWAPI_KEY"],
        },
      }),
    });
    expect(lookupLlmGatewayProvider(table, "newapi")).toEqual({
      upstreamBase: "https://custom.example.com/v1",
      keyEnvCandidates: ["CUSTOM_NEWAPI_KEY"],
    });
    // 未覆盖的内置项不受影响
    expect(lookupLlmGatewayProvider(table, "sufy")).toEqual({
      upstreamBase: "https://openai.sufy.com/v1",
      keyEnvCandidates: ["SUFY_API_KEY"],
    });
  });

  it("新名追加:内置表之外新增 provider,内置项不受影响", () => {
    const table = resolveLlmGatewayProviderTable({
      [LLM_GATEWAY_PROVIDERS_ENV]: JSON.stringify({
        "acme-llm": {
          upstreamBase: "https://acme.example.com/v1",
          keyEnvCandidates: ["ACME_LLM_API_KEY"],
        },
      }),
    });
    expect(lookupLlmGatewayProvider(table, "acme-llm")).toEqual({
      upstreamBase: "https://acme.example.com/v1",
      keyEnvCandidates: ["ACME_LLM_API_KEY"],
    });
    expect(lookupLlmGatewayProvider(table, "newapi")).toBeDefined();
  });

  it("非法 JSON → fail-fast 抛 LlmGatewayProviderConfigError", () => {
    expect(() =>
      resolveLlmGatewayProviderTable({ [LLM_GATEWAY_PROVIDERS_ENV]: "{not valid json" }),
    ).toThrow(LlmGatewayProviderConfigError);
  });

  it("不符 schema(缺 upstreamBase)→ fail-fast 抛 LlmGatewayProviderConfigError", () => {
    expect(() =>
      resolveLlmGatewayProviderTable({
        [LLM_GATEWAY_PROVIDERS_ENV]: JSON.stringify({ broken: { keyEnvCandidates: ["X"] } }),
      }),
    ).toThrow(LlmGatewayProviderConfigError);
  });

  it("不符 schema(keyEnvCandidates 非数组)→ fail-fast", () => {
    expect(() =>
      resolveLlmGatewayProviderTable({
        [LLM_GATEWAY_PROVIDERS_ENV]: JSON.stringify({
          broken: { upstreamBase: "https://x.example.com", keyEnvCandidates: "not-an-array" },
        }),
      }),
    ).toThrow(LlmGatewayProviderConfigError);
  });

  it("不符 schema(顶层非对象,如数组)→ fail-fast", () => {
    expect(() =>
      resolveLlmGatewayProviderTable({ [LLM_GATEWAY_PROVIDERS_ENV]: JSON.stringify([1, 2, 3]) }),
    ).toThrow(LlmGatewayProviderConfigError);
  });
});

describe("llmGatewayTokenEnvName — token env 名派生", () => {
  it("单段小写 providerId 大写化 + 前缀", () => {
    expect(llmGatewayTokenEnvName("newapi")).toBe("PI_LLM_TOKEN_NEWAPI");
    expect(llmGatewayTokenEnvName("sufy")).toBe("PI_LLM_TOKEN_SUFY");
    expect(llmGatewayTokenEnvName("dashscope")).toBe("PI_LLM_TOKEN_DASHSCOPE");
  });

  it("kebab-case providerId 的 '-' 全部转 '_'", () => {
    expect(llmGatewayTokenEnvName("google-vertex")).toBe("PI_LLM_TOKEN_GOOGLE_VERTEX");
    expect(llmGatewayTokenEnvName("acme-llm-v2")).toBe("PI_LLM_TOKEN_ACME_LLM_V2");
  });
});
