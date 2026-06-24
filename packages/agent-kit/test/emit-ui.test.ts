import { describe, it, expect, vi } from "vitest";
import { emitUi } from "../src/emit-ui.js";
import {
  PI_UI_TOOL_DETAILS_KEY,
  extractToolDetailsUiSpec,
  type UiSpec,
} from "@blksails/pi-web-protocol";

describe("emitUi", () => {
  const spec: UiSpec = {
    kind: "builtin",
    component: "metric",
    props: { value: "1" },
  };

  it("经 onUpdate 以约定 key 携带 UiSpec,且 server 提取助手可还原(端到端契约)", () => {
    const onUpdate = vi.fn();
    emitUi(onUpdate, spec);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0]![0] as {
      content: unknown[];
      details: Record<string, unknown>;
    };
    expect(arg.content).toEqual([]);
    expect(arg.details[PI_UI_TOOL_DETAILS_KEY]).toEqual(spec);
    // 锁定两端契约:protocol 侧能从该 partialResult 还原同一 UiSpec。
    expect(extractToolDetailsUiSpec(arg)).toEqual(spec);
  });

  it("onUpdate 为 undefined 时安全无操作", () => {
    expect(() => emitUi(undefined, spec)).not.toThrow();
  });

  it("onUpdate 非函数时安全无操作", () => {
    expect(() => emitUi(123, spec)).not.toThrow();
  });
});
