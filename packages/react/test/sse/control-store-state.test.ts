/**
 * 单元:ControlStore 的 states 切片(state-injection-bridge)。
 *  - control:"state" 帧更新 states[key]
 *  - rev 守卫:不大于已应用 rev 的帧被丢弃(乱序保护)
 *  - deleted 删键;相同/过期帧引用稳定(防抖动)
 */
import { describe, it, expect } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type { ControlPayload } from "@blksails/pi-web-protocol";

function stateFrame(
  key: string,
  value: unknown,
  rev: number,
  deleted?: boolean,
): ControlPayload {
  return deleted === undefined
    ? { control: "state", key, value, rev }
    : { control: "state", key, value, rev, deleted };
}

describe("ControlStore · states slice", () => {
  it("应用 control:state 帧到 states 切片(3.2)", () => {
    const store = new ControlStore();
    store.applyControlFrame(stateFrame("count", 1, 0));
    expect(store.getSnapshot().states.count).toEqual({ value: 1, rev: 0 });
    store.applyControlFrame(stateFrame("count", 2, 1));
    expect(store.getSnapshot().states.count).toEqual({ value: 2, rev: 1 });
  });

  it("rev 守卫:不大于已应用 rev 的帧被丢弃(3.3)", () => {
    const store = new ControlStore();
    store.applyControlFrame(stateFrame("k", "v2", 2));
    const before = store.getSnapshot();
    // 过期帧(rev=1 < 2)被丢弃,引用稳定
    store.applyControlFrame(stateFrame("k", "v1", 1));
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().states.k).toEqual({ value: "v2", rev: 2 });
    // 相同 rev 也丢弃
    store.applyControlFrame(stateFrame("k", "vX", 2));
    expect(store.getSnapshot()).toBe(before);
  });

  it("deleted 帧删除 key;已无该键时引用稳定", () => {
    const store = new ControlStore();
    store.applyControlFrame(stateFrame("k", 1, 0));
    store.applyControlFrame(stateFrame("k", undefined, 1, true));
    expect(store.getSnapshot().states.k).toBeUndefined();
    // 对不存在的 key 再删(更高 rev),引用稳定
    const after = store.getSnapshot();
    store.applyControlFrame(stateFrame("k", undefined, 2, true));
    expect(store.getSnapshot()).toBe(after);
  });

  it("多 key 互不干扰", () => {
    const store = new ControlStore();
    store.applyControlFrame(stateFrame("a", "x", 0));
    store.applyControlFrame(stateFrame("b", "y", 0));
    expect(store.getSnapshot().states).toEqual({
      a: { value: "x", rev: 0 },
      b: { value: "y", rev: 0 },
    });
  });
});
