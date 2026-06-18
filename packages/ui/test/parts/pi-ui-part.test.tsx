import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PiUiPart } from "../../src/parts/pi-ui-part.js";
import { defaultUiComponentRegistry } from "../../src/components/ui-component-registry.js";

const msg: UIMessage = { id: "m1", role: "assistant", parts: [] };

// PiUiPart 接 DataPartRenderer({part, message});构造 data-pi-ui part。
function uiPart(data: unknown) {
  return { type: "data-pi-ui" as const, data } as never;
}

describe("PiUiPart", () => {
  it("模块加载即把内置组件 seed 到默认单例", () => {
    expect(defaultUiComponentRegistry.resolveUiComponent("metric")).toBeDefined();
    expect(defaultUiComponentRegistry.resolveUiComponent("table")).toBeDefined();
  });

  it("builtin 命中 → 渲染该内置组件", () => {
    render(
      <PiUiPart
        part={uiPart({
          kind: "builtin",
          component: "metric",
          props: { label: "L", value: "V" },
        })}
        message={msg}
      />,
    );
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("builtin 未注册 → 可读占位回退", () => {
    const { container } = render(
      <PiUiPart
        part={uiPart({ kind: "builtin", component: "does-not-exist" })}
        message={msg}
      />,
    );
    expect(container.querySelector("[data-pi-ui-fallback]")).not.toBeNull();
  });

  it("sandbox → 经 SandboxRenderer 渲染节点树", () => {
    render(
      <PiUiPart
        part={uiPart({
          kind: "sandbox",
          title: "报告",
          root: { el: "text", text: "sandbox-body" },
        })}
        message={msg}
      />,
    );
    expect(screen.getByText("报告")).toBeInTheDocument();
    expect(screen.getByText("sandbox-body")).toBeInTheDocument();
  });

  it("非法 spec(safeParse 失败)→ 回退而非抛错", () => {
    const { container } = render(
      <PiUiPart part={uiPart({ kind: "builtin" })} message={msg} />,
    );
    expect(container.querySelector("[data-pi-ui-fallback]")).not.toBeNull();
  });

  it("危险 href 的 sandbox link 被 schema 拒绝 → 回退", () => {
    const { container } = render(
      <PiUiPart
        part={uiPart({
          kind: "sandbox",
          root: { el: "link", text: "x", href: "javascript:alert(1)" },
        })}
        message={msg}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[data-pi-ui-fallback]")).not.toBeNull();
  });
});
