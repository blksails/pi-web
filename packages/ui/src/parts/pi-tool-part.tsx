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
 *   - output-available(preliminary)     → update 态(Streaming,默认折叠)
 *   - output-available(最终)            → end 态(Completed,默认展开)
 *   - output-error                       → error 态(Error,默认展开,destructive)
 *
 * 默认展开策略:未显式传 `defaultOpen` 时,end / error 展开,start / update 折叠。
 * 明细区可折叠并带键盘可达 + aria 状态。数据型 input/output 用同步 JSON 代码块
 * (实测 streamdown shiki 对代码块异步高亮且破坏文本格式,见 spec research.md R4),
 * 字符串型 output 经 Response 富渲染。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Card } from "../ui/card.js";
import { Response } from "../ui/response.js";
import { cn } from "../lib/cn.js";

type AnyPart = UIMessage["parts"][number];
export type ToolPart =
  | Extract<AnyPart, { type: `tool-${string}` }>
  | Extract<AnyPart, { type: "dynamic-tool" }>;

export type ToolPhase = "start" | "update" | "end" | "error";

export const PHASE_LABEL: Record<ToolPhase, string> = {
  start: "Running",
  update: "Streaming",
  end: "Completed",
  error: "Error",
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
}

/** 工具卡头部:折叠触发器 + 工具名 + 状态徽章。 */
export function ToolHeader({
  name,
  phase,
  open,
  contentId,
  onToggle,
  className,
}: ToolHeaderProps): React.JSX.Element {
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
      <span
        className={cn(
          "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
          isError
            ? "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"
            : "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
        )}
        data-pi-tool-status
      >
        {phase === "update" ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        {PHASE_LABEL[phase]}
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

/** 按输出值类型生成默认渲染节点:字符串→Response 富渲染,数据→JSON 代码块。 */
function defaultOutputNode(output: unknown): React.ReactNode {
  if (output === undefined) return null;
  if (typeof output === "string") return <Response>{output}</Response>;
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
  // 按状态默认展开:end / error 展开,start / update 折叠;显式 defaultOpen 优先。
  // 用 derived state + 用户覆盖:phase 进入终态时随之展开;用户手动切换后由其接管,
  // 后续 phase 变化不再覆盖用户选择。
  const autoOpen = defaultOpen ?? (phase === "end" || phase === "error");
  const [userOverride, setUserOverride] = React.useState<boolean | null>(null);
  const open = userOverride ?? autoOpen;
  const onToggle = () => setUserOverride(!open);

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
      />
      <ToolContent id={contentId} open={open} isError={isError}>
        {detail}
      </ToolContent>
    </Card>
  );
}
