/**
 * 工具卡「终止本轮」按钮测试(spec aigc-tool-abort,UI 扩展)。
 *
 * ★ 立项动机:用户截图 —— `image_generation  11s  Running` 的卡片上没有任何停止入口,
 * 停止按钮只在输入框那里。图像生成常耗时 20~60s,视线一直在卡片上,让用户跑回输入框是多余一跳。
 *
 * ★ 语义边界(测试要钉死的重点):协议层只有会话级 `POST /sessions/:id/abort`,**没有**单工具
 * 取消端点。所以卡片上的停止 = **终止本轮**。按钮文案必须如实反映,不能写成「停止此工具」。
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PiToolPart, type ToolPart } from "../../src/parts/pi-tool-part.js";
import { TurnAbortProvider } from "../../src/chat/turn-abort-context.js";

function runningPart(): ToolPart {
  return {
    type: "tool-image_generation",
    toolCallId: "call_1",
    state: "input-available",
    input: { prompt: "一只猫" },
  } as unknown as ToolPart;
}

function finishedPart(): ToolPart {
  return {
    type: "tool-image_generation",
    toolCallId: "call_1",
    state: "output-available",
    input: { prompt: "一只猫" },
    output: "done",
  } as unknown as ToolPart;
}

const stopBtn = (): HTMLElement | null => document.querySelector("[data-pi-tool-stop]");

describe("工具卡停止按钮 — 出现条件", () => {
  it("★ 运行中 + 宿主提供了终止能力 → 显示停止按钮", () => {
    render(
      <TurnAbortProvider onAbortTurn={() => undefined}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    expect(stopBtn()).not.toBeNull();
  });

  it("★ 已完成 → 不显示(停一个已经结束的工具没有意义)", () => {
    render(
      <TurnAbortProvider onAbortTurn={() => undefined}>
        <PiToolPart part={finishedPart()} />
      </TurnAbortProvider>,
    );
    expect(stopBtn()).toBeNull();
  });

  it("★ 宿主未提供终止能力 → 不显示(而不是渲染一个点了没反应的按钮)", () => {
    render(
      <TurnAbortProvider onAbortTurn={undefined}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    expect(stopBtn()).toBeNull();
  });

  it("未包 Provider 时不显示 —— 行为与引入本特性之前逐字节一致", () => {
    render(<PiToolPart part={runningPart()} />);
    expect(stopBtn()).toBeNull();
  });
});

describe("工具卡停止按钮 — 行为", () => {
  it("点击触发终止回调", () => {
    const onAbort = vi.fn();
    render(
      <TurnAbortProvider onAbortTurn={onAbort}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    fireEvent.click(stopBtn() as HTMLElement);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("★ 点击停止**不**顺带展开/折叠卡片(stopPropagation)", () => {
    const onAbort = vi.fn();
    render(
      <TurnAbortProvider onAbortTurn={onAbort}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    const header = document.querySelector("[aria-expanded]") as HTMLElement;
    const before = header.getAttribute("aria-expanded");
    fireEvent.click(stopBtn() as HTMLElement);
    expect(header.getAttribute("aria-expanded"), "折叠态不应被停止点击改变").toBe(before);
  });

  it("★ 文案说明的是「终止本轮」而非「停止此工具」(协议层无单工具取消)", () => {
    render(
      <TurnAbortProvider onAbortTurn={() => undefined}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    const label = stopBtn()?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/本轮|turn/i);
    expect(label).not.toMatch(/此工具|this tool/i);
  });
});

describe("工具卡折叠可达性不回归(header 由 button 改 div)", () => {
  it("点击 header 仍可折叠展开", () => {
    render(<PiToolPart part={runningPart()} />);
    const header = document.querySelector("[aria-expanded]") as HTMLElement;
    const before = header.getAttribute("aria-expanded");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).not.toBe(before);
  });

  it("★ 键盘 Enter / Space 仍可折叠(改 div 后需自行处理,否则丢可达性)", () => {
    render(<PiToolPart part={runningPart()} />);
    const header = document.querySelector("[aria-expanded]") as HTMLElement;
    const before = header.getAttribute("aria-expanded");
    fireEvent.keyDown(header, { key: "Enter" });
    expect(header.getAttribute("aria-expanded")).not.toBe(before);
    fireEvent.keyDown(header, { key: " " });
    expect(header.getAttribute("aria-expanded")).toBe(before);
  });

  it("★ header 保持可聚焦与 aria 语义(role/tabIndex/aria-controls)", () => {
    render(<PiToolPart part={runningPart()} />);
    const header = document.querySelector("[aria-expanded]") as HTMLElement;
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("tabindex")).toBe("0");
    expect(header.getAttribute("aria-controls")).toBeTruthy();
  });

  it("★ DOM 中不存在 button 嵌套 button(非法 HTML)", () => {
    render(
      <TurnAbortProvider onAbortTurn={() => undefined}>
        <PiToolPart part={runningPart()} />
      </TurnAbortProvider>,
    );
    const nested = document.querySelector("button button");
    expect(nested, "button 不得嵌套 button").toBeNull();
  });
});
