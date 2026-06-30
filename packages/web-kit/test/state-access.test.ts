/**
 * 单元:createWebExtStateAccess(state-injection-bridge, Task 3.5)。
 * 验证 webext 状态接入经同一通道读/订阅/写回,行为与 hook 一致。
 */
import { describe, it, expect, vi } from "vitest";
import { createWebExtStateAccess } from "../src/state-access.js";

describe("createWebExtStateAccess", () => {
  it("get 经 read 直读;set/delete 经 write 写回(7.1/7.2)", async () => {
    const store: Record<string, unknown> = { count: 3 };
    const write = vi.fn(async () => {});
    const access = createWebExtStateAccess({
      read: (k) => store[k],
      subscribe: () => () => {},
      write,
    });
    expect(access.get<number>("count")).toBe(3);
    await access.set("count", 9);
    expect(write).toHaveBeenCalledWith("count", 9, "set");
    await access.delete("count");
    expect(write).toHaveBeenCalledWith("count", undefined, "delete");
  });

  it("subscribe 仅在该 key 值变化时回调(避免无关 key 抖动)", () => {
    const store: Record<string, unknown> = { a: 1, b: 1 };
    let storeListener: (() => void) | undefined;
    const access = createWebExtStateAccess({
      read: (k) => store[k],
      subscribe: (l) => {
        storeListener = l;
        return () => {};
      },
      write: async () => {},
    });
    const cb = vi.fn();
    access.subscribe("a", cb);
    // 改无关 key b → 不回调
    store.b = 2;
    storeListener!();
    expect(cb).not.toHaveBeenCalled();
    // 改 a → 回调一次,带新值
    store.a = 5;
    storeListener!();
    expect(cb).toHaveBeenCalledWith(5);
  });
});
