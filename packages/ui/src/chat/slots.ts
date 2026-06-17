/**
 * PiChat 插槽类型(header / footer / sidebar / messageActions)。
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
}
