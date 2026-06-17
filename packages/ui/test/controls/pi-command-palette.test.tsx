import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiCommandPalette } from "../../src/controls/pi-command-palette.js";
import { mockControls, sampleCommands } from "../fixtures/mock-session.js";

function Harness({
  controls,
  initial = "/",
}: {
  controls: ReturnType<typeof mockControls>;
  initial?: string;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  return (
    <div>
      <input
        aria-label="prompt"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <PiCommandPalette controls={controls} value={value} onChange={setValue} />
      <span data-testid="value">{value}</span>
    </div>
  );
}

describe("PiCommandPalette", () => {
  it("非命令模式不渲染", () => {
    const controls = mockControls({ commands: sampleCommands() });
    render(<PiCommandPalette controls={controls} value="hello" onChange={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it('"/" 触发展示命令候选列表', async () => {
    const controls = mockControls({ commands: sampleCommands() });
    render(<Harness controls={controls} />);
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("/help")).toBeInTheDocument();
    expect(screen.getByText("/model")).toBeInTheDocument();
    expect(screen.getByText("/clear")).toBeInTheDocument();
  });

  it("继续输入按命令名过滤", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ commands: sampleCommands() });
    render(<Harness controls={controls} />);
    await user.type(screen.getByLabelText("prompt"), "mod");
    expect(screen.getByText("/model")).toBeInTheDocument();
    expect(screen.queryByText("/help")).not.toBeInTheDocument();
  });

  it("选择命令填充到输入区", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ commands: sampleCommands() });
    render(<Harness controls={controls} />);
    await user.click(await screen.findByText("/clear"));
    expect(screen.getByTestId("value")).toHaveTextContent("/clear");
  });

  it("方向键导航并以 aria 标注活动项,回车确认", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ commands: sampleCommands() });
    render(<Harness controls={controls} />);
    const input = screen.getByLabelText("prompt");
    input.focus();
    // 默认第一项活动
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("/model");
  });

  it("命令列表为空显示空态不崩溃", () => {
    const controls = mockControls({ commands: [] });
    render(<PiCommandPalette controls={controls} value="/" onChange={vi.fn()} />);
    expect(screen.getByText(/no commands/i)).toBeInTheDocument();
  });

  it("获取失败显示错误态不崩溃", async () => {
    const controls = mockControls({
      commands: undefined,
      getCommands: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    render(<PiCommandPalette controls={controls} value="/" onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("fetch failed");
  });
});
