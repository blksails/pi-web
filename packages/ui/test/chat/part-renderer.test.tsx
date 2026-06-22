import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartRenderer } from "../../src/chat/part-renderer.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { PiUiPart } from "../../src/parts/pi-ui-part.js";
import {
  assistantMessage,
  textPart,
  reasoningPart,
  toolStartPart,
  toolEndPart,
  dataPart,
  filePart,
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

  it("file(image/*)→ 渲染 <img>(用户消息图片历史回放)", () => {
    const { container } = render(
      <PartRenderer
        part={filePart("data:image/png;base64,AAAA", "image/png", "pi-e2e-attach.png")}
        message={msg}
      />,
    );
    const img = container.querySelector("img[data-pi-message-image]");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img?.getAttribute("alt")).toBe("pi-e2e-attach.png");
  });

  it("file(image/*)无 filename → alt 兜底为 image", () => {
    const { container } = render(
      <PartRenderer
        part={filePart("/api/attachments/att_x/raw", "image/png")}
        message={msg}
      />,
    );
    expect(
      container.querySelector("img[data-pi-message-image]")?.getAttribute("alt"),
    ).toBe("image");
  });

  it("file(非 image,如 pdf)→ 仍返回 null,不渲染 <img>", () => {
    const { container } = render(
      <PartRenderer
        part={filePart("/api/attachments/att_x/raw", "application/pdf", "a.pdf")}
        message={msg}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("data-pi-error → 内联 ChatError 红块(复用 destructive 样式,带 data-pi-message-error)", () => {
    const { container } = render(
      <PartRenderer
        part={dataPart("pi-error", { errorText: "Could not process image" })}
        message={msg}
      />,
    );
    const wrap = container.querySelector("[data-pi-message-error]");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector("[data-pi-chat-error]")).not.toBeNull();
    expect(screen.getByText("Could not process image")).toBeInTheDocument();
    // 不应落入默认 data-part 的 JSON 兜底渲染。
    expect(
      container.querySelector('[data-pi-data-part="data-pi-error"]'),
    ).toBeNull();
  });

  it("data-pi-error 空 errorText → ChatError 返回 null,不渲染红块", () => {
    const { container } = render(
      <PartRenderer part={dataPart("pi-error", { errorText: "" })} message={msg} />,
    );
    // 包裹层仍在,但内部 ChatError 为空不渲染。
    expect(
      container.querySelector("[data-pi-message-error] [data-pi-chat-error]"),
    ).toBeNull();
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

  it("仅 components.ToolPart 覆盖 → 用宿主覆盖替代默认", () => {
    const ToolOverride = () => (
      <div data-testid="override-tool">OVERRIDE</div>
    );
    render(
      <PartRenderer
        part={toolEndPart("search", {}, { ok: true })}
        message={msg}
        toolPart={ToolOverride}
      />,
    );
    expect(screen.getByTestId("override-tool")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("注册器与 ToolPart 覆盖同时存在 → 注册器优先", () => {
    const registry = createRendererRegistry();
    registry.registerToolRenderer("search", () => (
      <div data-testid="registry-tool">REGISTRY</div>
    ));
    const ToolOverride = () => (
      <div data-testid="override-tool">OVERRIDE</div>
    );
    render(
      <PartRenderer
        part={toolEndPart("search", {}, { ok: true })}
        message={msg}
        registry={registry}
        toolPart={ToolOverride}
      />,
    );
    expect(screen.getByTestId("registry-tool")).toBeInTheDocument();
    expect(screen.queryByTestId("override-tool")).not.toBeInTheDocument();
  });

  it("data-pi-ui → 注册 PiUiPart 经注册表分派渲染(server-driven UI)", () => {
    const registry = createRendererRegistry();
    registry.registerDataPartRenderer("data-pi-ui", PiUiPart);
    render(
      <PartRenderer
        part={dataPart("pi-ui", {
          kind: "builtin",
          component: "metric",
          props: { label: "L", value: "V" },
        })}
        message={msg}
        registry={registry}
      />,
    );
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
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
