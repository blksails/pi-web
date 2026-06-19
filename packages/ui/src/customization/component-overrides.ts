/**
 * 组件覆盖映射与优先级解析(pi-chat-customization 任务 1.2)。
 *
 * 细粒度覆盖的本质:用相同 props 契约替换某个组件位的实现,复用其余装配与数据接线
 * (Req 5.1)。每个覆盖位的 props 复用对应元件的公开类型(契约不变)。
 *
 * 解析优先级 `slots(整块) > components(细粒度) > 默认` 中,整块 slot 命中由装配层
 * (PiChat)在调用本模块前直接处理;本模块负责 components 覆盖与默认之间的解析,并支持
 * 以 `null` 显式移除可移除控件(Req 5.4、9.x)。
 */
import type { ComponentType } from "react";
import type {
  SubmitButtonProps,
  AttachmentsProps,
  ModelSelectorProps,
  SpeechInputProps,
  WebSearchToggleProps,
  MessageProps,
  MessageActionsProps,
  MarkdownProps,
  EmptyStateProps,
  StarterCardProps,
  ConversationBackgroundProps,
} from "../elements/index.js";
import type { PiReasoningProps } from "../parts/pi-reasoning.js";

export type MessageRole = "user" | "assistant" | "system";

/** 集成方提供的细粒度组件覆盖表。可移除控件位接受 `null` 表示移除(Req 5.4)。 */
export interface ComponentOverrides {
  readonly SubmitButton?: ComponentType<SubmitButtonProps>;
  readonly Attachments?: ComponentType<AttachmentsProps> | null;
  readonly ModelSelector?: ComponentType<ModelSelectorProps> | null;
  readonly SpeechInput?: ComponentType<SpeechInputProps> | null;
  readonly WebSearchToggle?: ComponentType<WebSearchToggleProps> | null;
  /** 按角色替换整条消息渲染;未提供的角色回退默认 Message(Req 5.3)。 */
  readonly Message?: Partial<Record<MessageRole, ComponentType<MessageProps>>>;
  readonly MessageActions?: ComponentType<MessageActionsProps>;
  readonly Markdown?: ComponentType<MarkdownProps>;
  /** 思考块(reasoning part)外观;默认 PiReasoning,可整体替换(参考 ai-sdk Reasoning)。 */
  readonly Reasoning?: ComponentType<PiReasoningProps>;
  readonly EmptyState?: ComponentType<EmptyStateProps>;
  readonly StarterCard?: ComponentType<StarterCardProps>;
  readonly ConversationBackground?: ComponentType<ConversationBackgroundProps>;
}

/**
 * 解析某组件位的最终实现(components 覆盖 vs 默认)。
 *
 * - `override === null` → 返回 `null`(显式移除,仅可移除控件位合法)。
 * - `override` 为组件 → 返回该覆盖实现。
 * - `override === undefined` → 返回 `Default`(Req 5.5)。
 *
 * 整块 slot 优先级由装配层在调用本函数前判定(Req 9.1)。
 */
export function resolveComponent<P>(
  override: ComponentType<P> | null | undefined,
  Default: ComponentType<P>,
): ComponentType<P> | null {
  if (override === null) return null;
  return override ?? Default;
}
