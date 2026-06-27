import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiCommandPalette } from "../../src/controls/pi-command-palette.js";
import { mockControls, sampleCommands } from "../fixtures/mock-session.js";
import type { GetCommandsResponse } from "@blksails/pi-web-protocol";

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

  it("提供 inputRef 时经 caret 锚定 fixed 定位(与 @ 补全一致)", async () => {
    const controls = mockControls({ commands: sampleCommands() });
    function Anchored(): React.JSX.Element {
      const [value, setValue] = React.useState("/");
      const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
      return (
        <div>
          <textarea
            ref={inputRef}
            aria-label="prompt"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <PiCommandPalette
            controls={controls}
            value={value}
            onChange={setValue}
            inputRef={inputRef}
          />
        </div>
      );
    }
    render(<Anchored />);
    await screen.findByRole("listbox");
    const palette = document.querySelector(
      "[data-pi-command-palette]",
    ) as HTMLElement | null;
    expect(palette?.style.position).toBe("fixed");
  });

  it("继续输入按命令名过滤", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ commands: sampleCommands() });
    render(<Harness controls={controls} />);
    await user.type(screen.getByLabelText("prompt"), "mod");
    expect(screen.getByText("/model")).toBeInTheDocument();
    expect(screen.queryByText("/help")).not.toBeInTheDocument();
  });

  describe("extensionCommands 策略", () => {
    const sourceInfo = {
      path: "/builtin/x",
      source: "builtin",
      scope: "user" as const,
      origin: "top-level" as const,
    };
    const promptCmd = {
      name: "help",
      description: "Show help",
      source: "prompt" as const,
      sourceInfo,
    };
    const extCmd = (name: string) => ({
      name,
      description: `ext ${name}`,
      source: "extension" as const,
      sourceInfo,
    });

    it("默认隐藏所有 extension 命令(web 端会永久卡 pending)", async () => {
      const controls = mockControls({
        commands: [promptCmd, extCmd("sandbox")],
      });
      // Harness 不传 extensionCommands → 默认隐藏。
      render(<Harness controls={controls} />);
      expect(await screen.findByText("/help")).toBeInTheDocument();
      expect(screen.queryByText("/sandbox")).not.toBeInTheDocument();
    });

    it("allowlist 按名放行指定 extension 命令,其余仍隐藏", async () => {
      const controls = mockControls({
        commands: [extCmd("sandbox"), extCmd("danger")],
      });
      render(
        <PiCommandPalette
          controls={controls}
          value="/"
          onChange={vi.fn()}
          extensionCommands={{ allowlist: ["sandbox"] }}
        />,
      );
      expect(await screen.findByText("/sandbox")).toBeInTheDocument();
      expect(screen.queryByText("/danger")).not.toBeInTheDocument();
    });

    it("enabled 放行所有 extension 命令", async () => {
      const controls = mockControls({
        commands: [extCmd("sandbox"), extCmd("danger")],
      });
      render(
        <PiCommandPalette
          controls={controls}
          value="/"
          onChange={vi.fn()}
          extensionCommands={{ enabled: true }}
        />,
      );
      expect(await screen.findByText("/sandbox")).toBeInTheDocument();
      expect(screen.getByText("/danger")).toBeInTheDocument();
    });
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

  it("controls 引用每渲染都变化时不陷入无限 setState 循环(React #185 回归)", () => {
    // 复现 usePiControls 的返回形状:controls 对象每渲染都是新引用(state 在 setOp 时
    // 真实变化),但 getCommands 是稳定记忆引用。getCommands 触发宿主重渲染(模拟
    // setOp 翻转 pending state)。旧实现 effect 依赖整个 controls → 每渲染都拉取 →
    // setOp → 重渲染 → 无限循环。修复后 effect 只依赖稳定的 getCommands/commands。
    let calls = 0;
    function LoopHarness(): React.JSX.Element {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      const getCommands = React.useCallback(async (): Promise<GetCommandsResponse> => {
        calls += 1;
        force(); // 模拟 usePiControls.setOp 翻转 state 触发宿主重渲染
        return { commands: [] };
      }, []);
      // 每渲染都新建 controls 对象,但 getCommands 引用稳定、commands 保持 undefined。
      const controls = { ...mockControls({ commands: undefined }), getCommands };
      return (
        <PiCommandPalette controls={controls} value="/" onChange={vi.fn()} />
      );
    }
    expect(() => render(<LoopHarness />)).not.toThrow();
    // 修复后:effect 依赖稳定 → 仅拉取一次(force 触发的重渲染不再重跑 effect)。
    expect(calls).toBeLessThanOrEqual(2);
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

  describe("onCaptureChange", () => {
    it("有候选时回调 true", async () => {
      const onCaptureChange = vi.fn();
      const controls = mockControls({ commands: sampleCommands() });
      render(
        <PiCommandPalette
          controls={controls}
          value="/"
          onChange={vi.fn()}
          onCaptureChange={onCaptureChange}
        />,
      );
      await screen.findByRole("listbox");
      expect(onCaptureChange).toHaveBeenLastCalledWith(true);
    });

    it("过滤到无候选时回调 false", async () => {
      const user = userEvent.setup();
      const onCaptureChange = vi.fn();
      const controls = mockControls({ commands: sampleCommands() });

      function HarnessCapture(): React.JSX.Element {
        const [value, setValue] = React.useState("/");
        return (
          <div>
            <input
              aria-label="prompt"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <PiCommandPalette
              controls={controls}
              value={value}
              onChange={setValue}
              onCaptureChange={onCaptureChange}
            />
          </div>
        );
      }

      render(<HarnessCapture />);
      await screen.findByRole("listbox");
      // 输入无匹配的查询
      await user.type(screen.getByLabelText("prompt"), "zzz");
      expect(onCaptureChange).toHaveBeenLastCalledWith(false);
    });

    it("退出命令模式(Esc)时回调 false", async () => {
      const user = userEvent.setup();
      const onCaptureChange = vi.fn();
      const controls = mockControls({ commands: sampleCommands() });

      function HarnessEsc(): React.JSX.Element {
        const [value, setValue] = React.useState("/");
        return (
          <div>
            <input
              aria-label="prompt"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <PiCommandPalette
              controls={controls}
              value={value}
              onChange={setValue}
              onCaptureChange={onCaptureChange}
            />
          </div>
        );
      }

      render(<HarnessEsc />);
      const input = screen.getByLabelText("prompt");
      input.focus();
      await screen.findByRole("listbox");
      expect(onCaptureChange).toHaveBeenLastCalledWith(true);
      await user.keyboard("{Escape}");
      expect(onCaptureChange).toHaveBeenLastCalledWith(false);
    });

    it("未提供 onCaptureChange 时行为与现状完全一致(无错误)", async () => {
      const controls = mockControls({ commands: sampleCommands() });
      render(<PiCommandPalette controls={controls} value="/" onChange={vi.fn()} />);
      expect(await screen.findByRole("listbox")).toBeInTheDocument();
    });
  });
});
