import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ModelGroup, ModelSelection } from "@blksails/pi-web-react";
import { ModelSelector } from "../../src/elements/model-selector.js";

/**
 * ModelSelector 富模型选择器测试(Req 4.1/4.2/4.3/4.4/4.5、11.4)。
 *
 * 无状态展示:props 接收 groups(来自 useModels)、current、available、
 * onOpen(可选懒加载触发)、onSelect(provider, modelId)。
 * shadcn Combobox:Popover(向上弹出)+ Command(cmdk 搜索/键盘/分组/空态)。
 * 当前项打勾(data-pi-model-current);Esc / 点击外部关闭;available=false 隐藏。
 */
const groups: ReadonlyArray<ModelGroup> = [
  {
    provider: "openai",
    models: [
      { provider: "openai", modelId: "gpt-4o", label: "GPT-4o" },
      { provider: "openai", modelId: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  {
    provider: "anthropic",
    models: [
      { provider: "anthropic", modelId: "claude-3-7", label: "Claude 3.7" },
    ],
  },
];

const current: ModelSelection = { provider: "openai", modelId: "gpt-4o" };

const trigger = (): HTMLElement =>
  screen.getByRole("button", { name: /模型|model|GPT/i });
const optionLabels = (): (string | undefined)[] =>
  screen.getAllByRole("option").map((o) => o.textContent?.trim());

describe("ModelSelector 富模型选择器", () => {
  it("available=false 时整个选择器不渲染 (Req 4.4)", () => {
    const { container } = render(
      <ModelSelector
        groups={groups}
        current={current}
        available={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByRole("button", { name: /模型|model/i }),
    ).not.toBeInTheDocument();
  });

  it("触发按钮带 aria-haspopup 且默认 aria-expanded=false (Req 11.4)", () => {
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={vi.fn()}
      />,
    );
    expect(trigger()).toHaveAttribute("aria-haspopup");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("点击打开面板:aria-expanded=true 并渲染分组与全部模型项 (Req 4.1)", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(optionLabels()).toEqual(["GPT-4o", "GPT-4o mini", "Claude 3.7"]);
  });

  it("调 onOpen 用于懒加载(打开时) (Req 4.1)", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onOpen={onOpen}
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("当前选中项打勾(data-pi-model-current) (Req 4.1)", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    const marked = document.querySelector('[data-pi-model-current="true"]');
    expect(marked).not.toBeNull();
    expect(marked?.textContent).toContain("GPT-4o");
  });

  it("搜索框过滤 modelId/label/provider (Req 4.2)", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    const search = screen.getByPlaceholderText(/搜索模型/);
    await user.type(search, "claude");
    // cmdk 按 value(provider/modelId/label)过滤:仅剩 Claude(其余项被隐藏,role 查询排除)。
    expect(optionLabels()).toEqual(["Claude 3.7"]);
  });

  it("选择某项调 onSelect(provider, modelId) 并关闭面板 (Req 4.3)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={onSelect}
      />,
    );
    await user.click(trigger());
    await user.click(screen.getByText("Claude 3.7"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("anthropic", "claude-3-7");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc 关闭面板 (Req 11.4)", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={groups}
        current={current}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("点击外部关闭面板", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">外部</button>
        <ModelSelector
          groups={groups}
          current={current}
          available
          onSelect={vi.fn()}
        />
      </div>,
    );
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "外部" }));
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("不渲染任何写死模型项(仅来自 groups) (Req 4.5)", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={[{ provider: "p1", models: [{ provider: "p1", modelId: "only-one" }] }]}
        current={undefined}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("only-one");
  });

  it("无 label 时回退展示 modelId", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        groups={[{ provider: "p1", models: [{ provider: "p1", modelId: "bare-model" }] }]}
        current={undefined}
        available
        onSelect={vi.fn()}
      />,
    );
    await user.click(trigger());
    expect(screen.getByText("bare-model")).toBeInTheDocument();
  });
});

describe("★ 当前模型已不在可用清单(Req 11.9)", () => {
  const orphan: ModelSelection = { provider: "retired-gw", modelId: "old-model" };

  it("清单里单列出该模型并标记,不静默消失", async () => {
    const user = userEvent.setup();
    render(<ModelSelector groups={groups} current={orphan} available onSelect={vi.fn()} />);
    await user.click(trigger());

    const marked = document.querySelectorAll("[data-pi-model-orphan='true']");
    expect(marked, "当前模型不在 groups 内时须有可辨识标记").toHaveLength(1);
    expect(marked[0]).toHaveTextContent("retired-gw/old-model");
    // 同时仍是「当前项」——打勾语义不因不在清单而丢失。
    expect(marked[0]?.getAttribute("data-pi-model-current")).toBe("true");
  });

  it("该项不可选(重选一个已不在清单的模型只会失败)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelSelector groups={groups} current={orphan} available onSelect={onSelect} />);
    await user.click(trigger());
    const marked = document.querySelector("[data-pi-model-orphan='true']") as HTMLElement;
    await user.click(marked);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("当前模型在清单内时不出现该标记(不误报)", async () => {
    const user = userEvent.setup();
    render(<ModelSelector groups={groups} current={current} available onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(document.querySelectorAll("[data-pi-model-orphan='true']")).toHaveLength(0);
    expect(document.querySelectorAll("[data-pi-model-current='true']")).toHaveLength(1);
  });

  it("current 未设定时不出现该标记", async () => {
    const user = userEvent.setup();
    render(<ModelSelector groups={groups} current={undefined} available onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(document.querySelectorAll("[data-pi-model-orphan='true']")).toHaveLength(0);
  });
});
