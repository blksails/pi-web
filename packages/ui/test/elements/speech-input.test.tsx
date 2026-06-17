import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { SpeechInput } from "../../src/elements/speech-input.js";

/**
 * SpeechInput 语音输入按钮测试(Req 5.1/5.2/5.3/5.4、11.4)。
 *
 * 无状态元件:feature-detect Web Speech;点击开始转写,onresult 经 onTranscript 追加;
 * 再次点击停止;不支持或拒权(onerror not-allowed)隐藏/禁用 + 可读提示。
 *
 * 测试在 jsdom 下注入一个可手动触发 onresult/onerror 的 fake SpeechRecognition,
 * 并验证无该全局时的降级。
 */

/** 受控读取/写入 window 上 Web Speech 构造器的最小视图(禁止 any)。 */
interface SpeechWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

function speechWindow(): SpeechWindow {
  return window as unknown as SpeechWindow;
}

/** 可由测试驱动 onresult/onerror 的 fake SpeechRecognition 类。 */
class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  /** 触发一次最终转写结果。 */
  emitResult(transcript: string): void {
    this.onresult?.({
      results: [[{ transcript }]],
      resultIndex: 0,
    });
  }

  /** 触发一次错误(如 not-allowed 拒权)。 */
  emitError(error: string): void {
    this.onerror?.({ error });
  }
}

function installFakeSR(): typeof FakeSpeechRecognition {
  FakeSpeechRecognition.instances = [];
  speechWindow().SpeechRecognition = FakeSpeechRecognition;
  return FakeSpeechRecognition;
}

afterEach(() => {
  delete speechWindow().SpeechRecognition;
  delete speechWindow().webkitSpeechRecognition;
  FakeSpeechRecognition.instances = [];
});

describe("SpeechInput 语音输入按钮", () => {
  it("支持时渲染麦克风按钮,带 aria-label 与初始 aria-pressed=false (Req 5.1/11.4)", () => {
    installFakeSR();
    render(<SpeechInput onTranscript={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("点击开始录音并 start(),aria-pressed=true (Req 5.2)", async () => {
    const SR = installFakeSR();
    const user = userEvent.setup();
    render(<SpeechInput onTranscript={vi.fn()} />);
    await user.click(screen.getByRole("button"));
    expect(SR.instances).toHaveLength(1);
    expect(SR.instances[0]?.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("onresult 时把转写文本经 onTranscript 追加 (Req 5.2)", async () => {
    const SR = installFakeSR();
    const user = userEvent.setup();
    const onTranscript = vi.fn();
    render(<SpeechInput onTranscript={onTranscript} />);
    await user.click(screen.getByRole("button"));
    act(() => {
      SR.instances[0]?.emitResult("你好世界");
    });
    expect(onTranscript).toHaveBeenCalledWith("你好世界");
  });

  it("再次点击停止录音并 stop(),保留状态,aria-pressed=false (Req 5.3)", async () => {
    const SR = installFakeSR();
    const user = userEvent.setup();
    render(<SpeechInput onTranscript={vi.fn()} />);
    const button = screen.getByRole("button");
    await user.click(button);
    await user.click(button);
    expect(SR.instances[0]?.stop).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("应用可选 lang 到 recognition (Req 5.2)", async () => {
    const SR = installFakeSR();
    const user = userEvent.setup();
    render(<SpeechInput onTranscript={vi.fn()} lang="zh-CN" />);
    await user.click(screen.getByRole("button"));
    expect(SR.instances[0]?.lang).toBe("zh-CN");
  });

  it("不支持 Web Speech 时不渲染按钮并给出可读提示 (Req 5.1/5.4)", () => {
    // 未安装任何 SpeechRecognition 全局。
    render(<SpeechInput onTranscript={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // 可读提示存在(给屏幕阅读/用户)。
    expect(screen.getByText(/不支持|不可用|语音/)).toBeInTheDocument();
  });

  it("拒权(onerror not-allowed)后禁用按钮并给可读提示,不影响其它输入 (Req 5.4)", async () => {
    const SR = installFakeSR();
    const user = userEvent.setup();
    render(<SpeechInput onTranscript={vi.fn()} />);
    const button = screen.getByRole("button");
    await user.click(button);
    act(() => {
      SR.instances[0]?.emitError("not-allowed");
    });
    const after = screen.getByRole("button");
    expect(after).toBeDisabled();
    expect(after).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/权限|拒绝|麦克风|不可用/)).toBeInTheDocument();
  });

  it("通过 webkitSpeechRecognition 也能 feature-detect (Req 5.1)", () => {
    FakeSpeechRecognition.instances = [];
    speechWindow().webkitSpeechRecognition = FakeSpeechRecognition;
    render(<SpeechInput onTranscript={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
