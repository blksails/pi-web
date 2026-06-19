/**
 * ConversationBackground — 对话背景层(pi-chat-customization 任务 2.2)。
 *
 * 渲染于消息层之下、不拦截交互的背景位(Req 4.1)。默认实现为"无背景"(返回 null),
 * 保持向后兼容(现状无背景层,Req 1.1);由 components.ConversationBackground 或
 * slots.background 覆盖时显示自定义背景。
 */
import type * as React from "react";

export interface ConversationBackgroundProps {
  readonly className?: string;
}

export function ConversationBackground(
  _props: ConversationBackgroundProps,
): React.JSX.Element | null {
  return null;
}
