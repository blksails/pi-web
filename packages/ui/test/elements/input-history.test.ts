import { describe, it, expect } from "vitest";
import { createInputHistory } from "../../src/elements/input-history.js";

/**
 * 输入历史态机测试(R9 A-3,IDE 终端式翻阅)。
 * 语义:空输入 ↑ 回填上一条;编辑中不劫持;↓ 翻到底回草稿退出翻阅;连续重复不重记。
 */
describe("createInputHistory", () => {
  it("空历史:任何翻阅都不接管", () => {
    const h = createInputHistory();
    expect(h.nav("prev", "")).toBeNull();
    expect(h.nav("next", "")).toBeNull();
  });

  it("空输入 ↑ 回填上一条,继续 ↑ 向旧翻并停在最旧", () => {
    const h = createInputHistory();
    h.push("一");
    h.push("二");
    expect(h.nav("prev", "")).toBe("二");
    expect(h.nav("prev", "二")).toBe("一");
    expect(h.nav("prev", "一")).toBe("一"); // 停在最旧
  });

  it("编辑中(非空输入且未在翻阅态)↑ 不劫持", () => {
    const h = createInputHistory();
    h.push("一");
    expect(h.nav("prev", "写到一半")).toBeNull();
  });

  it("↓ 向新翻,翻到底回草稿并退出翻阅态", () => {
    const h = createInputHistory();
    h.push("一");
    h.push("二");
    h.nav("prev", ""); // → 二
    h.nav("prev", "二"); // → 一
    expect(h.nav("next", "一")).toBe("二");
    expect(h.nav("next", "二")).toBe(""); // 回草稿(空)并退出
    expect(h.nav("next", "")).toBeNull(); // 已退出:↓ 不接管
  });

  it("未在翻阅态 ↓ 不接管;resetBrowse 退出翻阅态", () => {
    const h = createInputHistory();
    h.push("一");
    expect(h.nav("next", "")).toBeNull();
    h.nav("prev", ""); // 进入翻阅
    h.resetBrowse(); // 手动编辑
    expect(h.nav("next", "一改")).toBeNull();
  });

  it("连续重复与空串不重记;push 退出翻阅态", () => {
    const h = createInputHistory();
    h.push("一");
    h.push("一");
    h.push("");
    h.push("二");
    expect(h.nav("prev", "")).toBe("二");
    expect(h.nav("prev", "二")).toBe("一");
    expect(h.nav("prev", "一")).toBe("一"); // 仅两条
  });
});
