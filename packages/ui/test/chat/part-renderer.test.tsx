import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartRenderer } from "../../src/chat/part-renderer.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import {
  assistantMessage,
  textPart,
  reasoningPart,
  toolStartPart,
  toolEndPart,
  dataPart,
} from "../fixtures/ui-message-fixtures.js";

const msg = assistantMessage([]);

describe("PartRenderer 分派", () => {
  it("text → Response(Markdown)", () => {
    render(<PartRenderer part={textPart("hello md")} message={msg} />);
    expect(screen.getByText("hello md").closest("[data-pi-response]")).not.toBeNull();
  });

  it("reasoning → PiReasoning", () => {
    const { container } = render(
      <PartRenderer part={reasoningPart("thinking")} message={msg} />,
    );
    expect(container.querySelector("[data-pi-reasoning]")).not.toBeNull();
  });

  it("tool → 默认 PiToolPart", () => {
    const { container } = render(
      <PartRenderer part={toolStartPart("search", { q: 1 })} message={msg} />,
    );
    expect(container.querySelector("[data-pi-tool]")).not.toBeNull();
  });

  it("data-* → 默认 data-part 渲染", () => {
    const { container } = render(
      <PartRenderer part={dataPart("pi-plan", { step: 1 })} message={msg} />,
    );
    expect(
      container.querySelector('[data-pi-data-part="data-pi-plan"]'),
    ).not.toBeNull();
  });

  it("注册自定义工具渲染器命中覆盖默认", () => {
    const registry = createRendererRegistry();
    registry.registerToolRenderer("search", () => (
      <div data-testid="custom-tool">CUSTOM TOOL</div>
    ));
    render(
      <PartRenderer
        part={toolEndPart("search", {}, { ok: true })}
        message={msg}
        registry={registry}
      />,
    );
    expect(screen.getByTestId("custom-tool")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("注册自定义 data-part 渲染器命中覆盖默认", () => {
    const registry = createRendererRegistry();
    registry.registerDataPartRenderer("data-pi-plan", () => (
      <div data-testid="custom-data">CUSTOM DATA</div>
    ));
    const { container } = render(
      <PartRenderer
        part={dataPart("pi-plan", { step: 1 })}
        message={msg}
        registry={registry}
      />,
    );
    expect(screen.getByTestId("custom-data")).toBeInTheDocument();
    expect(
      container.querySelector('[data-pi-data-part="data-pi-plan"]'),
    ).toBeNull();
  });
});
