/**
 * PartRenderer — 按 UIMessage part 类型分派渲染。
 *
 *   text         → <Response>(streamdown Markdown)
 *   reasoning    → <PiReasoning>
 *   tool-* / dynamic-tool → resolveToolRenderer(toolName) ?? <PiToolPart>
 *   data-*       → resolveDataPartRenderer(type) ?? 默认 data-part 渲染
 *
 * 纯渲染分派,不持状态、不依赖 hooks(便于单测)。解析顺序「注册表命中 → 默认」。
 */
import * as React from "react";
import type { UIMessage } from "ai";
import { Response } from "../ui/response.js";
import type { MarkdownProps } from "../elements/markdown.js";
import { useMaskPaths } from "../path-display/path-display-context.js";
import {
  PiReasoning,
  type ReasoningPart,
  type PiReasoningProps,
} from "../parts/pi-reasoning.js";
import {
  PiToolPart,
  type ToolPart,
  type PiToolPartProps,
} from "../parts/pi-tool-part.js";
import {
  defaultRendererRegistry,
  type RendererRegistry,
} from "../registry/renderer-registry.js";
import { ChatError } from "../elements/chat-error.js";
import { useI18n } from "../i18n/index.js";
import type { TranslateFn } from "../i18n/index.js";

type AnyPart = UIMessage["parts"][number];

export interface PartRendererProps {
  readonly part: AnyPart;
  readonly message: UIMessage;
  /** 可注入隔离的注册表实例;默认用模块级单例。 */
  readonly registry?: RendererRegistry;
  /** 文本 part 的 Markdown 渲染实现;默认 Response。可由 components.Markdown 覆盖。 */
  readonly markdown?: React.ComponentType<MarkdownProps>;
  /** reasoning part 的渲染实现;默认 PiReasoning。可由 components.Reasoning 覆盖。 */
  readonly reasoning?: React.ComponentType<PiReasoningProps>;
  /** 工具 part 的整卡渲染实现;默认 PiToolPart。可由 components.ToolPart 覆盖。
   *  优先级低于按工具名注册的渲染器(registry)。 */
  readonly toolPart?: React.ComponentType<PiToolPartProps>;
}

function isToolPart(part: AnyPart): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function isDataPart(
  part: AnyPart,
): part is Extract<AnyPart, { type: `data-${string}` }> {
  return part.type.startsWith("data-");
}

function toolNameOf(part: ToolPart): string {
  if (part.type === "dynamic-tool") return part.toolName;
  return part.type.slice("tool-".length);
}

/** 默认 data-part 渲染:JSON 预览(回退)。 */
function DefaultDataPart({
  part,
}: {
  readonly part: Extract<AnyPart, { type: `data-${string}` }>;
}): React.JSX.Element {
  const data = "data" in part ? part.data : undefined;
  return (
    <div
      className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--muted-foreground))]"
      data-pi-data-part={part.type}
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

/** auto-retry errorMessage 摘要上限(超出截断,避免状态条撑爆一行)。 */
const AUTO_RETRY_ERROR_TRUNCATE_LEN = 160;

/** data-pi-auto-retry 的 phase:"start" 数据形状(见 protocol AutoRetryDataPartSchema)。 */
interface AutoRetryStartData {
  readonly phase: "start";
  readonly attempt: number;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly errorMessage?: string;
}

/** 组装 auto-retry 状态条文案:「模型请求失败，第 N[/M] 次重试（Xs 后）：<errorMessage 摘要>」。 */
function formatAutoRetryStatus(
  t: TranslateFn,
  data: AutoRetryStartData,
  mask: (s: string) => string,
): string {
  const attemptText =
    data.maxAttempts !== undefined
      ? t("chat.autoRetry.attemptOfMax", {
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
      })
      : t("chat.autoRetry.attempt", { attempt: data.attempt });
  const delayText =
    data.delayMs !== undefined
      ? t("chat.autoRetry.delaySuffix", {
        delaySec: Math.round(data.delayMs / 1000),
      })
      : "";
  const base = `${t("chat.autoRetry.failed")}，${attemptText}${delayText}`;
  if (data.errorMessage === undefined || data.errorMessage === "") {
    return base;
  }
  const masked = mask(data.errorMessage);
  const truncated =
    masked.length > AUTO_RETRY_ERROR_TRUNCATE_LEN
      ? `${masked.slice(0, AUTO_RETRY_ERROR_TRUNCATE_LEN)}…`
      : masked;
  return `${base}：${truncated}`;
}

export function PartRenderer({
  part,
  message,
  registry = defaultRendererRegistry,
  markdown,
  reasoning,
  toolPart,
}: PartRendererProps): React.JSX.Element | null {
  const t = useI18n();
  const mask = useMaskPaths();
  if (part.type === "text") {
    const Md = markdown ?? Response;
    // 按 settings.pathDisplay 折叠绝对路径(流式组装后全文处理)。
    return <Md>{mask(part.text)}</Md>;
  }

  if (part.type === "reasoning") {
    const Reasoning = reasoning ?? PiReasoning;
    const raw = part as ReasoningPart;
    const masked =
      typeof raw.text === "string"
        ? ({ ...raw, text: mask(raw.text) } as ReasoningPart)
        : raw;
    return <Reasoning part={masked} />;
  }

  if (isToolPart(part)) {
    const name = toolNameOf(part);
    // 解析优先级:注册表(按工具名,含 webext 扩展) > 宿主 components.ToolPart > 默认 PiToolPart。
    const Custom = registry.resolveToolRenderer(name);
    if (Custom !== undefined) {
      return <Custom part={part} message={message} />;
    }
    // 注:PiToolPart(及 components.ToolPart 覆盖,均为 PiToolPartProps)不接受 markdown——
    // 工具字符串输出固定走 Response 富渲染;markdown 覆盖仅作用于 text 分支。
    const ToolComp = toolPart ?? PiToolPart;
    return <ToolComp part={part} message={message} />;
  }

  // data-pi-error:历史回放里 stopReason==="error" 的 assistant 消息(见
  // agent-message-to-ui)内联展示该次失败,复用 ChatError 的 destructive 样式;
  // 包一层 data-pi-message-error 以与底部全局 ChatError 区分(便于 e2e 定位)。
  if (part.type === "data-pi-error") {
    const data = "data" in part ? (part.data as { errorText?: unknown }) : undefined;
    const text =
      typeof data?.errorText === "string" ? mask(data.errorText) : "";
    return (
      <div data-pi-message-error>
        <ChatError message={text} />
      </div>
    );
  }

  // data-pi-auto-retry:自动重试进度条(生产 402/5xx 事故的 UI 断点修复)——重试期间此前只落在
  // data part 里、UI 从不渲染,用户只见"没回复"。phase:"start" 渲染顶部内联状态条;phase:"end"
  // 该次出现本身不渲染(状态条随之从消息流消失),历史上更早的 start 占位仍留痕供回放。
  if (part.type === "data-pi-auto-retry") {
    const data =
      "data" in part
        ? (part.data as {
          phase?: unknown;
          attempt?: unknown;
          maxAttempts?: unknown;
          delayMs?: unknown;
          errorMessage?: unknown;
        })
        : undefined;
    if (data?.phase !== "start" || typeof data.attempt !== "number") {
      return null;
    }
    const text = formatAutoRetryStatus(
      t,
      {
        phase: "start",
        attempt: data.attempt,
        ...(typeof data.maxAttempts === "number"
          ? { maxAttempts: data.maxAttempts }
          : {}),
        ...(typeof data.delayMs === "number" ? { delayMs: data.delayMs } : {}),
        ...(typeof data.errorMessage === "string"
          ? { errorMessage: data.errorMessage }
          : {}),
      },
      mask,
    );
    return (
      <div
        role="status"
        data-pi-auto-retry-status
        className="flex items-start gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--accent))] px-3 py-2 text-sm text-[hsl(var(--accent-foreground))]"
      >
        <span className="min-w-0 flex-1 break-words">{text}</span>
      </div>
    );
  }

  if (isDataPart(part)) {
    const Custom = registry.resolveDataPartRenderer(part.type);
    if (Custom !== undefined) {
      return <Custom part={part} message={message} />;
    }
    return <DefaultDataPart part={part} />;
  }

  // file(image):用户消息里发送的图片在历史回放时为 file part(见 agent-message-to-ui
  // 的 userParts → imageUrl),此前本层 return null 故不显示。仅渲染 image/* 媒体;
  // 非图片 file 与 step-start / source 等仍返回 null,行为不变。
  if (part.type === "file") {
    const filePart = part as {
      type: "file";
      url?: unknown;
      mediaType?: unknown;
      filename?: unknown;
    };
    const url = typeof filePart.url === "string" ? filePart.url : "";
    const mediaType =
      typeof filePart.mediaType === "string" ? filePart.mediaType : "";
    if (url !== "" && mediaType.startsWith("image/")) {
      const alt =
        typeof filePart.filename === "string" && filePart.filename !== ""
          ? filePart.filename
          : t("partRenderer.imageAlt");
      return (
        // eslint-disable-next-line @next/next/no-img-element -- ui 包不依赖 next/image;与 attachments.tsx 一致
        <img
          src={url}
          alt={alt}
          data-pi-message-image
          className="max-h-80 max-w-full rounded-[var(--radius)] border border-[hsl(var(--border))] object-contain"
        />
      );
    }
    return null;
  }

  // step-start / source 等:本层不专门渲染,返回 null。
  return null;
}
