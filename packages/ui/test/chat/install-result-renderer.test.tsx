/**
 * InstallResultRenderer — `/install` 结果卡片(spec install-host-command,任务 3.2)。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PartRenderer } from "../../src/chat/part-renderer.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { InstallResultRenderer } from "../../src/chat/install-result-renderer.js";
import { assistantMessage, dataPart } from "../fixtures/ui-message-fixtures.js";

const msg = assistantMessage([]);

function renderCard(data: unknown) {
  const registry = createRendererRegistry();
  registry.registerDataPartRenderer("data-install-result", InstallResultRenderer);
  return render(
    <PartRenderer
      part={dataPart("install-result", data)}
      message={msg}
      registry={registry}
    />,
  );
}

describe("InstallResultRenderer", () => {
  it("成功态:头行 action/kind/id + location/guidance", () => {
    const { container } = renderCard({
      action: "install",
      ok: true,
      kind: "agent",
      id: "local:./examples/hello-agent",
      location: "~/.pi-web/agents/hello-agent",
      guidance: "在源选择器中切换到 hello-agent 即可使用",
      steps: [{ stage: "resolve", status: "complete" }],
    });
    const root = container.querySelector("[data-pi-install-result]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-pi-install-ok")).toBe("true");
    expect(root?.getAttribute("data-pi-install-action")).toBe("install");
    expect(root?.getAttribute("data-pi-install-kind")).toBe("agent");
    expect(
      container.querySelector("[data-pi-install-location]")?.textContent,
    ).toContain("~/.pi-web/agents/hello-agent");
    expect(
      container.querySelector("[data-pi-install-guidance]")?.textContent,
    ).toContain("hello-agent");
  });

  it("失败态:标红 + error + 失败 step", () => {
    const { container } = renderCard({
      action: "install",
      ok: false,
      kind: "component",
      guidance: "组件包请在目标 source 目录用 pi-web add 安装",
      steps: [{ stage: "resolve", status: "failed", detail: "组件包不受支持" }],
      error: { code: "KIND_COMPONENT_UNSUPPORTED", message: "组件包不受支持" },
    });
    const root = container.querySelector("[data-pi-install-result]");
    expect(root?.getAttribute("data-pi-install-ok")).toBe("false");
    expect(root?.className).toContain("destructive");
    const step = container.querySelector("[data-pi-install-step]");
    expect(step?.getAttribute("data-status")).toBe("failed");
    expect(step?.className).toContain("destructive");
    expect(
      container.querySelector("[data-pi-install-error]")?.textContent,
    ).toContain("KIND_COMPONENT_UNSUPPORTED");
  });

  it("list 子动作:items 表体渲染", () => {
    const { container } = renderCard({
      action: "list",
      ok: true,
      steps: [],
      items: [
        { id: "npm:pi-web-access", version: "1.2.0", kind: "plugin" },
        { id: "npm:pi-sandbox", kind: "plugin" },
      ],
    });
    const rows = container.querySelectorAll("[data-pi-install-item]");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-id")).toBe("npm:pi-web-access");
    expect(rows[0]?.textContent).toContain("1.2.0");
  });

  it("schema 解析失败 → JSON 预格式降级不崩", () => {
    const { container } = renderCard({ totally: "not install result" });
    expect(container.querySelector("[data-pi-install-parse-error]")).not.toBeNull();
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("totally");
  });
});
