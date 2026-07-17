import { describe, expect, it } from "vitest";
import {
  ASK_ANSWER_SENTINEL,
  ASK_TITLE_SENTINEL,
  AskQuestionGroupSchema,
  decodeAskAnswers,
  decodeAskTitle,
  encodeAskAnswers,
  encodeAskRequest,
  isAskTitle,
  type AskAnswers,
  type AskQuestionGroup,
} from "../../src/rpc/ask-user-question.js";

const singleQuestionGroup: AskQuestionGroup = {
  questions: [
    {
      header: "Env",
      question: "Which environment should this deploy to?",
      multiSelect: false,
      options: [
        { label: "staging", description: "Deploy to staging first" },
        { label: "prod", description: "Deploy directly to production" },
      ],
    },
  ],
};

const multiQuestionGroupWithOther: AskQuestionGroup = {
  questions: [
    {
      header: "Env",
      question: "Which environment should this deploy to?",
      multiSelect: false,
      options: [
        { label: "staging", description: "Deploy to staging first" },
        { label: "prod", description: "Deploy directly to production" },
      ],
      allowOther: true,
    },
    {
      header: "Notify",
      question: "Who should be notified?",
      multiSelect: true,
      options: [
        { label: "team", description: "Notify the whole team" },
        { label: "lead", description: "Notify only the lead" },
        { label: "none", description: "No notification" },
      ],
      allowOther: true,
    },
  ],
};

const multiQuestionGroupNoOther: AskQuestionGroup = {
  questions: [
    {
      header: "Env",
      question: "Which environment should this deploy to?",
      multiSelect: false,
      options: [
        { label: "staging", description: "Deploy to staging first" },
        { label: "prod", description: "Deploy directly to production" },
      ],
    },
    {
      header: "Notify",
      question: "Who should be notified?",
      multiSelect: true,
      options: [
        { label: "team", description: "Notify the whole team" },
        { label: "lead", description: "Notify only the lead" },
      ],
    },
  ],
};

describe("encodeAskRequest / decodeAskTitle round-trip", () => {
  const cases: Array<[string, AskQuestionGroup]> = [
    ["single question", singleQuestionGroup],
    ["multi question with Other", multiQuestionGroupWithOther],
    ["multi question without Other", multiQuestionGroupNoOther],
  ];

  it.each(cases)("round-trips %s", (_label, group) => {
    const { title } = encodeAskRequest(group);
    expect(isAskTitle(title)).toBe(true);
    expect(decodeAskTitle(title)).toEqual(group);
  });
});

describe("encodeAskAnswers / decodeAskAnswers rich round-trip", () => {
  it("round-trips a single-select answer (selected has exactly 1)", () => {
    const answers: AskAnswers = {
      answers: [
        {
          header: "Env",
          question: "Which environment should this deploy to?",
          selected: ["staging"],
        },
      ],
    };
    const value = encodeAskAnswers(answers);
    const result = decodeAskAnswers(value, singleQuestionGroup);
    expect(result.kind).toBe("rich");
    if (result.kind === "rich") {
      expect(result.answers).toEqual(answers);
    }
  });

  it("round-trips a multi-select answer (selected has 0..n)", () => {
    const answers: AskAnswers = {
      answers: [
        {
          header: "Env",
          question: "Which environment should this deploy to?",
          selected: ["staging"],
        },
        {
          header: "Notify",
          question: "Who should be notified?",
          selected: ["team", "lead"],
        },
      ],
    };
    const value = encodeAskAnswers(answers);
    const result = decodeAskAnswers(value, multiQuestionGroupWithOther);
    expect(result.kind).toBe("rich");
    if (result.kind === "rich") {
      expect(result.answers).toEqual(answers);
    }
  });

  it("round-trips an answer with empty selection (0 selected, multi-select)", () => {
    const answers: AskAnswers = {
      answers: [
        {
          header: "Notify",
          question: "Who should be notified?",
          selected: [],
        },
      ],
    };
    const value = encodeAskAnswers(answers);
    const result = decodeAskAnswers(value, multiQuestionGroupWithOther);
    expect(result.kind).toBe("rich");
    if (result.kind === "rich") {
      expect(result.answers).toEqual(answers);
    }
  });

  it("round-trips an answer with Other free text", () => {
    const answers: AskAnswers = {
      answers: [
        {
          header: "Env",
          question: "Which environment should this deploy to?",
          selected: [],
          other: "canary",
        },
      ],
    };
    const value = encodeAskAnswers(answers);
    const result = decodeAskAnswers(value, multiQuestionGroupWithOther);
    expect(result.kind).toBe("rich");
    if (result.kind === "rich") {
      expect(result.answers).toEqual(answers);
    }
  });
});

describe("decodeAskAnswers degraded fallback", () => {
  it("returns degraded with rawValue for a sentinel-less value", () => {
    const result = decodeAskAnswers("staging", singleQuestionGroup);
    expect(result).toEqual({ kind: "degraded", rawValue: "staging" });
  });

  it("returns degraded for a sentinel-prefixed but corrupted JSON payload", () => {
    const value = `${ASK_ANSWER_SENTINEL}{not valid json`;
    const result = decodeAskAnswers(value, singleQuestionGroup);
    expect(result).toEqual({ kind: "degraded", rawValue: value });
  });

  it("returns degraded for a sentinel-prefixed payload failing schema validation", () => {
    const value = `${ASK_ANSWER_SENTINEL}${JSON.stringify({ answers: "not-an-array" })}`;
    const result = decodeAskAnswers(value, singleQuestionGroup);
    expect(result).toEqual({ kind: "degraded", rawValue: value });
  });
});

describe("AskQuestionGroupSchema validation limits", () => {
  it("rejects a group with 0 questions", () => {
    expect(
      AskQuestionGroupSchema.safeParse({ questions: [] }).success,
    ).toBe(false);
  });

  it("rejects a group with 5 questions", () => {
    const question = singleQuestionGroup.questions[0]!;
    const group = { questions: Array.from({ length: 5 }, () => question) };
    expect(AskQuestionGroupSchema.safeParse(group).success).toBe(false);
  });

  it("rejects a question with 1 option", () => {
    const group = {
      questions: [
        {
          header: "Env",
          question: "Which environment?",
          multiSelect: false,
          options: [{ label: "staging", description: "Deploy to staging" }],
        },
      ],
    };
    expect(AskQuestionGroupSchema.safeParse(group).success).toBe(false);
  });

  it("rejects a question with 5 options", () => {
    const option = { label: "opt", description: "an option" };
    const group = {
      questions: [
        {
          header: "Env",
          question: "Which environment?",
          multiSelect: false,
          options: Array.from({ length: 5 }, () => option),
        },
      ],
    };
    expect(AskQuestionGroupSchema.safeParse(group).success).toBe(false);
  });
});

describe("decodeAskTitle non-payload titles", () => {
  it("returns undefined for a plain title", () => {
    expect(decodeAskTitle("普通标题")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(decodeAskTitle("")).toBeUndefined();
  });

  it("returns undefined (not throw) for a title with the sentinel but corrupted JSON", () => {
    const title = `Pick one${ASK_TITLE_SENTINEL}{not valid json`;
    expect(() => decodeAskTitle(title)).not.toThrow();
    expect(decodeAskTitle(title)).toBeUndefined();
  });
});

describe("encodeAskRequest degraded fallback for legacy frontends", () => {
  it("returns non-empty options taken from the first question's option labels", () => {
    const { options } = encodeAskRequest(multiQuestionGroupWithOther);
    expect(options).toEqual(["staging", "prod"]);
  });

  it("includes a human-readable leading prefix before the sentinel in title", () => {
    const { title } = encodeAskRequest(singleQuestionGroup);
    const sentinelIndex = title.indexOf(ASK_TITLE_SENTINEL);
    expect(sentinelIndex).toBeGreaterThan(0);
    const prefix = title.slice(0, sentinelIndex);
    expect(prefix.length).toBeGreaterThan(0);
    expect(prefix).toContain("Which environment should this deploy to?");
  });
});
