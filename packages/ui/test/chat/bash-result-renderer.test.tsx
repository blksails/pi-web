/**
 * BashResultRenderer — bang shell 命令结果卡片(spec bang-shell-command,Req 4.x / 7.3)。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PartRenderer } from "../../src/chat/part-renderer.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { BashResultRenderer } from "../../src/chat/bash-result-renderer.js";
import { assistantMessage, dataPart } from "../fixtures/ui-message-fixtures.js";

const msg = assistantMessage([]);

function renderCard(data: Record<string, unknown>) {
  const registry = createRendererRegistry();
  registry.registerDataPartRenderer("data-bash-result", BashResultRenderer);
  return render(
    <PartRenderer
      part={dataPart("bash-result", data)}
      message={msg}
      registry={registry}
    />,
  );
}

describe("BashResultRenderer", () => {
  it("渲染命令与输出(成功,exit 0)", () => {
    const { container } = renderCard({
      command: "echo hi",
      output: "hi\n",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: false,
    });
    expect(container.querySelector("[data-pi-bash-result]")).not.toBeNull();
    expect(
      container.querySelector("[data-pi-bash-command]")?.textContent,
    ).toBe("echo hi");
    // 同步 <pre> 输出立即可读(Req 4.6)。
    expect(container.querySelector("[data-pi-bash-output]")?.textContent).toBe(
      "hi\n",
    );
    expect(
      container.querySelector("[data-pi-bash-exit]")?.textContent,
    ).toContain("0");
  });

  it("退出码非零 → exit 标红显示退出码(Req 4.3)", () => {
    const { container } = renderCard({
      command: "false",
      output: "",
      exitCode: 1,
      cancelled: false,
      truncated: false,
      excludeFromContext: false,
    });
    const exit = container.querySelector("[data-pi-bash-exit]");
    expect(exit?.textContent).toContain("1");
    expect(exit?.className).toContain("destructive");
  });

  it("truncated → 截断提示(Req 4.4)", () => {
    const { container } = renderCard({
      command: "cat big",
      output: "x",
      exitCode: 0,
      cancelled: false,
      truncated: true,
      excludeFromContext: false,
    });
    expect(container.querySelector("[data-pi-bash-truncated]")).not.toBeNull();
  });

  it("cancelled → 标示未正常完成(Req 7.3)", () => {
    const { container } = renderCard({
      command: "sleep 9",
      output: "",
      cancelled: true,
      truncated: false,
      excludeFromContext: false,
    });
    expect(container.querySelector("[data-pi-bash-cancelled]")).not.toBeNull();
  });

  it("excludeFromContext → no-context 徽标(Req 4.5)", () => {
    const { container } = renderCard({
      command: "ls",
      output: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
    });
    expect(container.querySelector("[data-pi-bash-no-context]")).not.toBeNull();
  });
});
