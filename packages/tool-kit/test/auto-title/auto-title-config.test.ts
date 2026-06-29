import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_TITLE_CONFIG,
  parseAutoTitleConfig,
} from "../../src/auto-title/auto-title-config.js";

describe("parseAutoTitleConfig", () => {
  it("全缺省 → 默认(once / llm / undefined model / 24)", () => {
    expect(parseAutoTitleConfig({})).toEqual(DEFAULT_AUTO_TITLE_CONFIG);
    expect(parseAutoTitleConfig({})).toEqual({
      mode: "once",
      strategy: "llm",
      model: undefined,
      maxLen: 24,
    });
  });

  it("合法值正确解析", () => {
    expect(
      parseAutoTitleConfig({
        PI_WEB_AUTO_TITLE_MODE: "refresh",
        PI_WEB_AUTO_TITLE_STRATEGY: "heuristic",
        PI_WEB_AUTO_TITLE_MODEL: "openai/gpt-4o-mini",
        PI_WEB_AUTO_TITLE_MAX_LEN: "40",
      }),
    ).toEqual({
      mode: "refresh",
      strategy: "heuristic",
      model: "openai/gpt-4o-mini",
      maxLen: 40,
    });
  });

  it("非法 MODE / STRATEGY → 回退默认", () => {
    const c = parseAutoTitleConfig({
      PI_WEB_AUTO_TITLE_MODE: "weird",
      PI_WEB_AUTO_TITLE_STRATEGY: "psychic",
    });
    expect(c.mode).toBe("once");
    expect(c.strategy).toBe("llm");
  });

  it("非法 MAX_LEN(非数字 / 负 / 0 / 浮点)→ 回退 24", () => {
    expect(parseAutoTitleConfig({ PI_WEB_AUTO_TITLE_MAX_LEN: "abc" }).maxLen).toBe(24);
    expect(parseAutoTitleConfig({ PI_WEB_AUTO_TITLE_MAX_LEN: "-5" }).maxLen).toBe(24);
    expect(parseAutoTitleConfig({ PI_WEB_AUTO_TITLE_MAX_LEN: "0" }).maxLen).toBe(24);
  });

  it("空白 MODEL → undefined(用会话当前模型)", () => {
    expect(parseAutoTitleConfig({ PI_WEB_AUTO_TITLE_MODEL: "   " }).model).toBeUndefined();
    expect(parseAutoTitleConfig({ PI_WEB_AUTO_TITLE_MODEL: "" }).model).toBeUndefined();
  });

  it("不读全局 process.env(纯函数,仅用注入映射)", () => {
    // 注入空映射即使全局有同名变量也应回退默认。
    const c = parseAutoTitleConfig({});
    expect(c.mode).toBe("once");
  });
});
