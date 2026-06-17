import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Sources } from "../../src/elements/sources.js";

/**
 * Sources 引用来源折叠测试(Req 9.3/9.4)。
 *
 * 无状态展示元件(不接 pi 数据):接收 sources 数组展示,可折叠头部(显示来源数 + 箭头),
 * 默认折叠(9.3),展开后列出来源(title + url 链接);无来源/缺省返回 null 不渲染(9.4)。
 * 折叠开合属本地 UI 态,允许组件内部 useState。
 */

describe("Sources 引用来源折叠", () => {
  it("有来源时默认折叠:渲染头部、aria-expanded=false,不显示来源列表 (Req 9.3)", () => {
    render(
      <Sources
        sources={[
          { id: "a", title: "Source A", url: "https://a.example.com" },
        ]}
      />,
    );
    const toggle = screen.getByRole("button");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");
    // 折叠态:来源链接不在文档中。
    expect(screen.queryByText("Source A")).not.toBeInTheDocument();
  });

  it("头部显示来源数量 (Req 9.3)", () => {
    render(
      <Sources
        sources={[
          { id: "a", title: "Source A", url: "https://a.example.com" },
          { id: "b", title: "Source B", url: "https://b.example.com" },
        ]}
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("2");
  });

  it("点击展开:列出来源,title 显示且 url 为可点击链接,aria-expanded=true (Req 9.3)", async () => {
    const user = userEvent.setup();
    render(
      <Sources
        sources={[
          { id: "a", title: "Source A", url: "https://a.example.com" },
        ]}
      />,
    );
    const toggle = screen.getByRole("button");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: /Source A/ });
    expect(link).toHaveAttribute("href", "https://a.example.com");
  });

  it("defaultOpen 时初始展开 (Req 9.3)", () => {
    render(
      <Sources
        defaultOpen
        sources={[{ id: "a", title: "Source A", url: "https://a.example.com" }]}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: /Source A/ })).toBeInTheDocument();
  });

  it("缺 url 的来源展开后以 title 文本展示(非链接)", async () => {
    const user = userEvent.setup();
    render(<Sources sources={[{ id: "a", title: "No Link Source" }]} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("No Link Source")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("无来源(空数组)时返回 null 不渲染 (Req 9.4)", () => {
    const { container } = render(<Sources sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("缺省 sources 时返回 null 不渲染 (Req 9.4)", () => {
    const { container } = render(<Sources />);
    expect(container).toBeEmptyDOMElement();
  });
});
