/**
 * PiToolPart — 默认工具卡(复合组件)。
 *
 * 参考 AI SDK Elements `Tool` 复合化为可装配、可独立替换的子组件:
 *   - <ToolHeader>  工具名 + 状态徽章(含 Streaming 旋转图标) + 折叠触发器
 *   - <ToolContent> 明细区容器(按 open 控制可见,承载 data-pi-tool-detail 与 aria id)
 *   - <ToolInput>   入参 JSON 代码块(同步 language-json,保留缩进可读)
 *   - <ToolOutput>  输出(接受任意 ReactNode)或错误文本
 *   - <PiToolPart>  装配壳:推导 phase / 工具名 / 按状态展开,承载根 data 属性
 *
 * 对应 AI SDK `ToolUIPart` / `DynamicToolUIPart` 的 `state`:
 *   - input-streaming / input-available  → start 态(Running,默认折叠)
 *   - output-available(preliminary)     → update 态(Streaming,默认展开:让流式增量可见)
 *   - output-available(最终)            → end 态(Completed,默认展开)
 *   - output-error                       → error 态(Error,默认展开,destructive)
 *
 * 默认展开策略:未显式传 `defaultOpen` 时,update / end / error 展开(有输出即显),仅 start 折叠。
 * 明细区可折叠并带键盘可达 + aria 状态。数据型 input/output 用同步 JSON 代码块
 * (实测 streamdown shiki 对代码块异步高亮且破坏文本格式,见 spec research.md R4),
 * 字符串型 output 经 Response 富渲染。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, Timer, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Card } from "../ui/card.js";
import { Response } from "../ui/response.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

type AnyPart = UIMessage["parts"][number];
export type ToolPart =
  | Extract<AnyPart, { type: `tool-${string}` }>
  | Extract<AnyPart, { type: "dynamic-tool" }>;

export type ToolPhase = "start" | "update" | "end" | "error";

/** phase → i18n key(在组件内经 t(key) 翻译为徽章文案)。 */
export const PHASE_LABEL_KEY: Record<ToolPhase, string> = {
  start: "toolPart.status.running",
  update: "toolPart.status.streaming",
  end: "toolPart.status.completed",
  error: "toolPart.status.error",
};

/** 从 part 推导工具名(dynamic-tool 用 toolName,静态用 `tool-<name>`)。 */
export function toolNameOf(part: ToolPart): string {
  if (part.type === "dynamic-tool") return part.toolName;
  return part.type.slice("tool-".length);
}

/** 从 part.state 推导渲染 phase。 */
export function phaseOf(part: ToolPart): ToolPhase {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "start";
    case "output-error":
      return "error";
    case "output-available":
      return part.preliminary === true ? "update" : "end";
    default:
      return "start";
  }
}

/**
 * 把毫秒时长格式化为人读字符串。
 * - settled=false(运行中):整秒跳动,`<秒>s`。
 * - settled=true(已定格):精确到 0.1s,`<秒>.<十分位>s`。
 * - ≥60s 一律用 `分:秒`(零填充秒)。
 */
export function formatDuration(ms: number, settled: boolean): string {
  const totalSec = Math.max(0, ms) / 1000;
  if (totalSec >= 60) {
    const whole = Math.floor(totalSec);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return settled ? `${totalSec.toFixed(1)}s` : `${Math.floor(totalSec)}s`;
}

/**
 * 工具卡执行计时器。
 *
 * 仅当组件「挂载时即处于运行态(start/update)」才计时——惰性捕获开始时刻;历史
 * 回放(直接以 end/error 态挂载)无开始锚点,返回 `label: null` 不显示。运行中每秒
 * 驱动重渲染;进入终态时定格结束时刻,后续不再变化。
 */
function useToolTimer(phase: ToolPhase): {
  label: string | null;
  settled: boolean;
} {
  const isRunning = phase === "start" || phase === "update";
  const [startedAt] = React.useState<number | null>(() =>
    isRunning ? Date.now() : null,
  );
  const [endedAt, setEndedAt] = React.useState<number | null>(null);
  const [, setNow] = React.useState(() => Date.now());

  // 终态定格:有开始时刻且转入非运行态时,记录结束时刻一次。
  React.useEffect(() => {
    if (startedAt !== null && !isRunning && endedAt === null) {
      setEndedAt(Date.now());
    }
  }, [startedAt, isRunning, endedAt]);

  // 运行中每秒 tick(未计时或已定格则不开)。
  React.useEffect(() => {
    if (startedAt === null || !isRunning || endedAt !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, isRunning, endedAt]);

  if (startedAt === null) return { label: null, settled: false };
  const settled = endedAt !== null;
  const end = endedAt ?? Date.now();
  return { label: formatDuration(end - startedAt, settled), settled };
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// 轻量同步 JSON token 高亮:把 JSON 文本切成 key/string/number/bool/null/punct
// 片段并包 <span>,配色经 styles.css 的 --pi-json-* 主题变量(亮暗适配)。同步渲染、
// 保留完整文本节点(textContent 可断言),不依赖异步 shiki(见 spec research.md R4)。
const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(src: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of src.matchAll(JSON_TOKEN_RE)) {
    const [match, str, colon, kw, num] = m;
    const offset = m.index ?? 0;
    if (offset > last) nodes.push(src.slice(last, offset));
    if (str !== undefined) {
      // string 后跟冒号 → 视为对象 key。
      nodes.push(
        <span
          key={key++}
          className={colon ? "pi-json-key" : "pi-json-string"}
        >
          {str}
        </span>,
      );
      if (colon) {
        nodes.push(
          <span key={key++} className="pi-json-punct">
            {colon}
          </span>,
        );
      }
    } else if (kw !== undefined) {
      nodes.push(
        <span
          key={key++}
          className={kw === "null" ? "pi-json-null" : "pi-json-bool"}
        >
          {kw}
        </span>,
      );
    } else if (num !== undefined) {
      nodes.push(
        <span key={key++} className="pi-json-number">
          {num}
        </span>,
      );
    }
    last = offset + match.length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

export interface ToolHeaderProps {
  readonly name: string;
  readonly phase: ToolPhase;
  readonly open: boolean;
  /** aria-controls 目标(明细区 id)。 */
  readonly contentId: string;
  readonly onToggle: () => void;
  readonly className?: string;
  /** 计时器文案(运行中跳动 / 终态定格);null 不显示(如历史回放)。 */
  readonly timerLabel?: string | null;
  /** 计时器是否已定格(终态)。 */
  readonly timerSettled?: boolean;
}

/** 工具卡头部:折叠触发器 + 工具名 + 计时器 + 状态徽章。 */
export function ToolHeader({
  name,
  phase,
  open,
  contentId,
  onToggle,
  className,
  timerLabel,
  timerSettled = false,
}: ToolHeaderProps): React.JSX.Element {
  const t = useI18n();
  const isError = phase === "error";
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className,
      )}
    >
      {open ? (
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      )}
      <Wrench className="h-4 w-4 opacity-70" aria-hidden="true" />
      <span className="font-medium" data-pi-tool-name-label>
        {name}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {timerLabel != null ? (
          <span
            className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-[hsl(var(--muted-foreground))]"
            data-pi-tool-timer
            data-pi-tool-timer-settled={timerSettled ? "true" : "false"}
          >
            <Timer className="h-3 w-3" aria-hidden="true" />
            {timerLabel}
          </span>
        ) : null}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            isError
              ? "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"
              : "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          )}
          data-pi-tool-status
        >
          {phase === "update" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          {t(PHASE_LABEL_KEY[phase])}
        </span>
      </span>
    </button>
  );
}

export interface ToolContentProps {
  /** 明细区 id(被 ToolHeader 的 aria-controls 引用)。 */
  readonly id: string;
  readonly open: boolean;
  readonly isError?: boolean;
  readonly className?: string;
  readonly children?: React.ReactNode;
}

/** 工具卡明细区容器:按 open 控制可见,承载 data-pi-tool-detail。 */
export function ToolContent({
  id,
  open,
  isError = false,
  className,
  children,
}: ToolContentProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      id={id}
      className={cn(
        "border-t border-[hsl(var(--border))] px-3 py-2",
        isError && "text-[hsl(var(--destructive))]",
        className,
      )}
      data-pi-tool-detail
    >
      {children}
    </div>
  );
}

/** 同步 JSON 代码块:轻量 token 高亮 + 代码块外观(muted 背景/圆角),保留缩进与完整文本。 */
function JsonBlock({
  value,
  className,
}: {
  readonly value: unknown;
  readonly className?: string;
}): React.JSX.Element {
  const text = stringify(value);
  return (
    <pre
      className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius)] bg-[hsl(var(--muted))] p-2 text-xs",
        className,
      )}
    >
      <code className="language-json">{highlightJson(text)}</code>
    </pre>
  );
}

export interface ToolInputProps {
  readonly input: unknown;
  readonly className?: string;
}

/** 工具入参:同步 JSON 代码块。 */
export function ToolInput({
  input,
  className,
}: ToolInputProps): React.JSX.Element {
  return <JsonBlock value={input} className={className} />;
}

export interface ToolOutputProps {
  /** 输出节点;为富节点直接渲染,装配壳负责按类型转换默认节点。 */
  readonly output?: React.ReactNode;
  readonly errorText?: string;
  readonly className?: string;
}

/** 工具输出:渲染输出节点或错误文本。 */
export function ToolOutput({
  output,
  errorText,
  className,
}: ToolOutputProps): React.JSX.Element {
  return (
    <div className={cn("text-xs", className)}>
      {errorText !== undefined ? errorText : output}
    </div>
  );
}

/**
 * 从 pi 工具结果里抽可读文本(含图片/链接 markdown)。
 *
 * 工具结果经翻译层为 `{content: ContentItem[], details?}`(带结构化 details 时)或直接 `ContentItem[]`
 * (见 agent-message-to-ui)。`content` 里 `type:"text"` 项的 `text` 拼接即工具的人读输出(AIGC 图像
 * 工具在此放 `![](url)` markdown)。无文本项 → 返回 undefined(交由 JSON 代码块兜底)。
 */
function textFromToolContent(output: unknown): string | undefined {
  const content = Array.isArray(output)
    ? output
    : (output as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const texts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text === "string" && text.length > 0) texts.push(text);
  }
  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

/** 行内图片 markdown(`![alt](src)`);src 到首个 `)` 前(URL/data URI 均无裸 `)`)。 */
const IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * 从附件签名 URL(`/api/attachments/att_xxx/raw?…`)抽 `att_` id。通用元数据(不耦合任何域):
 * 落在工具图 `data-att-id` 上,供 Canvas 等域**委托监听**据此开工作台;data URI(流式 partial)无 id。
 */
function attIdFromUrl(url: string): string | undefined {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}

/** 把工具文本分离为「其余文本」与「图片列表」——图片改原生 `<img>` 块渲染,不进 markdown 段落。 */
function splitToolText(raw: string): {
  text: string;
  images: { alt: string; src: string }[];
} {
  const images: { alt: string; src: string }[] = [];
  IMG_MD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_MD_RE.exec(raw)) !== null) {
    images.push({ alt: m[1] ?? "", src: (m[2] ?? "").trim() });
  }
  const text = raw.replace(IMG_MD_RE, "").replace(/\n{2,}/g, "\n").trim();
  return { text, images };
}

/**
 * 按输出值类型生成默认渲染节点:
 *  - 字符串 → Response 富渲染;
 *  - pi 工具结果(`{content, details}` / `ContentItem[]`)→ 抽 content 文本,**文本经 Response 渲染、
 *    图片抽出用原生 `<img>` 块渲染**(避免 Streamdown 把图片 `<div>` 包裹嵌进 markdown `<p>` 触发
 *    「div cannot be descendant of p」hydration 错;顺带绕开 rehype 对 data: 的限制),结构化 details
 *    折叠附于其后(不再整体 dump JSON);
 *  - 其它数据 → JSON 代码块。
 */
function defaultOutputNode(output: unknown): React.ReactNode {
  if (output === undefined) return null;
  if (typeof output === "string") return <Response>{output}</Response>;
  const raw = textFromToolContent(output);
  if (raw !== undefined) {
    const { text, images } = splitToolText(raw);
    const details =
      !Array.isArray(output) &&
      (output as { details?: unknown } | null)?.details !== undefined
        ? (output as { details?: unknown }).details
        : undefined;
    return (
      <div className="space-y-2">
        {text !== "" ? <Response>{text}</Response> : null}
        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-pi-tool-images>
            {images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${i}-${img.src.slice(0, 32)}`}
                src={img.src}
                alt={img.alt}
                loading="lazy"
                {...(attIdFromUrl(img.src) !== undefined
                  ? { "data-att-id": attIdFromUrl(img.src) }
                  : {})}
                className="max-h-64 max-w-full rounded-md border border-[hsl(var(--border))] object-contain"
              />
            ))}
          </div>
        ) : null}
        {details !== undefined ? (
          <details className="text-[11px]">
            <summary className="cursor-pointer select-none text-[hsl(var(--muted-foreground))]">
              详情
            </summary>
            <JsonBlock value={details} className="mt-1" />
          </details>
        ) : null}
      </div>
    );
  }
  return <JsonBlock value={output} />;
}

// ---------------------------------------------------------------------------
// 装配壳
// ---------------------------------------------------------------------------

export interface PiToolPartProps {
  readonly part: ToolPart;
  readonly message?: UIMessage;
  /** 显式展开值;未提供时按状态推导(end/error 展开,start/update 折叠)。 */
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

export function PiToolPart({
  part,
  defaultOpen,
  className,
}: PiToolPartProps): React.JSX.Element {
  const phase = phaseOf(part);
  const name = toolNameOf(part);
  const isError = phase === "error";
  const contentId = React.useId();
  // 按状态默认展开:update / end / error 展开(有输出即显,含流式增量),仅 start 折叠;
  // 显式 defaultOpen 优先。用 derived state + 用户覆盖:phase 变化时随之展开;用户手动切换
  // 后由其接管,后续 phase 变化不再覆盖用户选择。
  const autoOpen = defaultOpen ?? (phase === "update" || phase === "end" || phase === "error");
  const [userOverride, setUserOverride] = React.useState<boolean | null>(null);
  const open = userOverride ?? autoOpen;
  const onToggle = () => setUserOverride(!open);
  // 执行计时:运行中逐秒跳动,终态定格总耗时;历史回放(直接终态挂载)不计时。
  const timer = useToolTimer(phase);

  let detail: React.ReactNode;
  if (phase === "error") {
    detail = (
      <ToolOutput
        errorText={part.state === "output-error" ? part.errorText : ""}
      />
    );
  } else if (phase === "update" || phase === "end") {
    detail = (
      <ToolOutput
        output={defaultOutputNode(
          part.state === "output-available" ? part.output : undefined,
        )}
      />
    );
  } else {
    detail = (
      <ToolInput
        input={
          part.state === "input-available" || part.state === "input-streaming"
            ? part.input
            : undefined
        }
      />
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden",
        isError && "border-[hsl(var(--destructive))]",
        className,
      )}
      data-pi-tool
      data-pi-tool-phase={phase}
      data-pi-tool-name={name}
    >
      <ToolHeader
        name={name}
        phase={phase}
        open={open}
        contentId={contentId}
        onToggle={onToggle}
        timerLabel={timer.label}
        timerSettled={timer.settled}
      />
      <ToolContent id={contentId} open={open} isError={isError}>
        {detail}
      </ToolContent>
    </Card>
  );
}
