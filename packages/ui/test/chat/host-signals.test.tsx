/**
 * 宿主环境信号族(spec panes-only-right-panel 任务 1.4;Req 3.1–3.6)。
 *
 * ★ 最要紧的一条是**连点同一目标两次都触达**:下行具名信号「最后值即真值」,值不变不重推,
 * 只推目标标识的话第二次点击在 pane 侧完全观察不到。迁移前的实现用时间戳规避,
 * 同一毫秒内连点仍会失效 —— 这里改用单调递增序号,本文件有一条用例直接钉住它。
 */
import { describe, expect, it } from "vitest";
import { render, act } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import {
  useHostEnvironmentSignals,
  HOST_THEME_SIGNAL,
  HOST_TRANSCRIPT_FOCUS_SIGNAL,
  TRANSCRIPT_FOCUSABLE_ATTR,
  type TranscriptFocus,
} from "../../src/chat/host-signals.js";

/** 把 hook 的返回值逐帧记录下来。 */
function harness(enabled = true): { readonly frames: Array<Readonly<Record<string, unknown>>> } {
  const frames: Array<Readonly<Record<string, unknown>>> = [];
  function Probe(): React.JSX.Element {
    frames.push(useHostEnvironmentSignals(enabled));
    return <div />;
  }
  render(<Probe />);
  return { frames };
}

/** 造一张「工具产出区内、带附件标识」的图并点它。 */
function clickImage(attId: string): void {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-pi-tool-images", "true");
  const img = document.createElement("img");
  img.setAttribute("data-att-id", attId);
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  act(() => {
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const last = (frames: Array<Readonly<Record<string, unknown>>>): Readonly<Record<string, unknown>> =>
  frames[frames.length - 1]!;

describe("主题信号(Req 3.1/3.2)", () => {
  it("供给当前主题明暗,agent 无需自行计算", () => {
    const { frames } = harness();
    // 无 Provider 时 useTheme 返回默认解析值 —— 关键是这个键**在**,且取值合法。
    expect(Object.keys(last(frames))).toContain(HOST_THEME_SIGNAL);
    expect(["light", "dark"]).toContain(last(frames)[HOST_THEME_SIGNAL]);
  });
});

describe("★ 对话流焦点信号(Req 3.3)", () => {
  it("点击工具产出区内带标识的图 → 产生焦点信号", () => {
    const { frames } = harness();
    expect(last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL]).toBeUndefined();
    clickImage("att_a");
    expect(last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL]).toMatchObject({ id: "att_a" });
  });

  it("★★ 连点同一目标两次,两次都是新值(否则第二次在 pane 侧观察不到)", () => {
    const { frames } = harness();
    clickImage("att_same");
    const first = last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL] as TranscriptFocus;
    clickImage("att_same");
    const second = last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL] as TranscriptFocus;

    expect(second.id).toBe(first.id);
    // ★ 判别力所在:若实现只推 id(或用时间戳而两次落在同一毫秒),这两个值会相等,
    // 下行信号的「值不变不重推」就会把第二次点击整个吞掉。
    expect(second.seq).not.toBe(first.seq);
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it("序号单调递增且跨不同目标继续累加", () => {
    const { frames } = harness();
    clickImage("a");
    const s1 = (last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL] as TranscriptFocus).seq;
    clickImage("b");
    const s2 = (last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL] as TranscriptFocus).seq;
    expect(s2).toBeGreaterThan(s1);
  });

  it("工具产出区**外**的同类图不触发(避免误触对话流别处的图)", () => {
    const { frames } = harness();
    const img = document.createElement("img");
    img.setAttribute("data-att-id", "loose");
    document.body.appendChild(img);
    act(() => {
      img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL]).toBeUndefined();
  });

  it("无附件标识的图不触发", () => {
    const { frames } = harness();
    const wrap = document.createElement("div");
    wrap.setAttribute("data-pi-tool-images", "true");
    const img = document.createElement("img");
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    act(() => {
      img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL]).toBeUndefined();
  });
});

describe("样式钩子与启用门(Req 3.5)", () => {
  it("启用时给对话流打可聚焦钩子,卸载后移除", () => {
    const view = render(<Probe />);
    function Probe(): React.JSX.Element {
      useHostEnvironmentSignals(true);
      return <div />;
    }
    expect(document.body.getAttribute(TRANSCRIPT_FOCUSABLE_ATTR)).toBe("true");
    view.unmount();
    expect(document.body.getAttribute(TRANSCRIPT_FOCUSABLE_ATTR)).toBeNull();
  });

  it("★ 未启用时既不挂监听也不打钩子(无人消费就不该动文档)", () => {
    const { frames } = harness(false);
    expect(document.body.getAttribute(TRANSCRIPT_FOCUSABLE_ATTR)).toBeNull();
    clickImage("att_x");
    expect(last(frames)[HOST_TRANSCRIPT_FOCUS_SIGNAL]).toBeUndefined();
  });

  it("从未点击时**不放**焦点键,而不是放一个 undefined 值", () => {
    // 放 undefined 会与「推过一个空值」混淆 —— pane 侧无从区分「没点过」和「点了但清空了」。
    const { frames } = harness();
    expect(HOST_TRANSCRIPT_FOCUS_SIGNAL in last(frames)).toBe(false);
  });
});

describe("★ 领域中立(Req 3.4)", () => {
  it("信号名不含任何领域词汇", () => {
    for (const name of [HOST_THEME_SIGNAL, HOST_TRANSCRIPT_FOCUS_SIGNAL, TRANSCRIPT_FOCUSABLE_ATTR]) {
      expect(name).not.toMatch(/canvas|Canvas|CANVAS|lineage|Lineage|workbench|Workbench|checkerboard/);
    }
  });

  it("★ 实现文件整体零领域词命中(与会话外壳的中立守卫同一词表)", () => {
    // 这条与 canvas-ui 的 SES-H1 守卫重复是**有意的**:那个守卫扫的是整个 packages/ui/src,
    // 一旦有人给它加豁免锚,这里仍然会红。本文件是新增的宿主中立面,值得单独钉住。
    // ⚠ 不用 import.meta.url:jsdom 下它不是 file: scheme,fileURLToPath 会直接抛。
    // 两个候选覆盖「从包内跑」与「从仓库根跑」两种 cwd。
    const candidates = [
      resolve(process.cwd(), "src/chat/host-signals.ts"),
      resolve(process.cwd(), "packages/ui/src/chat/host-signals.ts"),
    ];
    const file = candidates.find((c) => existsSync(c));
    // 先证明确实读到了文件 —— 读不到的话下面的 not.toMatch 会对空串恒真(假绿)。
    expect(file, `未找到实现文件，候选: ${candidates.join(", ")}`).toBeDefined();
    const src = readFileSync(file!, "utf8");
    expect(src.length).toBeGreaterThan(500);
    expect(src).not.toMatch(/canvas|Canvas|CANVAS|lineage|Lineage|workbench|Workbench|checkerboard/);
  });
});
