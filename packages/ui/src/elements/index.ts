/**
 * @pi-web/ui elements — 无状态 AI Elements 等价元件层导出。
 *
 * 本层组件不持有 pi 接线逻辑,仅负责展示与本地交互,由装配层(PiChat)组合。
 */

export { Conversation, type ConversationProps } from "./conversation.js";
export { Message, type MessageProps } from "./message.js";
export {
  useAutoScroll,
  type UseAutoScrollOptions,
  type UseAutoScrollResult,
} from "./use-auto-scroll.js";
export { SubmitButton, type SubmitButtonProps } from "./submit-button.js";
export { PromptInput, type PromptInputProps } from "./prompt-input.js";
export {
  Attachments,
  type AttachmentsProps,
  type AttachmentsVariant,
  type MediaCategory,
  getMediaCategory,
  getAttachmentLabel,
} from "./attachments.js";
export { ModelSelector, type ModelSelectorProps } from "./model-selector.js";
export { SpeechInput, type SpeechInputProps } from "./speech-input.js";
export {
  WebSearchToggle,
  type WebSearchToggleProps,
} from "./web-search-toggle.js";
export { Sources, type SourcesProps, type Source } from "./sources.js";
export { Suggestions, type SuggestionsProps } from "./suggestions.js";
export {
  Notifications,
  type NotificationsProps,
} from "./notifications.js";
export { ChatError, type ChatErrorProps } from "./chat-error.js";
export { StatusBar, type StatusBarProps } from "./status-bar.js";
export { Widgets, type WidgetsProps, type WidgetItem } from "./widgets.js";
export {
  PiInteraction,
  type PiInteractionProps,
} from "./pi-interaction.js";

// 可覆盖元件位(pi-chat-customization):抽出/新增的细粒度组件位。
export {
  MessageActions,
  type MessageActionsProps,
} from "./message-actions.js";
export { Markdown, type MarkdownProps } from "./markdown.js";
export {
  ConversationBackground,
  type ConversationBackgroundProps,
} from "./conversation-background.js";
export { EmptyState, type EmptyStateProps } from "./empty-state.js";
export { StarterCard, type StarterCardProps } from "./starter-card.js";
export {
  SessionListPanel,
  type SessionListPanelProps,
} from "./session-list-panel.js";
