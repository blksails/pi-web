import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SandboxRenderer } from "../../src/components/sandbox-renderer.js";
import type { UiNode } from "@blksails/pi-web-protocol";

describe("SandboxRenderer", () => {
  it("渲染 box 嵌套文本", () => {
    const node: UiNode = {
      el: "box",
      direction: "col",
      children: [{ el: "text", text: "hello-sandbox" }],
    };
    render(<SandboxRenderer node={node} />);
    expect(screen.getByText("hello-sandbox")).toBeInTheDocument();
  });

  it("渲染各类叶子元素", () => {
    const node: UiNode = {
      el: "box",
      children: [
        { el: "heading", level: 2, text: "H" },
        { el: "badge", text: "B" },
        { el: "divider" },
        { el: "code", text: "x=1", block: true },
        { el: "list", items: ["i1", "i2"] },
        { el: "keyValue", rows: [{ key: "k", value: "v" }] },
        { el: "table", columns: ["c1"], rows: [["r1"]] },
      ],
    };
    const { container } = render(<SandboxRenderer node={node} />);
    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("i2")).toBeInTheDocument();
    expect(screen.getByText("v")).toBeInTheDocument();
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("安全 href 渲染可点击外链 + rel=noopener", () => {
    const node: UiNode = {
      el: "link",
      text: "go",
      href: "https://example.com",
    };
    const { container } = render(<SandboxRenderer node={node} />);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toContain("noopener");
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("危险 href 降级为纯文本(无 <a>)", () => {
    // 直接构造绕过 schema 的危险 href,验证渲染层二次防御。
    const node = {
      el: "link",
      text: "danger-text",
      href: "javascript:alert(1)",
    } as unknown as UiNode;
    const { container } = render(<SandboxRenderer node={node} />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("danger-text")).toBeInTheDocument();
  });

  it("文本转义:script 字符串作为文本渲染,不产生 <script>", () => {
    const node: UiNode = { el: "text", text: "<script>alert(1)</script>" };
    const { container } = render(<SandboxRenderer node={node} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("超过 MAX_DEPTH 的深层嵌套被截断", () => {
    let node: UiNode = { el: "text", text: "DEEP" };
    for (let i = 0; i < 15; i++) {
      node = { el: "box", children: [node] };
    }
    render(<SandboxRenderer node={node} />);
    expect(screen.queryByText("DEEP")).toBeNull();
  });

  it("image 安全 src 渲染 <img loading=lazy>", () => {
    const node: UiNode = { el: "image", src: "https://x/y.png", alt: "pic" };
    const { container } = render(<SandboxRenderer node={node} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://x/y.png");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("image 危险 src 不渲染 <img>,降级为 alt 文本", () => {
    const node = {
      el: "image",
      src: "javascript:alert(1)",
      alt: "fallback-alt",
    } as unknown as UiNode;
    const { container } = render(<SandboxRenderer node={node} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("fallback-alt")).toBeInTheDocument();
  });

  it("未知 el 不渲染(纵深防御)", () => {
    const node = { el: "iframe", text: "x" } as unknown as UiNode;
    const { container } = render(<SandboxRenderer node={node} />);
    expect(container.querySelector("iframe")).toBeNull();
  });
});
