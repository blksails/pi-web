/**
 * ai-gateway · model-catalog 单测。
 *
 * - `GatewayModelCatalog` 拉取机制:ai-gateway-providers spec(design.md §2.4,Req Story 4),不动。
 * - `mergeModelCatalog` 合并语义:model-catalog spec(不吞并 + provider 收敛 + 块排序,
 *   Req 1.1–1.3, 2.1–2.3, 3.1, 6.1, 6.2)。
 */
import { describe, expect, it, vi } from "vitest";
import { GatewayModelCatalog, mergeModelCatalog } from "../../src/ai-gateway/model-catalog.js";
import type { GatewayModelEntry } from "../../src/ai-gateway/model-catalog.js";
import type { ModelOption } from "../../src/config/model-options.types.js";

function modelsResponse(ids: Array<{ id: string; owned_by?: string }>): Response {
  return new Response(JSON.stringify({ data: ids }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("GatewayModelCatalog — 从未成功过", () => {
  it("get() 恒为空集,不触发过额外 refresh 副作用(即便未 await)", () => {
    const fetchImpl = vi.fn(async () => modelsResponse([{ id: "m1", owned_by: "openai" }]));
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 300_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(catalog.get()).toEqual([]);
  });
});

describe("GatewayModelCatalog — 刷新成功", () => {
  it("refresh() 后 get() 返回解析出的条目", async () => {
    const fetchImpl = vi.fn(async () =>
      modelsResponse([
        { id: "gpt-image-1", owned_by: "openai" },
        { id: "doubao-seed-2-0-lite", owned_by: "bytedance" },
      ]),
    );
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 300_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await catalog.refresh();
    expect(catalog.get()).toEqual([
      { model: "gpt-image-1", ownedBy: "openai", source: "ai-gateway" },
      { model: "doubao-seed-2-0-lite", ownedBy: "bytedance", source: "ai-gateway" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gw.example.com/v1/models",
      expect.anything(),
    );
  });

  it("keyResolver 注入时以 Bearer 携带凭据请求 /v1/models", async () => {
    let capturedAuth: string | null = null;
    const fetchImpl = vi.fn(async (_url, init) => {
      capturedAuth = new Headers((init as RequestInit).headers).get("authorization");
      return modelsResponse([{ id: "m1", owned_by: "openai" }]);
    });
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 300_000,
      keyResolver: { resolve: async () => "sk-gw-test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await catalog.refresh();
    expect(capturedAuth).toBe("Bearer sk-gw-test");
  });
});

describe("GatewayModelCatalog — TTL 过期后台刷新", () => {
  it("过期后 get() 触发后台 refresh(await 该 promise 后快照更新)", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([{ id: "m1", owned_by: "openai" }]))
      .mockResolvedValueOnce(modelsResponse([{ id: "m2", owned_by: "anthropic" }]));
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowFn: () => now,
    });
    await catalog.refresh();
    expect(catalog.get()).toEqual([{ model: "m1", ownedBy: "openai", source: "ai-gateway" }]);

    now = 5000; // 超过 TTL
    // get() 触发后台刷新;为测试确定性,显式等待一个 microtask 队列的刷新 promise。
    catalog.get();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(catalog.get()).toEqual([{ model: "m2", ownedBy: "anthropic", source: "ai-gateway" }]);
  });
});

describe("GatewayModelCatalog — 失败沿用快照(fail-soft)", () => {
  it("refresh() 拉取失败(fetch 抛错) → 快照沿用上次成功值", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([{ id: "m1", owned_by: "openai" }]))
      .mockRejectedValueOnce(new Error("network down"));
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 300_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await catalog.refresh();
    expect(catalog.get()).toEqual([{ model: "m1", ownedBy: "openai", source: "ai-gateway" }]);
    await catalog.refresh();
    expect(catalog.get()).toEqual([{ model: "m1", ownedBy: "openai", source: "ai-gateway" }]);
  });

  it("refresh() 拉取失败(非 2xx 状态) → 快照沿用上次成功值", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(modelsResponse([{ id: "m1", owned_by: "openai" }]))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const catalog = new GatewayModelCatalog({
      baseUrl: "https://gw.example.com",
      ttlMs: 300_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await catalog.refresh();
    await catalog.refresh();
    expect(catalog.get()).toEqual([{ model: "m1", ownedBy: "openai", source: "ai-gateway" }]);
  });
});

describe("mergeModelCatalog — 不吞并 + provider 收敛 + 块排序(model-catalog spec)", () => {
  const selfEntries: ModelOption[] = [
    { provider: "openrouter", id: "shared-model", name: "Shared Model (self)" },
    { provider: "dashscope", id: "self-only", name: "Self Only" },
  ];
  const gatewayEntries: GatewayModelEntry[] = [
    { model: "shared-model", ownedBy: "anthropic", source: "ai-gateway" },
    { model: "gateway-only", ownedBy: "openai-compat", source: "ai-gateway" },
  ];

  it("无冲突模型:两侧并集全部保留;self 附 source=self/availability=session,gateway 附 source=ai-gateway/availability=catalog", () => {
    const merged = mergeModelCatalog(
      [{ provider: "dashscope", id: "self-only", name: "Self Only" }],
      [{ model: "gateway-only", ownedBy: "openai-compat", source: "ai-gateway" }],
      "gateway",
    );
    expect(merged.models).toHaveLength(2);
    const self = merged.models.find((m) => m.id === "self-only");
    expect(self?.source).toBe("self");
    expect(self?.availability).toBe("session");
    const gw = merged.models.find((m) => m.id === "gateway-only");
    expect(gw?.source).toBe("ai-gateway");
    expect(gw?.availability).toBe("catalog");
  });

  it("同 id 跨归属不吞并(Req 1.1/1.2/6.1):self 与 gateway 两条并存,任一 precedence 都不做覆盖删除", () => {
    for (const precedence of ["gateway", "self"] as const) {
      const merged = mergeModelCatalog(selfEntries, gatewayEntries, precedence);
      expect(merged.models).toHaveLength(4); // 2 self + 2 gateway,零丢失
      const shared = merged.models.filter((m) => m.id === "shared-model");
      expect(shared).toHaveLength(2);
      expect(shared.map((m) => m.source).sort()).toEqual(["ai-gateway", "self"]);
      const selfShared = shared.find((m) => m.source === "self");
      expect(selfShared?.provider).toBe("openrouter");
      expect(selfShared?.name).toBe("Shared Model (self)");
    }
  });

  it("网关条目 provider 收敛为 ai-gateway,ownedBy 降级为 channel 元数据(Req 2.1/2.3)", () => {
    const merged = mergeModelCatalog(selfEntries, gatewayEntries, "gateway");
    const gw = merged.models.filter((m) => m.source === "ai-gateway");
    expect(gw).toHaveLength(2);
    for (const m of gw) expect(m.provider).toBe("ai-gateway");
    expect(gw.find((m) => m.id === "shared-model")?.channel).toBe("anthropic");
    expect(gw.find((m) => m.id === "gateway-only")?.channel).toBe("openai-compat");
    expect(gw.find((m) => m.id === "gateway-only")?.name).toBe("gateway-only");
    // self 条目不附 channel
    for (const m of merged.models.filter((x) => x.source === "self")) {
      expect(m.channel).toBeUndefined();
    }
  });

  it("providers 仅含 self 来源 provider(去重排序),不含 ai-gateway 与任何渠道名(Req 2.2/3.1/6.2)", () => {
    const merged = mergeModelCatalog(selfEntries, gatewayEntries, "gateway");
    expect(merged.providers).toEqual(["dashscope", "openrouter"]);
    expect(merged.providers).not.toContain("ai-gateway");
    expect(merged.providers).not.toContain("anthropic");
    expect(merged.providers).not.toContain("openai-compat");
  });

  it("modelPrecedence=gateway → 网关块在前;=self → self 块在前(块内保持入参原有顺序)", () => {
    const gwFirst = mergeModelCatalog(selfEntries, gatewayEntries, "gateway");
    expect(gwFirst.models.map((m) => `${m.provider}/${m.id}`)).toEqual([
      "ai-gateway/shared-model",
      "ai-gateway/gateway-only",
      "openrouter/shared-model",
      "dashscope/self-only",
    ]);
    const selfFirst = mergeModelCatalog(selfEntries, gatewayEntries, "self");
    expect(selfFirst.models.map((m) => `${m.provider}/${m.id}`)).toEqual([
      "openrouter/shared-model",
      "dashscope/self-only",
      "ai-gateway/shared-model",
      "ai-gateway/gateway-only",
    ]);
  });

  it("同 key(provider/id)重复时保留先出现者,后块不覆盖前块(防御性去重锚定)", () => {
    // 网关目录自身重复同 id:两条都映射到 ai-gateway/dup,仅保留先出现者(channel=first)。
    const merged = mergeModelCatalog(
      [],
      [
        { model: "dup", ownedBy: "first", source: "ai-gateway" },
        { model: "dup", ownedBy: "second", source: "ai-gateway" },
      ],
      "gateway",
    );
    expect(merged.models).toHaveLength(1);
    expect(merged.models[0]?.channel).toBe("first");
  });

  it("gateway 入参为空数组:models 的 provider/id/name 与 self 完全一致(含顺序),providers = self providers", () => {
    // 语义分界(design.md「mergeModelCatalog(重写)」/ Req 1.3 零侵入辨析):
    // 「未启用 ai-gateway 套件时响应逐字节一致」由装配层保证——aiGwConfig 为 undefined 时
    // pi-handler 根本不调用 mergeModelCatalog,self 目录原样透传,不附加任何新字段。
    // 而一旦调用了 merge(即聚合形态),即便 gateway 入参恰为空数组,输出也一律附
    // source/availability 标记。故本测试断言 provider/id/name 与 self 完全一致且
    // providers 等同(允许 source/availability 附加),不断言「无附加字段」。
    const merged = mergeModelCatalog(selfEntries, [], "gateway");
    expect(merged.models.map(({ provider, id, name }) => ({ provider, id, name }))).toEqual(
      selfEntries.map(({ provider, id, name }) => ({ provider, id, name })),
    );
    expect(merged.providers).toEqual([...new Set(selfEntries.map((m) => m.provider))].sort());
    for (const m of merged.models) {
      expect(m.source).toBe("self");
      expect(m.availability).toBe("session");
      expect(m.channel).toBeUndefined();
    }
  });
});
