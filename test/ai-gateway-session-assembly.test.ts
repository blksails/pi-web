/**
 * ai-gateway-session-assembly 单测(spec ai-gateway-session-models,任务 2.1,
 * Req 1.3/2.1/2.3/2.5/7.1)。
 */
import { describe, expect, it } from "vitest";
import type { GatewayModelEntry } from "@blksails/pi-web-server";
import type { AiGatewayConfig } from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  AI_GATEWAY_SESSION_INSTANCES_ENV,
  AI_GATEWAY_PROVIDER_NAME,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  MODELS_ENV_WARN_BYTES,
  computeAiGatewaySessionSpawnEnv,
  computeAiGatewaySessionsSpawnEnv,
} from "../lib/app/ai-gateway-session-assembly.js";

const CONFIG: AiGatewayConfig = {
  baseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat",
  timeoutMs: 60_000,
  catalogTtlMs: 300_000,
  modelPrecedence: "gateway",
  providerAllowlist: new Set(["anthropic", "openai"]),
};

function entries(...ids: string[]): GatewayModelEntry[] {
  return ids.map((model) => ({
    model,
    ownedBy: "anthropic",
    source: "ai-gateway",
    instanceId: "ai-gateway",
  }));
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

describe("computeAiGatewaySessionsSpawnEnv — 多实例(spec multi-gateway-providers 任务 3.6,Req 1.1/1.3)", () => {
  it("零个网关实例 → 空对象", () => {
    const r = computeAiGatewaySessionsSpawnEnv({ instances: [] });
    expect(r.env).toEqual({});
  });

  it("恰好一个有效实例且标识为缺省实例 id → 扁平三件套,与单实例路径逐字节一致(Req 9.1)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: AI_GATEWAY_PROVIDER_NAME,
          baseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat",
          apiKey: "cf-token",
          catalog: entries("openai/gpt-5.5"),
        },
      ],
    });
    expect(r.env).toEqual({
      [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gateway.ai.cloudflare.com/v1/acct/gw/compat/v1",
      [RUNNER_AI_GATEWAY_KEY_ENV]: "cf-token",
      [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify(["openai/gpt-5.5"]),
    });
    expect(Object.keys(r.env)).not.toContain(AI_GATEWAY_SESSION_INSTANCES_ENV);
  });

  it("恰好一个有效实例但标识非缺省 → 走多实例形态(不得被误当作扁平缺省实例注册,否则会与部署级目录的真实标识错位)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "internal-token",
          catalog: entries("anthropic/claude-opus-5"),
        },
      ],
    });
    expect(r.env[AI_GATEWAY_SESSION_INSTANCES_ENV]).toBe("blksails-ai");
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_BASE"]).toBe(
      "https://internal.example.com/compat/v1",
    );
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_KEY"]).toBe("internal-token");
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_MODELS"]).toBe(
      JSON.stringify(["anthropic/claude-opus-5"]),
    );
    // 绝不产出扁平缺省实例名下的三件套(那会让 runner 把它注册成 "ai-gateway",与部署级
    // 目录里该实例的真实标识 "blksails-ai" 错位)。
    expect(Object.keys(r.env)).not.toContain(RUNNER_AI_GATEWAY_BASE_ENV);
  });

  it("两个实例同时挂载 → 会话可用清单均含两者(完成判据核心断言)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cloudflare",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "cf-key",
          catalog: entries("openai/gpt-5.5"),
        },
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "internal-key",
          catalog: entries("anthropic/claude-opus-5"),
        },
      ],
    });
    expect(r.env[AI_GATEWAY_SESSION_INSTANCES_ENV]).toBe("cloudflare,blksails-ai");
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_BASE"]).toBe(
      "https://cf.example.com/compat/v1",
    );
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_MODELS"]).toBe(
      JSON.stringify(["openai/gpt-5.5"]),
    );
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_BASE"]).toBe(
      "https://internal.example.com/compat/v1",
    );
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_MODELS"]).toBe(
      JSON.stringify(["anthropic/claude-opus-5"]),
    );
  });

  it("单个实例凭据缺失/目录为空时只跳过该实例,其余实例仍下发(fail-soft,Req 1.5)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cloudflare",
          baseUrl: "https://cf.example.com/compat",
          apiKey: undefined,
          catalog: entries("openai/gpt-5.5"),
        },
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "internal-key",
          catalog: entries("anthropic/claude-opus-5"),
        },
      ],
    });
    // 失败的实例既不出现在实例清单,也不产出前缀三件套。
    expect(r.env[AI_GATEWAY_SESSION_INSTANCES_ENV]).toBe("blksails-ai");
    expect(Object.keys(r.env).some((k) => k.includes("CLOUDFLARE"))).toBe(false);
    expect(r.env["PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_KEY"]).toBe("internal-key");
  });

  it("全部实例均无效(凭据缺失或目录为空)→ 空对象", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cloudflare",
          baseUrl: "https://cf.example.com/compat",
          apiKey: undefined,
          catalog: entries("openai/gpt-5.5"),
        },
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "internal-key",
          catalog: [],
        },
      ],
    });
    expect(r.env).toEqual({});
  });

  it("★不产出任何会劫持 pi-ai 的历史 env 名,且多实例形态下全部键均带 PI_WEB_ 前缀", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cloudflare",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "cf-key",
          catalog: entries("openai/gpt-5.5"),
        },
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "internal-key",
          catalog: entries("anthropic/claude-opus-5"),
        },
      ],
    });
    for (const k of Object.keys(r.env)) {
      expect(k.startsWith("PI_WEB_")).toBe(true);
    }
    expect(Object.keys(r.env)).not.toContain("AI_GATEWAY_API_KEY");
  });

  it("记录逐实例条目数(可观测性,Req 2.3/7.1),不含凭据", () => {
    const { lines, logger } = collectLogs();
    computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cloudflare",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "super-secret-cf",
          catalog: entries("openai/gpt-5.5"),
        },
        {
          instanceId: "blksails-ai",
          baseUrl: "https://internal.example.com/compat",
          apiKey: "super-secret-internal",
          catalog: entries("anthropic/claude-opus-5", "openai/gpt-5.5"),
        },
      ],
      logger,
    });
    const infos = lines.filter((l) => l.level === "info");
    expect(infos).toHaveLength(2);
    expect(infos.map((l) => l.data?.instanceId).sort()).toEqual(["blksails-ai", "cloudflare"]);
    expect(JSON.stringify(lines)).not.toContain("super-secret");
  });
});
