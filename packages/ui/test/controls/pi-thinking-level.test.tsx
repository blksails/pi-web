import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiThinkingLevel } from "../../src/controls/pi-thinking-level.js";
import { mockControls } from "../fixtures/mock-session.js";

describe("PiThinkingLevel", () => {
  it("渲染思考等级选择器", () => {
    render(<PiThinkingLevel controls={mockControls()} />);
    expect(
      screen.getByRole("combobox", { name: /select thinking level/i }),
    ).toBeInTheDocument();
  });

  it("选择等级经 setThinking 提交", async () => {
    const user = userEvent.setup();
    const controls = mockControls();
    render(<PiThinkingLevel controls={controls} />);
    await user.click(
      screen.getByRole("combobox", { name: /select thinking level/i }),
    );
    await user.click(await screen.findByText("high"));
    expect(controls.setThinking).toHaveBeenCalledWith({ level: "high" });
  });
});
