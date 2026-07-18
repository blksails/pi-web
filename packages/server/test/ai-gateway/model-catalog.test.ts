/**
 * ai-gateway · model-catalog 单测(design.md §2.4,Req Story 4)。
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

describe("mergeModelCatalog — 三种冲突场景", () => {
  const selfEntries: ModelOption[] = [
    { provider: "openrouter", id: "shared-model", name: "Shared Model (self)" },
    { provider: "dashscope", id: "self-only", name: "Self Only" },
  ];
  const gatewayEntries: GatewayModelEntry[] = [
    { model: "shared-model", ownedBy: "anthropic", source: "ai-gateway" },
    { model: "gateway-only", ownedBy: "openai", source: "ai-gateway" },
  ];

  it("无冲突模型:两侧并集全部保留,各带正确 source", () => {
    const merged = mergeModelCatalog(
      [{ provider: "dashscope", id: "self-only", name: "Self Only" }],
      [{ model: "gateway-only", ownedBy: "openai", source: "ai-gateway" }],
      "gateway",
    );
    expect(merged.models).toHaveLength(2);
    expect(merged.models.find((m) => m.id === "self-only")?.source).toBe("self");
    expect(merged.models.find((m) => m.id === "gateway-only")?.source).toBe("ai-gateway");
  });

  it("同名冲突 + precedence=gateway(默认)→ 取 ai-gateway 条目", () => {
    const merged = mergeModelCatalog(selfEntries, gatewayEntries, "gateway");
    const shared = merged.models.find((m) => m.id === "shared-model");
    expect(shared?.source).toBe("ai-gateway");
    expect(shared?.provider).toBe("anthropic");
    expect(merged.models).toHaveLength(3); // shared-model(gateway) + self-only + gateway-only
  });

  it("同名冲突 + precedence=self(PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE=self 反转)→ 取 self 条目", () => {
    const merged = mergeModelCatalog(selfEntries, gatewayEntries, "self");
    const shared = merged.models.find((m) => m.id === "shared-model");
    expect(shared?.source).toBe("self");
    expect(shared?.provider).toBe("openrouter");
    expect(merged.models).toHaveLength(3);
  });

  it("providers 去重排序", () => {
    const merged = mergeModelCatalog(selfEntries, gatewayEntries, "gateway");
    expect(merged.providers).toEqual([...merged.providers].sort());
    expect(new Set(merged.providers).size).toBe(merged.providers.length);
  });
});
