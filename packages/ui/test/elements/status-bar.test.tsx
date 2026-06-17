import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusBar } from "../../src/elements/status-bar.js";

/**
 * StatusBar 状态条测试(Req 2.1/2.4/2.5、8.1)。
 *
 * 无状态展示元件:并列展示键控状态项(小 pill);键序稳定(按 key 排序);空对象返回 null。
 * 主题经 shadcn CSS 变量,无硬编码颜色。
 */

afterEach(() => {
  cleanup();
});

describe("StatusBar 状态条", () => {
  it("空对象返回 null,不渲染容器 (Req 2.5)", () => {
    const { container } = render(<StatusBar statuses={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      container.querySelector("[data-pi-status-bar]"),
    ).not.toBeInTheDocument();
  });

  it("多键并列渲染各 value,每项带 data-status-key (Req 2.1/2.4)", () => {
    const { container } = render(
      <StatusBar statuses={{ build: "构建中", lint: "通过" }} />,
    );
    const bar = container.querySelector("[data-pi-status-bar]");
    expect(bar).toBeInTheDocument();

    const items = container.querySelectorAll("[data-pi-status]");
    expect(items).toHaveLength(2);

    expect(screen.getByText("构建中")).toBeInTheDocument();
    expect(screen.getByText("通过")).toBeInTheDocument();

    const keys = Array.from(items).map((el) =>
      el.getAttribute("data-status-key"),
    );
    expect(keys).toEqual(["build", "lint"]);
  });

  it("键序稳定:乱序键按排序后顺序渲染 (Req 2.4)", () => {
    const { container } = render(
      <StatusBar statuses={{ zeta: "Z", alpha: "A", mike: "M" }} />,
    );
    const items = container.querySelectorAll("[data-pi-status]");
    const keys = Array.from(items).map((el) =>
      el.getAttribute("data-status-key"),
    );
    expect(keys).toEqual(["alpha", "mike", "zeta"]);

    const texts = Array.from(items).map((el) => el.textContent);
    expect(texts).toEqual(["A", "M", "Z"]);
  });

  it("主题经 CSS 变量(无硬编码颜色) (Req 8.1)", () => {
    const { container } = render(<StatusBar statuses={{ build: "构建中" }} />);
    const item = container.querySelector("[data-pi-status]");
    expect(item?.className).toContain("hsl(var(--");
  });
});
