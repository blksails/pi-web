/**
 * completion 前端提取器单测:wordTail / lineStart 规则 + 多触发符互斥让位。
 */
import { describe, expect, it } from "vitest";
import { findActiveToken } from "../../src/completion/extractors.js";
import type { CompletionTriggerSpec } from "@blksails/protocol";

const AT: CompletionTriggerSpec = { trigger: "@", extract: "wordTail" };
const SLASH: CompletionTriggerSpec = { trigger: "/", extract: "lineStart" };
const DOLLAR: CompletionTriggerSpec = { trigger: "$", extract: "wordTail" };

describe("findActiveToken", () => {
  it("wordTail:@ 词尾取查询与区间", () => {
    const v = "hello @foo";
    const t = findActiveToken([AT], v, v.length);
    expect(t).toEqual({ trigger: "@", query: "foo", start: 6, end: 10 });
  });

  it("wordTail:@ 后含空白则不激活", () => {
    const v = "hello @foo bar";
    expect(findActiveToken([AT], v, v.length)).toBeNull();
  });

  it("lineStart:/ 仅行首激活", () => {
    expect(findActiveToken([SLASH], "/dep", 4)).toEqual({
      trigger: "/",
      query: "dep",
      start: 0,
      end: 4,
    });
    // 非行首的 / 不激活
    expect(findActiveToken([SLASH], "ab/dep", 6)).toBeNull();
  });

  it("多触发符互斥:取离光标最近者", () => {
    const v = "@a $b";
    const t = findActiveToken([AT, DOLLAR], v, v.length);
    expect(t?.trigger).toBe("$"); // $b 更靠近光标
  });

  it("空查询:刚键入触发符也激活(query 为空)", () => {
    const v = "see @";
    expect(findActiveToken([AT], v, v.length)).toEqual({
      trigger: "@",
      query: "",
      start: 4,
      end: 5,
    });
  });

  it("无触发符返回 null", () => {
    expect(findActiveToken([AT], "plain text", 10)).toBeNull();
  });
});
