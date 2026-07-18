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

function renderCard(overrides?: {
  readonly pending?: boolean;
  readonly onSubmitEncoded?: ReturnType<typeof vi.fn>;
  readonly onCancel?: ReturnType<typeof vi.fn>;
  readonly error?: string;
}) {
  return render(
    <AskUserQuestionCard
      group={group}
      request={request}
      pending={overrides?.pending ?? false}
      error={overrides?.error}
      onSubmitEncoded={overrides?.onSubmitEncoded ?? vi.fn()}
      onCancel={overrides?.onCancel ?? vi.fn()}
    />,
  );
}

describe("AskUserQuestionCard", () => {
  it("多题使用 Tabs，且一次只渲染当前问题", async () => {
    const user = userEvent.setup();
    const { container } = renderCard();

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const runtimeTab = screen.getByRole("tab", { name: "Runtime" });
    const featuresTab = screen.getByRole("tab", { name: "Features" });
    expect(runtimeTab).toHaveAttribute("aria-selected", "true");
    expect(featuresTab).toHaveAttribute("aria-selected", "false");
    const panels = container.querySelectorAll<HTMLElement>("[data-pi-askq-panel]");
    expect(panels).toHaveLength(2);
    expect(panels[0]).not.toHaveAttribute("hidden");
    expect(panels[1]).toHaveAttribute("hidden");
    expect(runtimeTab).toHaveAttribute("aria-controls", panels[0]!.id);
    expect(featuresTab).toHaveAttribute("aria-controls", panels[1]!.id);
    expect(panels[0]).toHaveAttribute("aria-labelledby", runtimeTab.id);
    expect(panels[1]).toHaveAttribute("aria-labelledby", featuresTab.id);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Runtime");
    expect(screen.getByText("Choose one runtime")).toBeInTheDocument();
    expect(screen.getByText("Broad ecosystem")).toBeInTheDocument();
    expect(screen.getByText("Choose optional features")).not.toBeVisible();
    expect(screen.getByText("Async work")).not.toBeVisible();

    await user.click(featuresTab);

    expect(featuresTab).toHaveFocus();
    expect(runtimeTab).toHaveAttribute("aria-selected", "false");
    expect(featuresTab).toHaveAttribute("aria-selected", "true");
    expect(panels[0]).toHaveAttribute("hidden");
    expect(panels[1]).not.toHaveAttribute("hidden");
    expect(screen.getByText("Choose one runtime")).not.toBeVisible();
    expect(screen.getByText("Choose optional features")).toBeInTheDocument();
    expect(screen.getByText("Async work")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("多题时使用上一步/下一步导航，并仅在最后一题提交", async () => {
    const user = userEvent.setup();
    const onSubmitEncoded = vi.fn();
    const threeQuestionGroup: AskQuestionGroup = {
      questions: [
        ...group.questions,
        {
          header: "Deploy",
          question: "Choose a deploy target",
          multiSelect: false,
          options: [
            { label: "Cloud", description: "Managed runtime" },
            { label: "Local", description: "Self hosted" },
          ],
          allowOther: false,
        },
      ],
    };
    const { container } = render(
      <AskUserQuestionCard
        group={threeQuestionGroup}
        request={request}
        pending={false}
        onSubmitEncoded={onSubmitEncoded}
        onCancel={vi.fn()}
      />,
    );

    expect(container.querySelector("[data-pi-askq-previous]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-pi-askq-submit]")).not.toBeInTheDocument();
    const next = container.querySelector("[data-pi-askq-next]")!;
    expect(next).toHaveTextContent("下一步");
    await user.click(screen.getByRole("radio", { name: /Deno/ }));

    await user.click(next);

    expect(screen.getByRole("tab", { name: "Features" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(onSubmitEncoded).not.toHaveBeenCalled();
    expect(container.querySelector("[data-pi-askq-previous]")).toHaveTextContent(
      "上一步",
    );
    expect(container.querySelector("[data-pi-askq-next]")).toHaveTextContent("下一步");
    expect(container.querySelector("[data-pi-askq-submit]")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Cache/ }));

    await user.click(container.querySelector("[data-pi-askq-next]")!);
    expect(screen.getByRole("tab", { name: "Deploy" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(container.querySelector("[data-pi-askq-next]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-pi-askq-previous]")).toHaveTextContent("上一步");
    expect(container.querySelector("[data-pi-askq-submit]")).toHaveTextContent("提交答案");

    await user.click(container.querySelector("[data-pi-askq-previous]")!);
    expect(screen.getByRole("checkbox", { name: /Cache/ })).toBeChecked();
    await user.click(container.querySelector("[data-pi-askq-previous]")!);
    expect(screen.getByRole("tab", { name: "Runtime" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("radio", { name: /Deno/ })).toBeChecked();
    expect(onSubmitEncoded).not.toHaveBeenCalled();
  });

  it("支持方向键、Home 和 End 切换 Tab 并移动焦点", async () => {
    const user = userEvent.setup();
    renderCard();
    const runtimeTab = screen.getByRole("tab", { name: "Runtime" });
    const featuresTab = screen.getByRole("tab", { name: "Features" });

    runtimeTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(featuresTab).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(runtimeTab).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(featuresTab).toHaveFocus();
    expect(featuresTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(runtimeTab).toHaveFocus();
    expect(runtimeTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(featuresTab).toHaveFocus();
    await user.keyboard("{Home}");
    expect(runtimeTab).toHaveFocus();
  });

  it("单题不渲染 Tabs 或孤立 tabpanel，并直接提交", async () => {
    const user = userEvent.setup();
    const onSubmitEncoded = vi.fn();
    const singleGroup: AskQuestionGroup = { questions: [group.questions[0]!] };
    const { container } = render(
      <AskUserQuestionCard
        group={singleGroup}
        request={request}
        pending={false}
        onSubmitEncoded={onSubmitEncoded}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-pi-askq-panel]")).toHaveLength(1);
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("Choose one runtime")).toBeInTheDocument();
    expect(container.querySelector("[data-pi-askq-previous]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-pi-askq-next]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-pi-askq-submit]")).toHaveTextContent(
      "提交答案",
    );

    await user.click(container.querySelector("[data-pi-askq-submit]")!);
    expect(onSubmitEncoded).toHaveBeenCalledOnce();
  });

  it("多选题可清空为零项并提交", async () => {
    const user = userEvent.setup();
    const onSubmitEncoded = vi.fn();
    const { container } = renderCard({ onSubmitEncoded });

    await user.click(screen.getByRole("tab", { name: "Features" }));
    const cache = screen.getByRole("checkbox", { name: /Cache/ });
    await user.click(cache);
    await user.click(cache);
    await user.click(container.querySelector("[data-pi-askq-submit]")!);

    const [value] = onSubmitEncoded.mock.calls[0]!;
    const decoded = decodeAskAnswers(value, group);
    expect(decoded.kind).toBe("rich");
    if (decoded.kind !== "rich") throw new Error("expected rich answers");
    expect(decoded.answers.answers[1]!.selected).toEqual([]);
  });

  it("切换时保留各题答案，并提交所有 Tab 的多选与 Other", async () => {
    const user = userEvent.setup();
    const onSubmitEncoded = vi.fn();
    const { container } = renderCard({ onSubmitEncoded });

    await user.click(screen.getByRole("radio", { name: /Deno/ }));
    await user.type(screen.getByRole("textbox", { name: "其他答案" }), "Bun");
    await user.click(screen.getByRole("tab", { name: "Features" }));
    await user.click(screen.getByRole("checkbox", { name: /Cache/ }));
    await user.click(screen.getByRole("checkbox", { name: /Queue/ }));
    await user.type(screen.getByRole("textbox", { name: "其他答案" }), "Metrics");

    await user.click(screen.getByRole("tab", { name: "Runtime" }));
    expect(screen.getByRole("radio", { name: /Deno/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "其他答案" })).toHaveValue("Bun");
    await user.click(container.querySelector("[data-pi-askq-next]")!);
    await user.click(container.querySelector("[data-pi-askq-submit]")!);

    const [value, summary] = onSubmitEncoded.mock.calls[0]!;
    expect(decodeAskAnswers(value, group)).toEqual({
      kind: "rich",
      answers: {
        answers: [
          {
            header: "Runtime",
            question: "Choose one runtime",
            selected: ["Deno"],
            other: "Bun",
          },
          {
            header: "Features",
            question: "Choose optional features",
            selected: ["Cache", "Queue"],
            other: "Metrics",
          },
        ],
      },
    });
    expect(summary).toBe(
      "Runtime: Deno, Bun · Features: Cache, Queue, Metrics",
    );
  });

  it("取消上交回调，pending 时禁用 Tabs、输入和操作", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container, unmount } = renderCard({ onCancel });
    await user.click(container.querySelector("[data-pi-askq-cancel]")!);
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();

    const pending = renderCard({ pending: true });
    const controls = pending.container.querySelectorAll("input, button");
    expect(controls).not.toHaveLength(0);
    for (const control of controls) {
      expect(control).toBeDisabled();
    }
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toBeDisabled();
    }
  });

  it("错误提示与操作区保留在卡片底部", () => {
    const { container } = renderCard({ error: "Try again" });
    const panel = container.querySelector<HTMLElement>(
      "[data-pi-askq-panel]:not([hidden])",
    )!;
    const error = container.querySelector<HTMLElement>("[data-pi-askq-error]")!;
    const actions = container.querySelector<HTMLElement>("[data-pi-askq-actions]")!;

    expect(error).toHaveTextContent("Try again");
    expect(panel.compareDocumentPosition(error)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(actions).toContainElement(error);
  });
});
