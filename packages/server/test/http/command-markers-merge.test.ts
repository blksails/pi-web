/**
 * 单元:mergeCommandMarkers — 把 piweb.command 标记按 timestamp 稳定合并进消息序列
 * (spec plugin-system-unification R13.3)。覆盖:末尾插入 / 中间插入 / 同 ts(消息在前标记在后)/
 * 缺数值 ts 退化追加末尾 / 无标记原样 / 多标记相对序。
 */
import { describe, it, expect } from "vitest";
import { mergeCommandMarkers } from "../../src/http/routes/query-routes.js";

const msg = (role: string, ts: number, text = "") => ({
  role,
  content: [{ type: "text", text }],
  timestamp: ts,
});
const textOf = (m: unknown) =>
  ((m as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? "";
const roleOf = (m: unknown) => (m as { role?: string }).role;

describe("mergeCommandMarkers", () => {
  it("无标记 → 原样返回(浅拷贝)", () => {
    const messages = [msg("user", 1, "hi"), msg("assistant", 2, "yo")];
    const out = mergeCommandMarkers(messages, []);
    expect(out).toEqual(messages);
  });

  it("标记 ts 在末尾 → 追加到序列尾部,呈现为 user 气泡携带命令文本", () => {
    const messages = [msg("user", 10, "hi"), msg("assistant", 20, "yo")];
    const out = mergeCommandMarkers(messages, [{ text: "/review", ts: 30 }]);
    expect(out).toHaveLength(3);
    expect(roleOf(out[2])).toBe("user");
    expect(textOf(out[2])).toBe("/review");
  });

  it("标记 ts 在中间 → 插入到对应位置", () => {
    const messages = [msg("user", 10), msg("assistant", 40)];
    const out = mergeCommandMarkers(messages, [{ text: "/review", ts: 20 }]);
    expect(out.map(textOf)).toEqual(["", "/review", ""]);
    expect(out.map((m) => (m as { timestamp: number }).timestamp)).toEqual([
      10, 20, 40,
    ]);
  });

  it("同 ts → 消息在前、标记在后(命令在该消息之后执行)", () => {
    const messages = [msg("user", 10, "first")];
    const out = mergeCommandMarkers(messages, [{ text: "/cmd", ts: 10 }]);
    expect(out.map(textOf)).toEqual(["first", "/cmd"]);
  });

  it("多标记保持按 ts 升序的相对序", () => {
    const messages = [msg("user", 5)];
    const out = mergeCommandMarkers(messages, [
      { text: "/b", ts: 30 },
      { text: "/a", ts: 20 },
    ]);
    expect(out.map(textOf)).toEqual(["", "/a", "/b"]);
  });

  it("任一消息缺数值 ts → 退化:全部标记按 ts 升序追加末尾(绝不丢失)", () => {
    const messages = [{ role: "user", content: [] }, msg("assistant", 99)];
    const out = mergeCommandMarkers(messages, [
      { text: "/late", ts: 50 },
      { text: "/early", ts: 10 },
    ]);
    expect(out).toHaveLength(4);
    // 原消息保持原序在前,标记按 ts 升序追加。
    expect(textOf(out[2])).toBe("/early");
    expect(textOf(out[3])).toBe("/late");
  });
});
