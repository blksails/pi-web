/**
 * agent-slash-completion task 1.1:slash 候选声明 + 装配期帧 schema。
 * 覆盖 Req 1.1(声明 name 必填、description/insertText 可选;帧形状)。
 */
import { describe, expect, it } from "vitest";
import {
  SlashCompletionDeclSchema,
  SlashCompletionsFrameSchema,
} from "../../src/transport/slash-completion.js";

describe("SlashCompletionDeclSchema", () => {
  it("接受最小声明(仅 name)", () => {
    expect(SlashCompletionDeclSchema.parse({ name: "img-gen" })).toEqual({
      name: "img-gen",
    });
  });

  it("接受含 description/insertText 的完整声明", () => {
    const d = { name: "img-gen", description: "生成图像", insertText: "/img-gen " };
    expect(SlashCompletionDeclSchema.parse(d)).toEqual(d);
  });

  it("拒绝空 name 与缺 name", () => {
    expect(SlashCompletionDeclSchema.safeParse({ name: "" }).success).toBe(false);
    expect(SlashCompletionDeclSchema.safeParse({}).success).toBe(false);
  });
});

describe("SlashCompletionsFrameSchema", () => {
  it("解析合法帧", () => {
    const f = { type: "slash_completions", items: [{ name: "img-gen" }] };
    expect(SlashCompletionsFrameSchema.parse(f)).toEqual(f);
  });

  it("接受空 items", () => {
    expect(
      SlashCompletionsFrameSchema.parse({ type: "slash_completions", items: [] })
        .items,
    ).toEqual([]);
  });

  it("拒绝错误 type", () => {
    expect(
      SlashCompletionsFrameSchema.safeParse({ type: "ui_rpc_response", items: [] })
        .success,
    ).toBe(false);
  });
});
