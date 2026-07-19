/**
 * 单元:ControlStore 的 sourceSettings 切片(source-settings-and-slots,任务 7.2)。
 *  - control:"settings-changed" 帧更新 sourceSettings[sourceKey]
 *  - 多 sourceKey 互不覆盖
 *  - 同 sourceKey 后到帧覆盖前一帧(last-value,与服务端 sticky 单值语义一致)
 */
import { describe, it, expect } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type { ControlPayload } from "@blksails/pi-web-protocol";

function settingsChangedFrame(
  sourceKey: string,
  values: Record<string, unknown>,
  liveReloadKeys: string[],
): ControlPayload {
  return { control: "settings-changed", sourceKey, values, liveReloadKeys };
}

describe("ControlStore · sourceSettings slice (task 7.2)", () => {
  it("应用 control:settings-changed 帧到 sourceSettings 切片,按 sourceKey 分区", () => {
    const store = new ControlStore();
    store.applyControlFrame(
      settingsChangedFrame("abc123", { apiBase: "https://x.test" }, ["notifyEmail"]),
    );
    expect(store.getSnapshot().sourceSettings["abc123"]).toEqual({
      values: { apiBase: "https://x.test" },
      liveReloadKeys: ["notifyEmail"],
    });
  });

  it("多 sourceKey 互不覆盖", () => {
    const store = new ControlStore();
    store.applyControlFrame(settingsChangedFrame("aaa", { x: 1 }, []));
    store.applyControlFrame(settingsChangedFrame("bbb", { x: 2 }, []));
    expect(store.getSnapshot().sourceSettings["aaa"]).toEqual({ values: { x: 1 }, liveReloadKeys: [] });
    expect(store.getSnapshot().sourceSettings["bbb"]).toEqual({ values: { x: 2 }, liveReloadKeys: [] });
  });

  it("同 sourceKey 后到帧覆盖前一帧(last-value)", () => {
    const store = new ControlStore();
    store.applyControlFrame(settingsChangedFrame("abc123", { apiBase: "v1" }, []));
    store.applyControlFrame(settingsChangedFrame("abc123", { apiBase: "v2" }, ["notifyEmail"]));
    expect(store.getSnapshot().sourceSettings["abc123"]).toEqual({
      values: { apiBase: "v2" },
      liveReloadKeys: ["notifyEmail"],
    });
  });

  it("未收到过该 sourceKey 帧时切片无对应键", () => {
    const store = new ControlStore();
    expect(store.getSnapshot().sourceSettings["never-sent"]).toBeUndefined();
  });
});
