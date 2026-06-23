import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiModelSelector } from "../../src/controls/pi-model-selector.js";
import { mockControls } from "../fixtures/mock-session.js";

const models = [
  { provider: "anthropic", modelId: "claude", label: "Claude" },
  { provider: "openai", modelId: "gpt", label: "GPT" },
];

describe("PiModelSelector", () => {
  it("渲染并展示模型选择触发器", () => {
    render(<PiModelSelector controls={mockControls()} models={models} />);
    expect(
      screen.getByRole("button", { name: /select model/i }),
    ).toBeInTheDocument();
  });

  it("选择模型经 setModel 提交", async () => {
    const user = userEvent.setup();
    const controls = mockControls();
    render(<PiModelSelector controls={controls} models={models} />);
    await user.click(screen.getByRole("button", { name: /select model/i }));
    await user.click(await screen.findByText("GPT"));
    expect(controls.setModel).toHaveBeenCalledWith({
      provider: "openai",
      modelId: "gpt",
    });
  });

  it("进行中态显示 busy", () => {
    const base = mockControls();
    const controls = {
      ...base,
      state: { ...base.state, setModel: { pending: true, error: undefined } },
    };
    render(<PiModelSelector controls={controls} models={models} />);
    expect(
      screen.getByRole("button", { name: /select model/i }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("失败显示可辨识错误不静默", () => {
    const base = mockControls();
    const controls = {
      ...base,
      state: {
        ...base.state,
        setModel: { pending: false, error: new Error("denied") },
      },
    };
    render(<PiModelSelector controls={controls} models={models} />);
    expect(screen.getByRole("alert")).toHaveTextContent("denied");
  });
});
