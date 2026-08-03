/**
 * 单元:createSurfaceDispatcher(agent-authoritative-surface 的纯派发器)。
 * 脱离 FrameChannel/stdio 直接测 domain 查表 + dispatch + 错误归一化。
 */
import { describe, it, expect, vi } from "vitest";
import { createSurfaceDispatcher } from "../../src/runner/surface-command-dispatcher.js";
import { SURFACE_REGISTRY_SEAM_KEY } from "../../src/runner/frame-channel/index.js";

function seamWith(domain: string, dispatch: unknown): Record<string, unknown> {
  return {
    [SURFACE_REGISTRY_SEAM_KEY]: {
      entries: new Map<string, unknown>([[domain, { dispatch }]]),
    },
  };
}

describe("createSurfaceDispatcher", () => {
  it("命中 domain → 透传 dispatch 结果,args 原样传入", async () => {
    const dispatch = vi.fn(async (action: string, args: unknown) => ({
      domain: "demo",
      action,
      ok: true,
      data: { args },
    }));
    const d = createSurfaceDispatcher(seamWith("demo", dispatch), SURFACE_REGISTRY_SEAM_KEY);
    const out = await d.dispatch("demo", "increment", { by: 2 });
    expect(dispatch).toHaveBeenCalledWith("increment", { by: 2 });
    expect(out).toEqual({ domain: "demo", action: "increment", ok: true, data: { args: { by: 2 } } });
  });

  it("未注册 domain → surface_not_registered", async () => {
    const d = createSurfaceDispatcher(seamWith("demo", vi.fn()), SURFACE_REGISTRY_SEAM_KEY);
    const out = await d.dispatch("absent", "x", undefined);
    expect(out).toMatchObject({
      domain: "absent",
      action: "x",
      ok: false,
      error: { code: "surface_not_registered" },
    });
  });

  it("无 seam → surface_not_registered(惰性降级)", async () => {
    const d = createSurfaceDispatcher({}, SURFACE_REGISTRY_SEAM_KEY);
    const out = await d.dispatch("demo", "x", undefined);
    expect(out).toMatchObject({ ok: false, error: { code: "surface_not_registered" } });
  });

  it("dispatch 抛错 → dispatch_failed(最终防线,不 reject)", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("kaboom");
    });
    const d = createSurfaceDispatcher(seamWith("demo", dispatch), SURFACE_REGISTRY_SEAM_KEY);
    const out = await d.dispatch("demo", "x", undefined);
    expect(out).toMatchObject({
      domain: "demo",
      action: "x",
      ok: false,
      error: { code: "dispatch_failed", message: expect.stringContaining("kaboom") },
    });
  });
});
