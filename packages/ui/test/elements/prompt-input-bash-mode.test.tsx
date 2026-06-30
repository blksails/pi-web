/**
 * PromptInput — bang shell 视觉提示(spec bang-shell-command,Req 6.1/6.2/6.3)。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PromptInput } from "../../src/elements/prompt-input.js";

function setup(mode?: "bash" | "bash-no-context") {
  return render(
    <PromptInput
      value="!ls"
      onChange={() => {}}
      onSubmit={() => {}}
      {...(mode !== undefined ? { mode } : {})}
    />,
  );
}

describe("PromptInput bash 模式视觉提示", () => {
  it("mode=bash → 显示 BASH 徽标且标记 data-pi-bash-mode(Req 6.1)", () => {
    const { container } = setup("bash");
    expect(
      container.querySelector('[data-pi-bash-mode="bash"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-pi-bash-badge]")?.textContent,
    ).toContain("BASH");
  });

  it("mode=bash-no-context → 含 no context 标识(Req 6.2)", () => {
    const { container } = setup("bash-no-context");
    expect(
      container.querySelector('[data-pi-bash-mode="bash-no-context"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-pi-bash-badge]")?.textContent,
    ).toContain("no context");
  });

  it("无 mode → 常规外观,无徽标(Req 6.3)", () => {
    const { container } = setup(undefined);
    expect(container.querySelector("[data-pi-bash-mode]")).toBeNull();
    expect(container.querySelector("[data-pi-bash-badge]")).toBeNull();
  });
});
