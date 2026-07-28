/**
 * examples/aigc-agent · `material-status` route 自检(分发状态只读接入)。
 *
 * 三段:① ids 解析(去空/去重/截断,非串入参视作空)② 无 id 不打平台
 * ③ 平台接缝不可用 / 回调抛错 → 稳定降级结构,**绝不抛**(角标只是增强,
 * 缺了不该让素材面板整块报错)。
 *
 * 写路径(发起分发 / 重试)刻意不存在于本 route —— 它会真的对外投放,须另立写接缝并单独授权。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import {
  MAX_STATUS_IDS,
  materialStatusHandler,
  materialStatusRoute,
  parseStatusIds,
} from "@/examples/aigc-agent/routes/material-status.js";

/** 只取 handler 实际读的 query 段,余下按需扩(形状以 AgentRouteRequest 为准)。 */
const req = (query: Record<string, string>): AgentRouteRequest =>
  ({ query }) as unknown as AgentRouteRequest;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("material-status · ids 解析", () => {
  it("去空白、去空段、去重,保序", () => {
    expect(parseStatusIds(" att_a , att_b ,, att_a ")).toEqual(["att_a", "att_b"]);
  });

  it("非串 / 空串 → 空数组", () => {
    expect(parseStatusIds(undefined)).toEqual([]);
    expect(parseStatusIds("")).toEqual([]);
    expect(parseStatusIds(["att_a"])).toEqual([]);
    expect(parseStatusIds(42)).toEqual([]);
  });

  it("超出上限截断而非报错(角标不值得让整批失败)", () => {
    const many = Array.from({ length: MAX_STATUS_IDS + 50 }, (_, i) => `att_${i}`).join(",");
    expect(parseStatusIds(many)).toHaveLength(MAX_STATUS_IDS);
  });
});

describe("material-status · handler 降级", () => {
  it("无 ids → 空列表,且不触碰平台接缝", async () => {
    // env 给全也不该发起回调(fetch 未打桩,真发就会炸出来)。
    vi.stubEnv("PLATFORM_CALLBACK_URL", "http://127.0.0.1:1/internal");
    vi.stubEnv("PLATFORM_CALLBACK_TOKEN", "t");
    expect(await materialStatusHandler(req({}))).toEqual({ items: [] });
  });

  it("平台接缝未接(无回调 token)→ platform_unavailable + 空列表", async () => {
    vi.stubEnv("PLATFORM_CALLBACK_URL", "");
    vi.stubEnv("PLATFORM_CALLBACK_TOKEN", "");
    expect(await materialStatusHandler(req({ ids: "att_a" }))).toEqual({
      error: "platform_unavailable",
      items: [],
    });
  });

  it("回调失败 → 同一降级结构(不抛)", async () => {
    vi.stubEnv("PLATFORM_CALLBACK_URL", "http://127.0.0.1:1/internal");
    vi.stubEnv("PLATFORM_CALLBACK_TOKEN", "t");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    try {
      expect(await materialStatusHandler(req({ ids: "att_a,att_b" }))).toEqual({
        error: "platform_unavailable",
        items: [],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("平台可用时透传聚合结果", async () => {
    vi.stubEnv("PLATFORM_CALLBACK_URL", "http://127.0.0.1:1/internal");
    vi.stubEnv("PLATFORM_CALLBACK_TOKEN", "t");
    const payload = { items: [{ attachmentId: "att_a", status: "done", advertiserCount: 3 }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    try {
      expect(await materialStatusHandler(req({ ids: "att_a" }))).toEqual(payload);
      // 只读:必须打 /materials/status,不得触碰任何写端点。
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:1/internal/materials/status",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("material-status · 路由声明", () => {
  it("只读:name 与文件名一致,methods 缺省即 GET", () => {
    expect(materialStatusRoute.name).toBe("material-status");
    expect(materialStatusRoute.methods).toBeUndefined();
  });
});
