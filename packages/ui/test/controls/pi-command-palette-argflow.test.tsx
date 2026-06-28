/**
 * PiCommandPalette 子命令/参数分阶段补全单测(plugin-subcommand-completion)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { PiCommandPalette } from "../../src/controls/pi-command-palette.js";
import type { CommandArgProvider } from "../../src/controls/command-arg.js";
import { mockControls, sampleCommands } from "../fixtures/mock-session.js";

const PLUGIN_SPEC = {
  command: "plugin",
  subcommands: [
    { name: "install", aliases: ["add"], terminal: false, argKind: "localSource" as const },
    { name: "uninstall", aliases: ["remove"], terminal: false, argKind: "installedExt" as const },
    { name: "list", aliases: ["ls"], terminal: true },
  ],
};

function makeProvider(
  listArgs: CommandArgProvider["listArgs"],
): CommandArgProvider {
  return {
    specFor: (cmd) => (cmd === "plugin" ? PLUGIN_SPEC : undefined),
    listArgs,
  };
}

function Harness({
  provider,
  initial,
}: {
  provider: CommandArgProvider;
  initial: string;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  const controls = mockControls({ commands: sampleCommands() });
  return (
    <div>
      <textarea aria-label="prompt" value={value} onChange={(e) => setValue(e.target.value)} />
      <PiCommandPalette
        controls={controls}
        value={value}
        onChange={setValue}
        commandArgProvider={provider}
      />
      <span data-testid="value">{value}</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
    await Promise.resolve();
  });
}

describe("PiCommandPalette 子命令补全", () => {
  it("/plugin 后展示子命令 install/uninstall/list", () => {
    const provider = makeProvider(async () => []);
    render(<Harness provider={provider} initial="/plugin " />);
    expect(screen.getByText("/plugin install")).toBeInTheDocument();
    expect(screen.getByText("/plugin uninstall")).toBeInTheDocument();
    expect(screen.getByText("/plugin list")).toBeInTheDocument();
  });

  it("/plugin un 按前缀过滤(仅 uninstall)", () => {
    const provider = makeProvider(async () => []);
    render(<Harness provider={provider} initial="/plugin un" />);
    expect(screen.getByText("/plugin uninstall")).toBeInTheDocument();
    expect(screen.queryByText("/plugin install")).not.toBeInTheDocument();
  });

  it("选中 install(非终态)→ 填 /plugin install 不提交、进入参数阶段", () => {
    const provider = makeProvider(async () => []);
    render(<Harness provider={provider} initial="/plugin " />);
    fireEvent.click(screen.getByText("/plugin install"));
    expect((screen.getByTestId("value") as HTMLElement).textContent).toBe(
      "/plugin install ",
    );
  });

  it("Tab 与 Enter 等价:确认高亮子命令 → 填 /plugin install ", () => {
    const provider = makeProvider(async () => []);
    render(<Harness provider={provider} initial="/plugin " />);
    // 默认高亮首个子命令(install);Tab 确认。
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect((screen.getByTestId("value") as HTMLElement).textContent).toBe(
      "/plugin install ",
    );
  });

  it("终态 list 就位(/plugin list )后浮层关闭(让 Enter 执行)", () => {
    const provider = makeProvider(async () => []);
    const { container } = render(
      <Harness provider={provider} initial="/plugin list " />,
    );
    expect(
      container.querySelector("[data-pi-command-palette]"),
    ).not.toBeInTheDocument();
  });
});

describe("PiCommandPalette 参数补全", () => {
  it("/plugin uninstall 调 listArgs 取已装候选并展示", async () => {
    const listArgs = vi.fn(async () => [
      { id: "@my/ext", label: "@my/ext", insertText: "@my/ext", detail: "npm" },
    ]);
    render(<Harness provider={makeProvider(listArgs)} initial="/plugin uninstall " />);
    await flush();
    expect(listArgs).toHaveBeenCalledWith(
      "plugin",
      "uninstall",
      "",
      expect.anything(),
    );
    expect(screen.getByText("@my/ext")).toBeInTheDocument();
  });

  it("选中参数候选 → 替换末段填 /plugin uninstall <id> ", async () => {
    const listArgs = vi.fn(async () => [
      { id: "@my/ext", label: "@my/ext", insertText: "@my/ext" },
    ]);
    render(<Harness provider={makeProvider(listArgs)} initial="/plugin uninstall " />);
    await flush();
    fireEvent.click(screen.getByText("@my/ext"));
    expect((screen.getByTestId("value") as HTMLElement).textContent).toBe(
      "/plugin uninstall @my/ext ",
    );
  });

  it("install 参数阶段取本地目录候选(local:)", async () => {
    const listArgs = vi.fn(async () => [
      { id: "./examples/a", label: "./examples/a", insertText: "local:./examples/a", detail: "local" },
    ]);
    render(<Harness provider={makeProvider(listArgs)} initial="/plugin install " />);
    await flush();
    expect(listArgs).toHaveBeenCalledWith("plugin", "install", "", expect.anything());
    fireEvent.click(screen.getByText("./examples/a"));
    expect((screen.getByTestId("value") as HTMLElement).textContent).toBe(
      "/plugin install local:./examples/a ",
    );
  });
});

describe("无 argSpec 命令不回归", () => {
  it("非 /plugin 命令走既有命令名补全", () => {
    const provider = makeProvider(async () => []);
    render(<Harness provider={provider} initial="/" />);
    // 既有命令(help/clear)仍按命令名补全展示。
    expect(screen.getByText("/help")).toBeInTheDocument();
  });
});
