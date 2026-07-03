import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  PiToolPart,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  formatDuration,
} from "../../src/parts/pi-tool-part.js";
import {
  toolStartPart,
  toolUpdatePart,
  toolEndPart,
  toolErrorPart,
} from "../fixtures/ui-message-fixtures.js";

describe("PiToolPart 四态", () => {
  it("start 态:Running 徽章 + 工具名;默认折叠,显式展开后显示入参", () => {
    // 默认折叠(start 态)→ 徽章与工具名可见,明细不可见。
    const { rerender } = render(
      <PiToolPart part={toolStartPart("search", { q: "pi" })} />,
    );
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "start");
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(card?.querySelector("[data-pi-tool-detail]")).toBeNull();
    // 显式展开后入参以 JSON 呈现。
    rerender(
      <PiToolPart
        part={toolStartPart("search", { q: "pi" })}
        defaultOpen={true}
      />,
    );
    const detail = screen
      .getByText("search")
      .closest("[data-pi-tool]")
      ?.querySelector("[data-pi-tool-detail]");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('"q": "pi"');
    expect(detail?.querySelector("code.language-json")).not.toBeNull();
  });

  it("update 态:Streaming 徽章 + 旋转图标;默认展开显示流式累积值", () => {
    render(
      <PiToolPart part={toolUpdatePart("search", { q: "pi" }, { partial: 1 })} />,
    );
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "update");
    expect(screen.getByText("Streaming")).toBeInTheDocument();
    // Streaming 徽章含旋转图标。
    expect(
      card?.querySelector("[data-pi-tool-status] .animate-spin"),
    ).not.toBeNull();
    // update 态默认展开(无需显式 defaultOpen),流式增量可见。
    expect(
      card?.querySelector("[data-pi-tool-detail]")?.textContent,
    ).toContain('"partial": 1');
  });

  it("end 态:Completed 徽章;默认展开显示结果", () => {
    render(<PiToolPart part={toolEndPart("search", { q: "pi" }, { hits: 3 })} />);
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "end");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // end 态默认展开(无需显式 defaultOpen)。
    const detail = card?.querySelector("[data-pi-tool-detail]");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('"hits": 3');
  });

  it("error 态:Error 徽章 + destructive;默认展开显示错误文本", () => {
    render(<PiToolPart part={toolErrorPart("search", { q: "pi" }, "boom")} />);
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "error");
    expect(screen.getByText("Error")).toBeInTheDocument();
    // error 态默认展开,错误文本可见。
    expect(screen.getByText("boom")).toBeInTheDocument();
    // destructive 边框(根容器)。
    expect(card?.className).toContain("--destructive");
  });

  it("字符串型 output 经富渲染原语呈现(同步文本)", () => {
    render(
      <PiToolPart
        part={toolEndPart("echo", {}, "hello result")}
        defaultOpen={true}
      />,
    );
    expect(screen.getByText("hello result")).toBeInTheDocument();
  });

  it("pi 工具结果 {content,details}:渲染 content 文本(非整体 JSON dump),details 折叠", () => {
    render(
      <PiToolPart
        part={toolEndPart("image_generation", {}, {
          content: [{ type: "text", text: "生成成功:1 张图像已保存" }],
          details: { ok: true, model: "gpt-5.4-image-2" },
        })}
        defaultOpen={true}
      />,
    );
    const detail = screen
      .getByText("image_generation")
      .closest("[data-pi-tool]")
      ?.querySelector("[data-pi-tool-detail]");
    // content 文本经 Response 渲染(可读),而非把整个对象 dump 成 JSON。
    expect(detail?.textContent).toContain("生成成功:1 张图像已保存");
    // 结构化 details 收进可折叠「详情」,不喧宾夺主。
    const disclosure = detail?.querySelector("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.querySelector("summary")?.textContent).toBe("详情");
  });

  it("保留全部 data 属性:tool / phase / name / status / detail", () => {
    render(<PiToolPart part={toolEndPart("search", {}, { hits: 3 })} />);
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "end");
    expect(card).toHaveAttribute("data-pi-tool-name", "search");
    expect(card?.querySelector("[data-pi-tool-status]")).not.toBeNull();
    expect(card?.querySelector("[data-pi-tool-detail]")).not.toBeNull();
  });

  it("按状态默认展开:start 折叠、update/end/error 展开;显式 defaultOpen 覆盖", () => {
    const { rerender } = render(
      <PiToolPart part={toolStartPart("t", {})} />,
    );
    // start(仅入参、无输出)默认折叠。
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    // update(流式增量)默认展开,让输出可见。
    rerender(<PiToolPart part={toolUpdatePart("t", {}, { partial: 1 })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    rerender(<PiToolPart part={toolEndPart("t", {}, { ok: 1 })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    // 显式覆盖:end 态强制折叠。
    rerender(
      <PiToolPart part={toolEndPart("t", {}, { ok: 1 })} defaultOpen={false} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("折叠区可键盘展开且带 aria 状态;aria-controls 指向明细 id", async () => {
    const user = userEvent.setup();
    render(
      <PiToolPart
        part={toolEndPart("search", {}, { hits: 3 })}
        defaultOpen={false}
      />,
    );
    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(controls as string);
    expect(detail).toHaveAttribute("data-pi-tool-detail");
    expect(detail?.textContent).toContain('"hits": 3');
  });
});

describe("formatDuration", () => {
  it("运行中整秒,定格精确到 0.1s", () => {
    expect(formatDuration(0, false)).toBe("0s");
    expect(formatDuration(3400, false)).toBe("3s");
    expect(formatDuration(3400, true)).toBe("3.4s");
  });

  it("≥60s 用 分:秒(零填充)", () => {
    expect(formatDuration(65000, false)).toBe("1:05");
    expect(formatDuration(125000, true)).toBe("2:05");
  });

  it("负值兜底为 0", () => {
    expect(formatDuration(-100, false)).toBe("0s");
  });
});

describe("PiToolPart 执行计时器", () => {
  it("运行态:挂载显示 0s 并随时间逐秒跳动(未定格)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<PiToolPart part={toolStartPart("gen", {})} />);
      const timer = container.querySelector("[data-pi-tool-timer]");
      expect(timer).not.toBeNull();
      expect(timer?.textContent).toContain("0s");
      expect(timer).toHaveAttribute("data-pi-tool-timer-settled", "false");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(
        container.querySelector("[data-pi-tool-timer]")?.textContent,
      ).toContain("3s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("历史回放(直接以 end 态挂载)不计时", () => {
    const { container } = render(
      <PiToolPart part={toolEndPart("gen", {}, { ok: 1 })} />,
    );
    expect(container.querySelector("[data-pi-tool-timer]")).toBeNull();
  });

  it("start→end:计时定格总耗时(0.1s 精度)并标记 settled", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <PiToolPart part={toolStartPart("gen", {})} />,
      );
      act(() => {
        vi.advanceTimersByTime(4200);
      });
      rerender(<PiToolPart part={toolEndPart("gen", {}, { ok: 1 })} />);
      // 推进定格 effect。
      act(() => {});

      const timer = container.querySelector("[data-pi-tool-timer]");
      expect(timer).not.toBeNull();
      expect(timer).toHaveAttribute("data-pi-tool-timer-settled", "true");
      expect(timer?.textContent).toContain("4.2s");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("复合子组件可独立渲染", () => {
  it("ToolHeader 独立渲染徽章与触发器", () => {
    let toggled = false;
    render(
      <ToolHeader
        name="deploy"
        phase="error"
        open={false}
        contentId="c1"
        onToggle={() => {
          toggled = true;
        }}
      />,
    );
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-controls", "c1");
    btn.click();
    expect(toggled).toBe(true);
  });

  it("ToolContent 折叠时不渲染、展开时承载 detail 与 id", () => {
    const { rerender } = render(
      <ToolContent id="c2" open={false}>
        body
      </ToolContent>,
    );
    expect(screen.queryByText("body")).toBeNull();
    rerender(
      <ToolContent id="c2" open={true}>
        body
      </ToolContent>,
    );
    const el = screen.getByText("body");
    expect(el).toHaveAttribute("id", "c2");
    expect(el).toHaveAttribute("data-pi-tool-detail");
  });

  it("ToolInput 渲染 language-json 代码块并同步高亮 JSON token", () => {
    const { container } = render(<ToolInput input={{ a: 1, ok: true }} />);
    expect(container.querySelector("code.language-json")).not.toBeNull();
    // 完整文本保留(textContent 可断言)。
    expect(container.textContent).toContain('"a": 1');
    // 同步 token 高亮:key / number / bool 各自包 span 着色(非无色纯文本)。
    expect(container.querySelector(".pi-json-key")).not.toBeNull();
    expect(container.querySelector(".pi-json-number")).not.toBeNull();
    expect(container.querySelector(".pi-json-bool")).not.toBeNull();
  });

  it("ToolOutput 渲染错误文本优先于 output", () => {
    render(<ToolOutput output={<span>ok</span>} errorText="bad" />);
    expect(screen.getByText("bad")).toBeInTheDocument();
    expect(screen.queryByText("ok")).toBeNull();
  });
});
