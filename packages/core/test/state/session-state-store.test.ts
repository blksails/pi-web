/**
 * 单元:SessionStateStore 纯逻辑 —— 未初始化语义、rev 单调连续、subscribe 变更派发。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createSessionStateStore,
  type StateChange,
} from "../../src/state/session-state-store.js";

describe("SessionStateStore", () => {
  it("get 未初始化 key 返回 undefined,不报错(1.5)", () => {
    const store = createSessionStateStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("set 返回的 rev 从 0 起、跨 set/delete 严格单调连续(3.5)", () => {
    const store = createSessionStateStore();
    expect(store.set("k", 1)).toBe(0);
    expect(store.set("k", 2)).toBe(1);
    // delete 也推进 rev
    store.delete("k");
    // 删除后再写,rev 继续单调
    expect(store.set("k", 3)).toBe(3);
    expect(store.get("k")).toBe(3);
  });

  it("不同 key 的 rev 各自独立计数", () => {
    const store = createSessionStateStore();
    expect(store.set("a", "x")).toBe(0);
    expect(store.set("b", "y")).toBe(0);
    expect(store.set("a", "z")).toBe(1);
  });

  it("delete 返回是否原本存在,并派发 deleted 变更", () => {
    const store = createSessionStateStore();
    store.set("k", 1);
    const changes: StateChange[] = [];
    store.subscribe((c) => changes.push(c));
    expect(store.delete("k")).toBe(true);
    expect(store.delete("k")).toBe(false); // 已不存在
    expect(store.get("k")).toBeUndefined();
    expect(changes[0]).toMatchObject({ key: "k", deleted: true, value: undefined });
  });

  it("subscribe 收到正确的 StateChange(key/value/rev/deleted)", () => {
    const store = createSessionStateStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.set("count", 42);
    expect(listener).toHaveBeenCalledWith({
      key: "count",
      value: 42,
      rev: 0,
      deleted: false,
    });
    unsub();
    store.set("count", 43);
    expect(listener).toHaveBeenCalledTimes(1); // 取消订阅后不再收到
  });

  it("snapshot 返回 key→{value,rev} 的只读拷贝", () => {
    const store = createSessionStateStore();
    store.set("a", "x");
    store.set("b", 2);
    const snap = store.snapshot();
    expect(snap.get("a")).toEqual({ value: "x", rev: 0 });
    expect(snap.get("b")).toEqual({ value: 2, rev: 0 });
    // 拷贝独立:改 store 不影响已取快照
    store.set("a", "y");
    expect(snap.get("a")).toEqual({ value: "x", rev: 0 });
  });
});
