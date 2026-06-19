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
import {
  PiReasoning,
  type ReasoningPart,
  type PiReasoningProps,
} from "../parts/pi-reasoning.js";
import { PiToolPart, type ToolPart } from "../parts/pi-tool-part.js";
import {
  defaultRendererRegistry,
  type RendererRegistry,
} from "../registry/renderer-registry.js";

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

export function PartRenderer({
  part,
  message,
  registry = defaultRendererRegistry,
  markdown,
  reasoning,
}: PartRendererProps): React.JSX.Element | null {
  if (part.type === "text") {
    const Md = markdown ?? Response;
    return <Md>{part.text}</Md>;
  }

  if (part.type === "reasoning") {
    const Reasoning = reasoning ?? PiReasoning;
    return <Reasoning part={part as ReasoningPart} />;
  }

  if (isToolPart(part)) {
    const name = toolNameOf(part);
    const Custom = registry.resolveToolRenderer(name);
    if (Custom !== undefined) {
      return <Custom part={part} message={message} />;
    }
    return <PiToolPart part={part} message={message} />;
  }

  if (isDataPart(part)) {
    const Custom = registry.resolveDataPartRenderer(part.type);
    if (Custom !== undefined) {
      return <Custom part={part} message={message} />;
    }
    return <DefaultDataPart part={part} />;
  }

  // step-start / file / source 等:本层不专门渲染,返回 null。
  return null;
}
