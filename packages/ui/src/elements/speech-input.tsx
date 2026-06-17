/**
 * SpeechInput — 无状态的语音输入按钮(Req 5.1/5.2/5.3/5.4、11.4)。
 *
 * feature-detect Web Speech API(`window.SpeechRecognition || window.webkitSpeechRecognition`);
 * 点击开始监听并转写,onresult 时把转写文本经 `onTranscript` 回调交回(由装配层追加到输入框
 * value,Req 5.2);再次点击停止监听并保留已转写文本(Req 5.3)。浏览器不支持时不渲染按钮并
 * 给出可读提示(Req 5.1/5.4);用户拒绝麦克风权限(onerror,如 not-allowed)时禁用按钮并给可读
 * 提示,不影响其它输入方式(Req 5.4)。
 *
 * 本元件无 pi 接线逻辑:仅本地驱动 SpeechRecognition 并通过回调上抛文本。
 * 使用 lucide Mic 图标 + 既有 Button 基元 + cn,主题经 shadcn CSS 变量,无硬编码颜色(Req 11.5);
 * 按钮带 `aria-label` 与 `aria-pressed`(录音态)以满足无障碍(Req 11.4)。
 *
 * lib.dom 未必声明 `SpeechRecognition` 类型,这里自定义最小精确接口(禁止 any),并以
 * `window as unknown as {…}` 受控读取构造器。
 */
import * as React from "react";
import { Mic } from "lucide-react";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

/** 单条识别候选(最小视图)。 */
interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

/** 一段识别结果(类数组,索引取候选)。 */
interface SpeechRecognitionResult {
  readonly [index: number]: SpeechRecognitionAlternative;
}

/** 识别结果列表(类数组,索引取结果段)。 */
interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}

/** onresult 事件最小视图。 */
interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

/** onerror 事件最小视图。 */
interface SpeechRecognitionErrorEvent {
  readonly error: string;
}

/** SpeechRecognition 实例最小接口。 */
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** SpeechRecognition 构造器最小接口。 */
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

/** window 上 Web Speech 构造器的受控读取视图。 */
interface SpeechWindow {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/** feature-detect:返回可用的 SpeechRecognition 构造器或 undefined(Req 5.1)。 */
function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface SpeechInputProps {
  /** 转写文本回调;由装配层把它追加到输入框 value(Req 5.2)。 */
  readonly onTranscript: (text: string) => void;
  /** 可选识别语言(BCP-47,如 "zh-CN");传入时设到 recognition.lang。 */
  readonly lang?: string;
  /** 按钮无障碍标签,默认中文"语音输入"。 */
  readonly label?: string;
  /** 不支持时展示的可读提示,默认中文。 */
  readonly unsupportedHint?: string;
  /** 拒权时展示的可读提示,默认中文。 */
  readonly deniedHint?: string;
  readonly className?: string;
}

export function SpeechInput({
  onTranscript,
  lang,
  label = "语音输入",
  unsupportedHint = "当前浏览器不支持语音输入",
  deniedHint = "麦克风权限被拒绝,语音输入不可用",
  className,
}: SpeechInputProps): React.JSX.Element | null {
  // feature-detect 仅需一次;构造器引用在组件生命周期内稳定。
  const ctorRef = React.useRef<SpeechRecognitionConstructor | undefined>(
    undefined,
  );
  if (ctorRef.current === undefined) {
    ctorRef.current = getSpeechRecognitionCtor();
  }
  const supported = ctorRef.current !== undefined;

  const recognitionRef = React.useRef<SpeechRecognitionInstance | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [denied, setDenied] = React.useState(false);

  // 卸载时确保停止监听,避免悬挂的识别会话。
  React.useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  // 不支持:不渲染按钮,给出可读提示(Req 5.1/5.4)。
  if (!supported) {
    return (
      <span role="note" data-pi-speech-unsupported>
        {unsupportedHint}
      </span>
    );
  }

  const start = (): void => {
    const Ctor = ctorRef.current;
    if (Ctor === undefined) return;
    const recognition = new Ctor();
    if (lang !== undefined) recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEvent): void => {
      // 汇总本次新到达结果段的首选转写并上抛(由装配层追加,Req 5.2)。
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript;
        if (transcript !== undefined) text += transcript;
      }
      if (text.length > 0) onTranscript(text);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent): void => {
      // 拒权(如 not-allowed / service-not-allowed)→ 禁用并提示(Req 5.4)。
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        setDenied(true);
      }
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = (): void => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const stop = (): void => {
    // 停止监听并保留已转写文本(Req 5.3);文本由 onTranscript 已交回装配层。
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  };

  const handleClick = (): void => {
    if (recording) {
      stop();
      return;
    }
    start();
  };

  return (
    <span data-pi-speech-input>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={recording}
        disabled={denied}
        onClick={handleClick}
        className={cn(
          recording && "text-[hsl(var(--primary))]",
          className,
        )}
        data-pi-speech-button
        data-recording={recording ? "true" : "false"}
      >
        <Mic className="h-4 w-4" aria-hidden="true" />
      </Button>
      {denied ? (
        <span role="alert" data-pi-speech-denied>
          {deniedHint}
        </span>
      ) : null}
    </span>
  );
}
