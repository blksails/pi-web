/**
 * PiInteraction 单元测试 — 内联交互卡(四类应答 + 留痕 + FIFO + 错误重试 + 降级)。
 *
 * 取代旧 PiPermissionDialog 测试:内联渲染于消息流(无模态 dialog role),应答后保留只读终态留痕。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiInteraction } from "../../src/elements/pi-interaction.js";
import {
  ASK_TITLE_SENTINEL,
  decodeAskAnswers,
  encodeAskRequest,
  type AskQuestionGroup,
} from "@blksails/pi-web-protocol";
import {
  mockExtensionUI,
  selectRequest,
  confirmRequest,
  inputRequest,
  editorRequest,
} from "../fixtures/mock-session.js";

const richGroup: AskQuestionGroup = {
  questions: [
    {
      header: "Tests",
      question: "Choose test types",
      multiSelect: true,
      allowOther: false,
      options: [
        { label: "Unit", description: "Fast isolated checks" },
        { label: "Integration", description: "Cross-module checks" },
      ],
    },
    {
      header: "Style",
      question: "Choose code style",
      multiSelect: false,
      allowOther: false,
      options: [
        { label: "Functional", description: "Prefer functions" },
        { label: "Object", description: "Prefer classes" },
      ],
    },
  ],
};

function richSelectRequest() {
  const encoded = encodeAskRequest(richGroup);
  return {
    type: "extension_ui_request" as const,
    id: "req-rich-select",
    method: "select" as const,
    title: encoded.title,
    options: encoded.options,
  };
}

describe("PiInteraction", () => {
  it("富 select 仅渲染多题卡片并以可读摘要留痕", async () => {
    const user = userEvent.setup();
    const request = richSelectRequest();
    const ext = mockExtensionUI({ current: request });
    const { container } = render(<PiInteraction extensionUI={ext} />);

    expect(screen.getByText("Choose test types")).toBeInTheDocument();
    expect(screen.getByText("Choose code style")).not.toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getAllByRole("textbox", { name: "其他答案" })).toHaveLength(1);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(container.querySelector("[data-pi-interaction-active]")).toBeNull();
    expect(container.textContent).not.toContain(ASK_TITLE_SENTINEL);
    expect(container.textContent).not.toContain('{"questions"');
    expect(container.querySelector("[data-pi-interaction-live]")).not.toHaveTextContent(
      ASK_TITLE_SENTINEL,
    );

    await user.click(screen.getByRole("checkbox", { name: /Unit/ }));
    await user.click(screen.getByRole("checkbox", { name: /Integration/ }));
    await user.click(screen.getByRole("tab", { name: "Style" }));
    expect(screen.getByText("Choose code style")).toBeInTheDocument();
    expect(screen.getByText("Choose test types")).not.toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "其他答案" }), "Hybrid");
    await user.click(container.querySelector("[data-pi-askq-submit]")!);

    const response = vi.mocked(ext.respond).mock.calls[0]?.[1];
    expect(response).toMatchObject({
      type: "extension_ui_response",
      id: request.id,
    });
    if (!("value" in response!)) throw new Error("expected value response");
    expect(decodeAskAnswers(response.value, richGroup)).toEqual({
      kind: "rich",
      answers: {
        answers: [
          {
            header: "Tests",
            question: "Choose test types",
            selected: ["Unit", "Integration"],
          },
          {
            header: "Style",
            question: "Choose code style",
            selected: ["Functional"],
            other: "Hybrid",
          },
        ],
      },
    });
    const resolved = await screen.findByText(
      "已选择：Tests: Unit, Integration · Style: Functional, Hybrid",
    );
    expect(resolved.closest("[data-pi-interaction-resolved]")).not.toHaveTextContent(
      ASK_TITLE_SENTINEL,
    );
  });

  it("含 sentinel 但 JSON 损坏的 select 回落原生选项", () => {
    const request = {
      type: "extension_ui_request" as const,
      id: "req-broken-rich-select",
      method: "select" as const,
      title: `Readable fallback${ASK_TITLE_SENTINEL}{broken-json`,
      options: ["Fallback A", "Fallback B"],
    };
    const { container } = render(
      <PiInteraction extensionUI={mockExtensionUI({ current: request })} />,
    );

    expect(container.querySelector("[data-pi-interaction-active]")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fallback A" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Fallback B" })).toBeInTheDocument();
  });

  it("富卡取消回传 cancelled:true 并以安全标题留痕", async () => {
    const user = userEvent.setup();
    const request = richSelectRequest();
    const ext = mockExtensionUI({ current: request });
    const { container } = render(<PiInteraction extensionUI={ext} />);

    await user.click(container.querySelector("[data-pi-askq-cancel]")!);
    expect(ext.respond).toHaveBeenCalledWith(request.id, {
      type: "extension_ui_response",
      id: request.id,
      cancelled: true,
    });
    const resolved = (await screen.findByText("已取消")).closest(
      "[data-pi-interaction-resolved]",
    );
    expect(resolved).toHaveTextContent("Choose test types (+1 more)");
    expect(resolved).not.toHaveTextContent(ASK_TITLE_SENTINEL);
    expect(resolved).not.toHaveTextContent('{"questions"');
  });

  it("富卡提交失败保留表单与错误，重试成功后才留痕", async () => {
    const user = userEvent.setup();
    const request = richSelectRequest();
    const respond = vi
      .fn<(id: string, response: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("rich response failed"))
      .mockResolvedValueOnce(undefined);
    const ext = mockExtensionUI({ current: request, respond });
    const { container } = render(<PiInteraction extensionUI={ext} />);

    await user.click(container.querySelector("[data-pi-askq-submit]")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "rich response failed",
    );
    expect(container.querySelector("[data-pi-askq-card]")).toBeInTheDocument();
    expect(container.querySelector("[data-pi-interaction-resolved]")).toBeNull();

    await user.click(container.querySelector("[data-pi-askq-submit]")!);
    expect(respond).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(
        container.querySelector("[data-pi-interaction-resolved]"),
      ).toHaveTextContent("Style: Functional");
    });
  });

  it("无 current 且无留痕 → 不渲染(降级)", () => {
    const { container } = render(
      <PiInteraction extensionUI={mockExtensionUI()} />,
    );
    expect(container.querySelector("[data-pi-interaction]")).toBeNull();
  });

  it("内联呈现而非模态(无 dialog role)", () => {
    const ext = mockExtensionUI({ current: confirmRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    expect(container.querySelector("[data-pi-interaction]")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-pi-interaction-active]"),
    ).toBeInTheDocument();
  });

  it("confirm 批准 → 回传 confirmed:true 并留痕「已批准」", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: confirmRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    expect(screen.getByText("Proceed with action?")).toBeInTheDocument();
    await user.click(container.querySelector("[data-pi-confirm-ok]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-confirm", {
      type: "extension_ui_response",
      id: "req-confirm",
      confirmed: true,
    });
    const resolved = await screen.findByText("已批准");
    expect(resolved).toBeInTheDocument();
    // 终态后不再有 active 卡(同一 current 已留痕)。
    expect(
      container.querySelector("[data-pi-interaction-active]"),
    ).toBeNull();
  });

  it("confirm 拒绝 → 回传 confirmed:false 并留痕「已拒绝」", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: confirmRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    await user.click(container.querySelector("[data-pi-confirm-cancel]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-confirm", {
      type: "extension_ui_response",
      id: "req-confirm",
      confirmed: false,
    });
    expect(await screen.findByText("已拒绝")).toBeInTheDocument();
  });

  it("select 选项提交 → 回传所选 value 并留痕「已选择：beta」", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: selectRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    await user.click(screen.getByLabelText("beta"));
    await user.click(container.querySelector("[data-pi-interaction-submit]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-select", {
      type: "extension_ui_response",
      id: "req-select",
      value: "beta",
    });
    expect(await screen.findByText("已选择：beta")).toBeInTheDocument();
  });

  it("input 提交 → 回传输入文本并留痕「已提交：Ada」", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: inputRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    await user.type(container.querySelector("[data-pi-input]")!, "Ada");
    await user.click(container.querySelector("[data-pi-interaction-submit]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-input", {
      type: "extension_ui_response",
      id: "req-input",
      value: "Ada",
    });
    expect(await screen.findByText("已提交：Ada")).toBeInTheDocument();
  });

  it("editor(prefill)编辑提交 → 回传编辑后文本并留痕(已提交 + 折叠正文)", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: editorRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    const editor = container.querySelector<HTMLTextAreaElement>(
      "[data-pi-editor]",
    )!;
    expect(editor).toHaveValue("initial");
    await user.clear(editor);
    await user.type(editor, "edited");
    await user.click(container.querySelector("[data-pi-interaction-submit]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-editor", {
      type: "extension_ui_response",
      id: "req-editor",
      value: "edited",
    });
    const resolved = await waitFor(() => {
      const el = container.querySelector(
        '[data-pi-interaction-resolved][data-pi-interaction-outcome="value"]',
      );
      expect(el).toBeInTheDocument();
      return el!;
    });
    expect(resolved).toHaveTextContent("已提交");
    expect(resolved).toHaveTextContent("edited");
  });

  it("取消 → 回传 cancelled 并留痕「已取消」", async () => {
    const user = userEvent.setup();
    const ext = mockExtensionUI({ current: inputRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    await user.click(container.querySelector("[data-pi-interaction-cancel]")!);
    expect(ext.respond).toHaveBeenCalledWith("req-input", {
      type: "extension_ui_response",
      id: "req-input",
      cancelled: true,
    });
    expect(await screen.findByText("已取消")).toBeInTheDocument();
  });

  it("FIFO:仅渲染队首为 active(其后请求不呈现可应答卡)", () => {
    const a = confirmRequest();
    const b = inputRequest();
    const ext = mockExtensionUI({ current: a, queue: [a, b] });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    // 只有一个 active 卡,且为队首 confirm。
    const actives = container.querySelectorAll("[data-pi-interaction-active]");
    expect(actives).toHaveLength(1);
    expect(actives[0]?.getAttribute("data-pi-interaction-method")).toBe(
      "confirm",
    );
  });

  it("应答后队列前进:已应答项留痕,下一队首成为 active", async () => {
    const user = userEvent.setup();
    const a = confirmRequest();
    const b = inputRequest();
    const ext = mockExtensionUI({ current: a, queue: [a, b] });
    const { container, rerender } = render(
      <PiInteraction extensionUI={ext} />,
    );
    await user.click(container.querySelector("[data-pi-confirm-ok]")!);
    expect(await screen.findByText("已批准")).toBeInTheDocument();
    // 模拟 hook 出队后 current 前进到 b。
    rerender(
      <PiInteraction extensionUI={mockExtensionUI({ current: b, queue: [b] })} />,
    );
    // a 留痕仍在,b 成为 active(input)。
    expect(screen.getByText("已批准")).toBeInTheDocument();
    const active = container.querySelector("[data-pi-interaction-active]");
    expect(active?.getAttribute("data-pi-interaction-method")).toBe("input");
  });

  it("回传失败 → 保留 active 卡 + 显示错误 + 可重试", async () => {
    const user = userEvent.setup();
    const respond = vi
      .fn<(id: string, r: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);
    const ext = mockExtensionUI({ current: inputRequest(), respond });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    await user.type(container.querySelector("[data-pi-input]")!, "x");
    await user.click(container.querySelector("[data-pi-interaction-submit]")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
    // active 卡仍在,可重试。
    expect(
      container.querySelector("[data-pi-interaction-active]"),
    ).toBeInTheDocument();
    await user.click(container.querySelector("[data-pi-interaction-submit]")!);
    expect(respond).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("已提交：x")).toBeInTheDocument();
  });

  it("提交进行中(pending)禁用动作控件", () => {
    const ext = mockExtensionUI({ current: confirmRequest(), pending: true });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    expect(container.querySelector("[data-pi-confirm-ok]")).toBeDisabled();
    expect(container.querySelector("[data-pi-confirm-cancel]")).toBeDisabled();
  });

  it("提供分组语义与可访问名(role=group + aria-label)", () => {
    const ext = mockExtensionUI({ current: confirmRequest() });
    render(<PiInteraction extensionUI={ext} />);
    expect(screen.getByRole("group", { name: "扩展交互" })).toBeInTheDocument();
  });

  it("新 active 经 aria-live(polite)区播报请求(Req 5.1)", () => {
    const ext = mockExtensionUI({ current: confirmRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    const live = container.querySelector("[data-pi-interaction-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    // confirmRequest title = "Are you sure?"
    expect(live).toHaveTextContent("Are you sure?");
  });

  it("新 active 出现时聚焦首个可操作控件(Req 5.3)", () => {
    const ext = mockExtensionUI({ current: confirmRequest() });
    const { container } = render(<PiInteraction extensionUI={ext} />);
    expect(document.activeElement).toBe(
      container.querySelector("[data-pi-confirm-ok]"),
    );
  });

  it("新 active 滚动至可见(Req 5.2)", () => {
    const orig = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    // jsdom 不实现 scrollIntoView;注入 spy 验证组件在 active 挂载时调用。
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      const ext = mockExtensionUI({ current: confirmRequest() });
      render(<PiInteraction extensionUI={ext} />);
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it("不锁定焦点:可将焦点移至卡外元素(Req 5.4)", () => {
    const ext = mockExtensionUI({ current: confirmRequest() });
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <PiInteraction extensionUI={ext} />
      </div>,
    );
    const outside = screen.getByTestId("outside");
    outside.focus();
    // 非模态、无 focus trap:焦点可停留在卡外元素,不被夺回。
    expect(document.activeElement).toBe(outside);
  });
});
