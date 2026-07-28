/**
 * 单元:自动标题总开关门控下沉(spec: runner-self-resolved-builtins,任务 2.2;Req 3.2)。
 *
 * 改造前该判定在主进程(关闭时不下发入口 → 扩展不注入);runner 改自解析后入口恒被解析,
 * 故判定下沉到扩展内部。本测试锁住「关闭=无效果」这一用户可观察结果。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import autoTitleExtension, {
  isAutoTitleEnabled,
} from "../../src/auto-title/auto-title-extension.js";

function fakePi(): { pi: ExtensionAPI; on: ReturnType<typeof vi.fn> } {
  const on = vi.fn();
  return { pi: { on } as unknown as ExtensionAPI, on };
}

const ORIGINAL = process.env["PI_WEB_AUTO_TITLE"];
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["PI_WEB_AUTO_TITLE"];
  else process.env["PI_WEB_AUTO_TITLE"] = ORIGINAL;
});

describe("isAutoTitleEnabled — 判据与主进程原语义一致", () => {
  it('仅 "0" 视为关闭;未设置/其他值均启用', () => {
    expect(isAutoTitleEnabled({ PI_WEB_AUTO_TITLE: "0" })).toBe(false);
    expect(isAutoTitleEnabled({})).toBe(true);
    expect(isAutoTitleEnabled({ PI_WEB_AUTO_TITLE: "1" })).toBe(true);
    expect(isAutoTitleEnabled({ PI_WEB_AUTO_TITLE: "" })).toBe(true);
  });
});

describe("扩展装配:关闭=无效果(Req 3.2)", () => {
  it('PI_WEB_AUTO_TITLE="0" → 不注册 agent_end handler', () => {
    process.env["PI_WEB_AUTO_TITLE"] = "0";
    const { pi, on } = fakePi();
    autoTitleExtension(pi);
    // 变异判据:若门控未下沉(扩展内不判开关),此处会注册 handler → 转红,
    // 意味着关闭开关后自动标题仍会生效,破坏既有用户可观察语义。
    expect(on).not.toHaveBeenCalled();
  });

  it("默认(未设置)→ 照常注册 agent_end handler", () => {
    delete process.env["PI_WEB_AUTO_TITLE"];
    const { pi, on } = fakePi();
    autoTitleExtension(pi);
    expect(on).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });
});
