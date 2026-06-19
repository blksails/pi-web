/**
 * PiChat 插槽类型(header / footer / sidebar / messageActions / background / empty)。
 *
 * 未提供的插槽由 `<PiChat>` 用合理默认或不渲染该区域(不报错)。
 */
import type { ReactNode } from "react";
import type { UIMessage } from "ai";

export interface PiChatSlots {
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly sidebar?: ReactNode;
  /** 每条消息的操作区;接收消息以定制(经 AI Elements Actions 等价区)。 */
  readonly messageActions?: (message: UIMessage) => ReactNode;
  /** 对话背景层;渲染于消息层之下、不拦截交互。优先于 components.ConversationBackground。 */
  readonly background?: ReactNode;
  /** 空态/欢迎页整块替换;仅会话无消息时渲染。优先于 components.EmptyState。 */
  readonly empty?: ReactNode;
}
