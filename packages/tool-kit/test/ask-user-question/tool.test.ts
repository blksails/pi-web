import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ASK_TITLE_SENTINEL,
  encodeAskAnswers,
  type AskAnswers,
  type AskQuestionGroup,
} from "@blksails/pi-web-protocol";
import { describe, expect, it, vi } from "vitest";

import { askUserQuestionTool } from "../../src/runtime.js";

const validGroup: AskQuestionGroup = {
  questions: [
    {
      header: "方案",
      question: "采用哪种实现方案？",
      multiSelect: false,
      allowOther: true,
      options: [
        { label: "方案 A", description: "更简单" },
        { label: "方案 B", description: "更灵活" },
      ],
    },
  ],
};

const richAnswers: AskAnswers = {
  answers: [
    {
      header: "方案",
      question: "采用哪种实现方案？",
      selected: ["方案 B"],
      other: "补充约束",
    },
  ],
};

function resultText(result: Awaited<ReturnType<typeof askUserQuestionTool.execute>>): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("Expected a text tool result");
  return first.text;
}

function makeContext(select: ReturnType<typeof vi.fn>): ExtensionContext {
  return { ui: { select } } as unknown as ExtensionContext;
}

describe("askUserQuestionTool", () => {
  it.each([
    ["zero questions", { questions: [] }],
    [
      "too many options",
      {
        questions: [
          {
            ...validGroup.questions[0],
            options: [
              ...validGroup.questions[0]!.options,
              { label: "方案 C", description: "第三种" },
              { label: "方案 D", description: "第四种" },
              { label: "方案 E", description: "第五种" },
            ],
          },
        ],
      },
    ],
  ])("rejects %s without starting UI interaction", async (_name, params) => {
    const select = vi.fn();

    const result = await askUserQuestionTool.execute(
      "call-1",
      params as Parameters<typeof askUserQuestionTool.execute>[1],
      undefined,
      undefined,
      makeContext(select),
    );

    expect(select).not.toHaveBeenCalled();
    expect(resultText(result)).toContain("1–4");
    expect(resultText(result)).toContain("2–4");
  });

  it("encodes a valid request with the shared title sentinel", async () => {
    const select = vi.fn().mockResolvedValue(undefined);

    await askUserQuestionTool.execute(
      "call-2",
      validGroup,
      undefined,
      undefined,
      makeContext(select),
    );

    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0]?.[0]).toContain(ASK_TITLE_SENTINEL);
    expect(select.mock.calls[0]?.[1]).toEqual(["方案 A", "方案 B"]);
  });

  it("returns structured JSON for a rich answer", async () => {
    const select = vi.fn().mockResolvedValue(encodeAskAnswers(richAnswers));

    const result = await askUserQuestionTool.execute(
      "call-3",
      validGroup,
      undefined,
      undefined,
      makeContext(select),
    );

    expect(JSON.parse(resultText(result))).toEqual(richAnswers);
  });

  it("returns an explicit cancelled result without invented answers", async () => {
    const select = vi.fn().mockResolvedValue(undefined);

    const result = await askUserQuestionTool.execute(
      "call-4",
      validGroup,
      undefined,
      undefined,
      makeContext(select),
    );

    expect(resultText(result)).toContain("取消");
    expect(resultText(result)).not.toContain("selected");
  });

  it("returns a comprehensible degraded result for a legacy raw selection", async () => {
    const select = vi.fn().mockResolvedValue("方案 A");

    const result = await askUserQuestionTool.execute(
      "call-5",
      validGroup,
      undefined,
      undefined,
      makeContext(select),
    );

    expect(resultText(result)).toContain("降级");
    expect(resultText(result)).toContain("方案 A");
  });
});
