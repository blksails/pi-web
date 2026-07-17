import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type {
  AskQuestionGroup,
  RpcExtensionUIRequest,
} from "@blksails/pi-web-protocol";
import { decodeAskAnswers } from "@blksails/pi-web-protocol";
import { AskUserQuestionCard } from "../../src/elements/ask-user-question-card.js";

const group: AskQuestionGroup = {
  questions: [
    {
      header: "Runtime",
      question: "Choose one runtime",
      multiSelect: false,
      options: [
        { label: "Node", description: "Broad ecosystem" },
        { label: "Deno", description: "Secure defaults" },
      ],
      allowOther: true,
    },
    {
      header: "Features",
      question: "Choose optional features",
      multiSelect: true,
      options: [
        { label: "Cache", description: "Faster reads" },
        { label: "Queue", description: "Async work" },
      ],
      allowOther: false,
    },
  ],
};

const request: Extract<RpcExtensionUIRequest, { method: "select" }> = {
  type: "extension_ui_request",
  id: "askq-1",
  method: "select",
  title: "Questions",
  options: ["Node", "Deno"],
};

describe("AskUserQuestionCard", () => {
  it("在同一卡片渲染多题、选项描述、单选、多选和 Other", () => {
    const { container } = render(
      <AskUserQuestionCard
        group={group}
        request={request}
        pending={false}
        onSubmitEncoded={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("[data-pi-askq-question]")).toHaveLength(2);
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("Choose optional features")).toBeInTheDocument();
    expect(screen.getByText("Broad ecosystem")).toBeInTheDocument();
    expect(screen.getByText("Async work")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Node/ })).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getAllByRole("textbox", { name: "其他答案" })).toHaveLength(2);
  });

  it("单选互斥、多选可多项，并提交 codec value 与可读摘要", async () => {
    const user = userEvent.setup();
    const onSubmitEncoded = vi.fn();
    const { container } = render(
      <AskUserQuestionCard
        group={group}
        request={request}
        pending={false}
        onSubmitEncoded={onSubmitEncoded}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Deno/ }));
    expect(screen.getByRole("radio", { name: /Node/ })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Cache/ }));
    await user.click(screen.getByRole("checkbox", { name: /Queue/ }));
    await user.type(screen.getAllByRole("textbox", { name: "其他答案" })[0]!, "Bun");
    await user.click(container.querySelector("[data-pi-askq-submit]")!);

    const [value, summary] = onSubmitEncoded.mock.calls[0]!;
    expect(decodeAskAnswers(value, group)).toEqual({
      kind: "rich",
      answers: {
        answers: [
          { header: "Runtime", question: "Choose one runtime", selected: ["Deno"], other: "Bun" },
          { header: "Features", question: "Choose optional features", selected: ["Cache", "Queue"] },
        ],
      },
    });
    expect(summary).toBe("Runtime: Deno, Bun · Features: Cache, Queue");
  });

  it("取消上交回调，pending 时禁用所有控件", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = render(
      <AskUserQuestionCard
        group={group}
        request={request}
        pending={false}
        onSubmitEncoded={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(container.querySelector("[data-pi-askq-cancel]")!);
    expect(onCancel).toHaveBeenCalledOnce();

    const pending = render(
      <AskUserQuestionCard
        group={group}
        request={{ ...request, id: "askq-2" }}
        pending
        onSubmitEncoded={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(Array.from(pending.container.querySelectorAll("input, button"))).not.toHaveLength(0);
    for (const control of pending.container.querySelectorAll("input, button")) {
      expect(control).toBeDisabled();
    }
  });
});
