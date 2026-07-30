/**
 * 网关目录收敛与可诊断性(spec `cloudflare-chat-provider`,任务 1.5 / 2.1)。
 *
 * 背景:Cloudflare AI Gateway 实测返回 **2465 条**目录(openrouter 一家 1067 条,与
 * openai/anthropic 大量重复覆盖),原样下发会压垮模型选择器。故按上游归属(`owned_by`)
 * 白名单收敛;按**归属**而非模型 id 过滤,使白名单内厂商发新型号时无需改代码。
 */
import { describe, it, expect, vi } from "vitest";
import {
  GatewayModelCatalog,
  filterByOwner,
  type GatewayModelEntry,
  type GatewayCatalogLogger,
} from "../../src/ai-gateway/model-catalog.js";
import {
  resolveAiGatewayConfig,
  DEFAULT_PROVIDER_ALLOWLIST,
  AI_GATEWAY_PROVIDER_ALLOWLIST_ENV,
  AI_GATEWAY_BASE_URL_ENV,
} from "../../src/ai-gateway/config.js";

const ENTRIES: GatewayModelEntry[] = [
  { model: "openai/gpt-5.5", ownedBy: "openai", source: "ai-gateway" },
  { model: "anthropic/claude-opus-5", ownedBy: "anthropic", source: "ai-gateway" },
  { model: "openrouter/some/dup", ownedBy: "openrouter", source: "ai-gateway" },
  { model: "aws-bedrock/anthropic.claude-opus-5", ownedBy: "aws-bedrock", source: "ai-gateway" },
];

/** 造一个 `/v1/models` 的 OpenAI 兼容响应(形态取自 CF 真机)。 */
function modelsResponse(entries: readonly GatewayModelEntry[]) {
  return {
    ok: true,
    json: async () => ({
      object: "list",
      data: entries.map((e) => ({ id: e.model, object: "model", owned_by: e.ownedBy })),
    }),
  } as unknown as Response;
}

function fakeLogger(): GatewayCatalogLogger & {
  infos: { msg: string; data?: Record<string, unknown> }[];
  warns: { msg: string; data?: Record<string, unknown> }[];
} {
  const infos: { msg: string; data?: Record<string, unknown> }[] = [];
  const warns: { msg: string; data?: Record<string, unknown> }[] = [];
  return {
    infos,
    warns,
    info: (msg, data) => infos.push({ msg, data }),
    warn: (msg, data) => warns.push({ msg, data }),
  };
}

describe("filterByOwner —— 纯函数(Req 2.1/2.3)", () => {
  it("★未传白名单 → 原样返回,既有部署行为逐字节不变", () => {
    expect(filterByOwner(ENTRIES, undefined)).toBe(ENTRIES);
  });

  it("仅保留归属命中者", () => {
    const out = filterByOwner(ENTRIES, new Set(["openai", "anthropic"]));
    expect(out.map((e) => e.model)).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-5"]);
  });

  it("大小写与首尾空白容错", () => {
    const out = filterByOwner(ENTRIES, new Set([" OpenAI ", "ANTHROPIC"]));
    expect(out).toHaveLength(2);
  });

  it("空集 → 全部滤除(不抛错)", () => {
    expect(filterByOwner(ENTRIES, new Set())).toEqual([]);
  });

  it("按归属过滤 → 该归属下的新模型自动纳入,无需改代码(Req 2.4)", () => {
    const withNewModel = [
      ...ENTRIES,
      { model: "openai/gpt-6-future", ownedBy: "openai", source: "ai-gateway" as const },
    ];
    const out = filterByOwner(withNewModel, new Set(["openai"]));
    expect(out.map((e) => e.model)).toContain("openai/gpt-6-future");
  });
});

describe("GatewayModelCatalog 收敛与可观测(Req 2.1/2.5)", () => {
  it("刷新后快照已收敛,且记录保留/滤除数", async () => {
    const logger = fakeLogger();
    const cat = new GatewayModelCatalog({
      baseUrl: "https://gw.test/compat",
      ttlMs: 60_000,
      allowedOwners: new Set(["openai", "anthropic"]),
      fetchImpl: vi.fn(async () => modelsResponse(ENTRIES)) as unknown as typeof fetch,
      logger,
    });
    await cat.refresh();

    expect(cat.get().map((e) => e.ownedBy).sort()).toEqual(["anthropic", "openai"]);
    const rec = logger.infos.find((l) => l.msg.includes("filtered"));
    expect(rec, "未记录收敛结果").toBeDefined();
    expect(rec!.data).toMatchObject({ kept: 2, dropped: 2 });
  });

  it("★白名单过窄导致全滤除时同样记录,不静默产出空清单(Req 2.5)", async () => {
    const logger = fakeLogger();
    const cat = new GatewayModelCatalog({
      baseUrl: "https://gw.test/compat",
      ttlMs: 60_000,
      allowedOwners: new Set(["nonexistent-vendor"]),
      fetchImpl: vi.fn(async () => modelsResponse(ENTRIES)) as unknown as typeof fetch,
      logger,
    });
    await cat.refresh();
    expect(cat.get()).toEqual([]);
    expect(logger.infos.find((l) => l.msg.includes("filtered"))!.data).toMatchObject({
      kept: 0,
      dropped: 4,
    });
  });

  it("未配白名单 → 不过滤且不产生收敛日志(既有行为)", async () => {
    const logger = fakeLogger();
    const cat = new GatewayModelCatalog({
      baseUrl: "https://gw.test/compat",
      ttlMs: 60_000,
      fetchImpl: vi.fn(async () => modelsResponse(ENTRIES)) as unknown as typeof fetch,
      logger,
    });
    await cat.refresh();
    expect(cat.get()).toHaveLength(4);
    expect(logger.infos.filter((l) => l.msg.includes("filtered"))).toHaveLength(0);
  });
});

describe("拉取失败的可诊断性(Req 4.1/4.2)", () => {
  it("★失败日志含**实际请求地址**(层级配错是最常见故障),且不含凭据", async () => {
    const logger = fakeLogger();
    const cat = new GatewayModelCatalog({
      baseUrl: "https://gw.test/wrong-level",
      ttlMs: 60_000,
      keyResolver: { resolve: async () => "super-secret-token" } as never,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response) as unknown as typeof fetch,
      logger,
    });
    await cat.refresh();

    const w = logger.warns.find((l) => l.msg.includes("refresh failed"));
    expect(w, "未记录失败").toBeDefined();
    expect(String(w!.data?.url)).toBe("https://gw.test/wrong-level/v1/models");
    expect(String(w!.data?.error)).toContain("400");
    // 凭据绝不入日志
    expect(JSON.stringify(w!.data)).not.toContain("super-secret-token");
  });

  it("失败时 fail-soft:沿用上次成功快照,不抛错", async () => {
    let failNext = false;
    const cat = new GatewayModelCatalog({
      baseUrl: "https://gw.test/compat",
      ttlMs: 0,
      allowedOwners: new Set(["openai"]),
      fetchImpl: vi.fn(async () =>
        failNext ? ({ ok: false, status: 503 } as unknown as Response) : modelsResponse(ENTRIES),
      ) as unknown as typeof fetch,
      logger: fakeLogger(),
    });
    await cat.refresh();
    expect(cat.get()).toHaveLength(1);
    failNext = true;
    await expect(cat.refresh()).resolves.toBeUndefined();
    expect(cat.get()).toHaveLength(1); // 快照未被清空
  });
});

describe("白名单配置解析(Req 2.2)", () => {
  const base = { [AI_GATEWAY_BASE_URL_ENV]: "https://gw.test/compat" };

  it("未配置 → 内置默认白名单", () => {
    const cfg = resolveAiGatewayConfig(base)!;
    expect([...cfg.providerAllowlist].sort()).toEqual([...DEFAULT_PROVIDER_ALLOWLIST].sort());
  });

  it("★空白值 → 回落默认,而非解释为「全部滤除」(误配不应产出空清单)", () => {
    for (const raw of ["", "   ", " , , "]) {
      const cfg = resolveAiGatewayConfig({ ...base, [AI_GATEWAY_PROVIDER_ALLOWLIST_ENV]: raw })!;
      expect([...cfg.providerAllowlist].sort()).toEqual([...DEFAULT_PROVIDER_ALLOWLIST].sort());
    }
  });

  it("逗号分隔多项 → 归一化为小写集合,忽略空项与空白", () => {
    const cfg = resolveAiGatewayConfig({
      ...base,
      [AI_GATEWAY_PROVIDER_ALLOWLIST_ENV]: " Anthropic , ,workers-ai,  OPENAI ",
    })!;
    expect([...cfg.providerAllowlist].sort()).toEqual(["anthropic", "openai", "workers-ai"]);
  });

  it("默认白名单排除聚合型 openrouter(其条目与直连厂商大量重复)", () => {
    expect(DEFAULT_PROVIDER_ALLOWLIST).not.toContain("openrouter");
    expect(DEFAULT_PROVIDER_ALLOWLIST).toContain("anthropic");
    expect(DEFAULT_PROVIDER_ALLOWLIST).toContain("openai");
  });
});
