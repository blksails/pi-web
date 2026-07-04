/**
 * optimize-prompt 单元测试(aigc-tool-settings task 1.2)。
 * 本期为无改写透传占位:返回值恒等于入参(Req 4.4)。
 */
import { describe, it, expect } from "vitest";
import { optimizePrompt } from "../../src/aigc/optimize-prompt.js";

describe("optimizePrompt(占位)", () => {
  it("原样返回入参 prompt(无改写)", async () => {
    expect(await optimizePrompt("一只猫")).toBe("一只猫");
    expect(await optimizePrompt("")).toBe("");
  });
});
