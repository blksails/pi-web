/**
 * 单元:getSessionState 作者接入点(state-injection-bridge)。
 *  - seam 存在时 get/set/delete/snapshot 直达 provider
 *  - seam 缺失时优雅降级(available:false,读 undefined,写 no-op,不抛)
 */
import { describe, it, expect, vi } from "vitest";
import {
  getSessionState,
  SESSION_STATE_SEAM_KEY,
} from "../src/session-state.js";

describe("getSessionState", () => {
  it("seam 缺失时降级:available=false,读 undefined,写 no-op 不抛(1.2/1.3 降级)", () => {
    const scope: Record<string, unknown> = {};
    const s = getSessionState(scope);
    expect(s.available).toBe(false);
    expect(s.get("k")).toBeUndefined();
    expect(() => s.set("k", 1)).not.toThrow();
    expect(s.snapshot()).toEqual({});
  });

  it("seam 存在时 get/set/delete/snapshot 直达 provider(1.2/1.3)", () => {
    const get = vi.fn().mockReturnValue(42);
    const set = vi.fn();
    const del = vi.fn();
    const snapshot = vi.fn().mockReturnValue({ a: 1 });
    const scope: Record<string, unknown> = {
      [SESSION_STATE_SEAM_KEY]: { get, set, delete: del, snapshot },
    };
    const s = getSessionState(scope);
    expect(s.available).toBe(true);
    expect(s.get<number>("count")).toBe(42);
    expect(get).toHaveBeenCalledWith("count");
    s.set("count", 7);
    expect(set).toHaveBeenCalledWith("count", 7);
    s.delete("count");
    expect(del).toHaveBeenCalledWith("count");
    expect(s.snapshot()).toEqual({ a: 1 });
  });

  it("seam 形状不合(缺 get/set)时也降级", () => {
    const scope: Record<string, unknown> = {
      [SESSION_STATE_SEAM_KEY]: { foo: 1 },
    };
    expect(getSessionState(scope).available).toBe(false);
  });
});
