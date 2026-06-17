import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiReasoning } from "../../src/parts/pi-reasoning.js";
import { reasoningPart } from "../fixtures/ui-message-fixtures.js";

describe("PiReasoning 折叠", () => {
  it("默认折叠,不显示思考文本", () => {
    render(<PiReasoning part={reasoningPart("secret thought")} />);
    const toggle = screen.getByRole("button", { name: /reasoning/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("secret thought")).not.toBeInTheDocument();
  });

  it("点击展开显示文本并更新 aria-expanded", async () => {
    const user = userEvent.setup();
    render(<PiReasoning part={reasoningPart("secret thought")} />);
    const toggle = screen.getByRole("button", { name: /reasoning/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("secret thought")).toBeInTheDocument();
  });

  it("键盘可触发展开/折叠", async () => {
    const user = userEvent.setup();
    render(<PiReasoning part={reasoningPart("kbd thought")} />);
    const toggle = screen.getByRole("button", { name: /reasoning/i });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("流式进行中提供进行中指示", () => {
    render(<PiReasoning part={reasoningPart("streaming…", "streaming")} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
