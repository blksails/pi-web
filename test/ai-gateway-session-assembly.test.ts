/**
 * ai-gateway-session-assembly 单测(spec ai-gateway-session-models,任务 2.1,
 * Req 1.3/2.1/2.3/2.5/7.1)。
 */
import { describe, expect, it } from "vitest";
import type {
  GatewayModelEntry,
} from "@blksails/pi-web-server";
import type { AiGatewayConfig } from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  MODELS_ENV_WARN_BYTES,
  computeAiGatewaySessionSpawnEnv,
} from "../lib/app/ai-gateway-session-assembly.js";

const CONFIG: AiGatewayConfig = {
  baseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat",
  timeoutMs: 60_000,
  catalogTtlMs: 300_000,
  modelPrecedence: "gateway",
  providerAllowlist: new Set(["anthropic", "openai"]),
};

function entries(...ids: string[]): GatewayModelEntry[] {
  return ids.map((model) => ({ model, ownedBy: "anthropic", source: "ai-gateway" }));
}

function collectLogs() {
  const lines: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
  return {
    lines,
    logger: {
      info: (msg: string, data?: Record<string, unknown>) =>
        lines.push({ level: "info", msg, ...(data ? { data } : {}) }),
      warn: (msg: string, data?: Record<string, unknown>) =>
        lines.push({ level: "warn", msg, ...(data ? { data } : {}) }),
    },
  };
}

describe("computeAiGatewaySessionSpawnEnv — 不产出的四种情形", () => {
  it("套件未启用 → 空对象(Req 1.3/2.5)", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: undefined,
      apiKey: "k",
      catalog: entries("openai/gpt-5.5"),
    });
    expect(r.env).toEqual({});
  });

  it("无凭据 → 空对象", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: undefined,
      catalog: entries("openai/gpt-5.5"),
    });
    expect(r.env).toEqual({});
  });

  it("凭据为空白 → 空对象", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "   ",
      catalog: entries("openai/gpt-5.5"),
    });
    expect(r.env).toEqual({});
  });

  // 目录从未拉取成功时快照为空(fail-soft)。注册一个没有模型的 provider 无意义。
  it("目录为空 → 空对象", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "k",
      catalog: [],
    });
    expect(r.env).toEqual({});
  });
});

describe("computeAiGatewaySessionSpawnEnv — 齐全时的产出", () => {
  it("产出三件套,base 补 /v1", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "cf-token",
      catalog: entries("anthropic/claude-opus-5", "openai/gpt-5.5"),
    });
    expect(r.env).toEqual({
      // 与 GatewayModelCatalog 拼 `${baseUrl}/v1/models` 同一层级约定
      // (CF 容忍多出的 /v1,cloudflare-chat-provider research §三实测 200)。
      [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat/v1",
      [RUNNER_AI_GATEWAY_KEY_ENV]: "cf-token",
      [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify([
        "anthropic/claude-opus-5",
        "openai/gpt-5.5",
      ]),
    });
  });

  it("剥离 config.baseUrl 尾斜杠后再补 /v1", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: { ...CONFIG, baseUrl: "https://gw.example.com/compat//" },
      apiKey: "k",
      catalog: entries("openai/gpt-5.5"),
    });
    expect(r.env[RUNNER_AI_GATEWAY_BASE_ENV]).toBe("https://gw.example.com/compat/v1");
  });

  // ★env 命名硬约束:绝不可产出 AI_GATEWAY_API_KEY —— 该名会被 pi 子进程继承并被
  // pi-ai 当作 Vercel AI Gateway 凭据,劫持全部模型调用返回 401(pi-clouds 8.2 事故)。
  it("★不产出任何会劫持 pi-ai 的历史 env 名", () => {
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "cf-token",
      catalog: entries("openai/gpt-5.5"),
    });
    expect(Object.keys(r.env)).not.toContain("AI_GATEWAY_API_KEY");
    expect(Object.keys(r.env)).not.toContain("AI_GATEWAY_BASE_URL");
    for (const k of Object.keys(r.env)) expect(k.startsWith("PI_WEB_AI_GATEWAY_SESSION_")).toBe(true);
  });
});

describe("computeAiGatewaySessionSpawnEnv — 可观测性(Req 2.3/7.1)", () => {
  it("记条目数与字节数,且不含凭据", () => {
    const { lines, logger } = collectLogs();
    computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "super-secret-token",
      catalog: entries("anthropic/claude-opus-5", "openai/gpt-5.5"),
      logger,
    });
    const info = lines.find((l) => l.level === "info");
    expect(info?.data).toMatchObject({ models: 2 });
    expect(typeof info?.data?.bytes).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("super-secret-token");
  });

  it("清单未超阈值时不告警", () => {
    const { lines, logger } = collectLogs();
    computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "k",
      catalog: entries("openai/gpt-5.5"),
      logger,
    });
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(0);
  });

  // 白名单若被放宽到不过滤(实测 2465 条 ≈ 80KB),会逼近 env 单值上限。
  // 静默截断会表现为「模型莫名少了」,故必须告警。
  it("清单超阈值时告警并附字节数", () => {
    const { lines, logger } = collectLogs();
    const many = Array.from({ length: 3000 }, (_, i) => `owner-${i}/model-name-${i}`);
    const r = computeAiGatewaySessionSpawnEnv({
      aiGatewayConfig: CONFIG,
      apiKey: "k",
      catalog: entries(...many),
      logger,
    });
    const warn = lines.find((l) => l.level === "warn");
    expect(warn).toBeDefined();
    expect(warn?.data?.threshold).toBe(MODELS_ENV_WARN_BYTES);
    expect(Number(warn?.data?.bytes)).toBeGreaterThan(MODELS_ENV_WARN_BYTES);
    // 告警不阻断:仍照常产出(截断才是更坏的失败模式)。
    expect(r.env[RUNNER_AI_GATEWAY_MODELS_ENV]).toBeDefined();
  });
});
