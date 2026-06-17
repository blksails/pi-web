import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Widgets, type WidgetsProps } from "../../src/elements/widgets.js";

/**
 * Widgets 区元件测试(Req 3.1/3.2/3.5、8.1)。
 *
 * 无状态展示元件:接收数组形态 widgets(key 内联),仅渲染 placement 匹配的项并逐行渲染
 * lines;过滤后为空(或 widgets 为空)返回 null。主题经 shadcn CSS 变量,无硬编码颜色。
 */

type Widget = WidgetsProps["widgets"][number];

const above: Widget = {
  key: "tokens",
  lines: ["tokens: 1200", "budget: 8000"],
  placement: "aboveEditor",
};
const below: Widget = {
  key: "hint",
  lines: ["按 Enter 发送"],
  placement: "belowEditor",
};

afterEach(() => {
  cleanup();
});

describe("Widgets 区元件", () => {
  it("空 widgets 返回 null,不渲染容器 (Req 3.5)", () => {
    const { container } = render(
      <Widgets widgets={[]} placement="aboveEditor" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      container.querySelector("[data-pi-widgets]"),
    ).not.toBeInTheDocument();
  });

  it("有 widgets 但无匹配 placement 返回 null (Req 3.5)", () => {
    const { container } = render(
      <Widgets widgets={[below]} placement="aboveEditor" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      container.querySelector("[data-pi-widgets]"),
    ).not.toBeInTheDocument();
  });

  it("仅渲染匹配 placement 的项 (Req 3.2)", () => {
    const { container } = render(
      <Widgets widgets={[above, below]} placement="aboveEditor" />,
    );
    const wrap = container.querySelector("[data-pi-widgets]");
    expect(wrap).toBeInTheDocument();
    expect(wrap?.getAttribute("data-pi-widget-placement")).toBe("aboveEditor");

    const items = container.querySelectorAll("[data-pi-widget]");
    expect(items).toHaveLength(1);
    const keys = Array.from(items).map((el) =>
      el.getAttribute("data-widget-key"),
    );
    expect(keys).toEqual(["tokens"]);

    // 非匹配 placement 的项不渲染
    expect(screen.queryByText("按 Enter 发送")).not.toBeInTheDocument();
  });

  it("逐行渲染一个 widget 的全部 lines (Req 3.1)", () => {
    render(<Widgets widgets={[above]} placement="aboveEditor" />);
    expect(screen.getByText("tokens: 1200")).toBeInTheDocument();
    expect(screen.getByText("budget: 8000")).toBeInTheDocument();
  });

  it("每个匹配项带 data-widget-key (Req 3.1)", () => {
    const second: Widget = {
      key: "extra",
      lines: ["x"],
      placement: "aboveEditor",
    };
    const { container } = render(
      <Widgets widgets={[above, second]} placement="aboveEditor" />,
    );
    const keys = Array.from(
      container.querySelectorAll("[data-pi-widget]"),
    ).map((el) => el.getAttribute("data-widget-key"));
    expect(keys).toEqual(["tokens", "extra"]);
  });

  it("主题经 CSS 变量(无硬编码颜色) (Req 8.1)", () => {
    const { container } = render(
      <Widgets widgets={[above]} placement="aboveEditor" />,
    );
    const item = container.querySelector("[data-pi-widget]");
    expect(item?.className).toContain("hsl(var(--");
  });
});
