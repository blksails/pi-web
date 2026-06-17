/**
 * @pi-web/ui elements — 无状态 AI Elements 等价元件层导出。
 *
 * 本层组件不持有 pi 接线逻辑,仅负责展示与本地交互,由装配层(PiChatPro)组合。
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
export { Attachments, type AttachmentsProps } from "./attachments.js";
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
