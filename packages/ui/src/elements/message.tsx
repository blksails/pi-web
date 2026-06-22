/**
 * Message — 对话消息(用户气泡 / 助手裸文本 + 头像 + 操作行)+ 分支切换控件
 * (Req 8.1/8.3/8.4、11.4)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅负责消息布局、本地分支控件触发与本地操作
 * (复制 / 反馈),由装配层(PiChat)注入 `children`(part 渲染结果)与分支接线。
 * - `role === "user"`:右对齐浅灰圆角气泡。
 * - 其它(assistant 等):左对齐,头像(默认 Sparkles 方块)+ 无气泡裸文本,
 *   下方渲染操作行(复制 / 赞 / 踩)。
 * - 可选 `branch`(来自 useBranches.branchOf,`{ entryId, index, total }`):仅当
 *   `branch.total > 1` 时渲染 "‹ N/M ›" 分支控件(Req 8.1);点击调 `onPrev`/`onNext`
 *   (Req 8.1/8.3);边界处禁用对应方向。无 branch / 单版本 / 不可用 → 不渲染(Req 8.4)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色;无障碍:头像图标 aria-hidden,
 * 分支与操作按钮均带 aria-label(Req 11.4)。
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { BranchInfo } from "@pi-web/react";
import {
  MessageActions as DefaultMessageActions,
  type MessageActionsProps,
} from "./message-actions.js";
import { cn } from "../lib/cn.js";

export interface MessageProps {
  /** 消息角色;"user" 右对齐气泡,其它(assistant 等)左对齐裸文本 + 头像。 */
  readonly role: string;
  /** 消息内容(由装配层注入 part 渲染结果)。 */
  readonly children?: React.ReactNode;
  /** 自定义头像(助手侧);缺省用默认 Sparkles 方块。 */
  readonly avatar?: React.ReactNode;
  /** 用于"复制"按钮的纯文本;提供时复制按钮可用(助手侧)。 */
  readonly copyText?: string;
  /** 是否展示操作行(复制/赞/踩);默认非用户消息展示。 */
  readonly showActions?: boolean;
  /** 反馈回调(赞/踩);可选,无后端时仅本地切换视觉态。 */
  readonly onFeedback?: (value: "up" | "down") => void;
  /** 操作区元件实现;默认内置复制/赞/踩。由装配层注入覆盖(components.MessageActions)。 */
  readonly messageActions?: React.ComponentType<MessageActionsProps>;
  /** 分支信息(来自 useBranches.branchOf);total<=1 或缺省时不渲染分支控件(Req 8.4)。 */
  readonly branch?: BranchInfo;
  /** 切换到上一个版本(Req 8.1/8.3)。 */
  readonly onPrev?: () => void;
  /** 切换到下一个版本(Req 8.1/8.3)。 */
  readonly onNext?: () => void;
  readonly className?: string;
}

function BranchControl({
  branch,
  onPrev,
  onNext,
}: {
  branch: BranchInfo;
  onPrev?: () => void;
  onNext?: () => void;
}): React.JSX.Element {
  const atFirst = branch.index <= 0;
  const atLast = branch.index >= branch.total - 1;
  return (
    <div
      className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]"
      data-pi-branch
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={atFirst}
        aria-label="上一个版本"
        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius)] hover:bg-[hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50"
        data-pi-branch-prev
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span data-pi-branch-indicator>
        第 {branch.index + 1} / 共 {branch.total}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={atLast}
        aria-label="下一个版本"
        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius)] hover:bg-[hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50"
        data-pi-branch-next
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Message({
  role,
  children,
  avatar,
  copyText,
  showActions,
  onFeedback,
  messageActions,
  branch,
  onPrev,
  onNext,
  className,
}: MessageProps): React.JSX.Element {
  const isUser = role === "user";
  // 仅当存在多版本时渲染分支控件(Req 8.1);无 branch / 单版本 / 不可用 → 隐藏(Req 8.4)。
  const showBranch = branch !== undefined && branch.total > 1;
  // 默认非用户消息展示操作行;可由 showActions 覆盖。
  const withActions = showActions ?? !isUser;
  // 操作区元件:默认内置;可由装配层注入覆盖(components.MessageActions)。
  const Actions = messageActions ?? DefaultMessageActions;

  if (isUser) {
    // 用户:右对齐浅灰圆角气泡。
    return (
      <div
        className={cn("flex flex-col items-end gap-1", className)}
        data-pi-message
        data-pi-message-role={role}
      >
        <div
          className="max-w-[88%] rounded-2xl bg-[hsl(var(--muted))] px-3.5 py-2.5 text-sm text-[hsl(var(--foreground))] sm:max-w-[80%] sm:px-4"
          data-pi-message-content
        >
          {children}
        </div>
        {showBranch ? (
          <BranchControl
            branch={branch}
            {...(onPrev ? { onPrev } : {})}
            {...(onNext ? { onNext } : {})}
          />
        ) : null}
      </div>
    );
  }

  // 助手等:左对齐,头像 + 无气泡裸文本 + 操作行 + 分支控件。
  return (
    <div
      className={cn("flex items-start gap-3", className)}
      data-pi-message
      data-pi-message-role={role}
    >
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
        data-pi-message-avatar
        aria-hidden="true"
      >
        {avatar ?? <Sparkles className="h-4 w-4" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className="text-sm leading-relaxed text-[hsl(var(--foreground))]"
          data-pi-message-content
        >
          {children}
        </div>
        {withActions || showBranch ? (
          <div className="flex items-center gap-2">
            {withActions ? (
              <Actions
                {...(copyText !== undefined ? { copyText } : {})}
                {...(onFeedback ? { onFeedback } : {})}
              />
            ) : null}
            {showBranch ? (
              <BranchControl
                branch={branch}
                {...(onPrev ? { onPrev } : {})}
                {...(onNext ? { onNext } : {})}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
