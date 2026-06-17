/**
 * Message — 消息气泡 + 分支切换控件(Req 8.1/8.3/8.4、11.4)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅负责气泡布局与本地分支控件触发,由装配层
 * (PiChatPro)注入 `children`(part 渲染结果)与分支接线。
 * - `role`("user"|"assistant" 等)决定气泡对齐/样式。
 * - 可选 `branch`(来自 useBranches.branchOf,`{ entryId, index, total }`):仅当
 *   `branch.total > 1` 时渲染 "‹ N/M ›" 分支控件(上一个/下一个 + "第 N / 共 M")(Req 8.1)。
 *   点击调 `onPrev`/`onNext`(Req 8.1/8.3);边界处禁用对应方向按钮。
 * - 无 branch、total<=1 或分支不可用 → 不渲染分支控件(Req 8.4)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色;无障碍:分支按钮带 aria-label,
 * "第 N / 共 M" 文本可读(Req 11.4)。
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BranchInfo } from "@pi-web/react";
import { cn } from "../lib/cn.js";

export interface MessageProps {
  /** 消息角色;"user" 右对齐,其它(assistant 等)左对齐。 */
  readonly role: string;
  /** 消息内容(由装配层注入 part 渲染结果)。 */
  readonly children?: React.ReactNode;
  /** 分支信息(来自 useBranches.branchOf);total<=1 或缺省时不渲染分支控件(Req 8.4)。 */
  readonly branch?: BranchInfo;
  /** 切换到上一个版本(Req 8.1/8.3)。 */
  readonly onPrev?: () => void;
  /** 切换到下一个版本(Req 8.1/8.3)。 */
  readonly onNext?: () => void;
  readonly className?: string;
}

export function Message({
  role,
  children,
  branch,
  onPrev,
  onNext,
  className,
}: MessageProps): React.JSX.Element {
  const isUser = role === "user";
  // 仅当存在多版本时渲染分支控件(Req 8.1);无 branch / 单版本 / 不可用 → 隐藏(Req 8.4)。
  const showBranch = branch !== undefined && branch.total > 1;
  const atFirst = branch !== undefined && branch.index <= 0;
  const atLast = branch !== undefined && branch.index >= branch.total - 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
        className,
      )}
      data-pi-message
      data-pi-message-role={role}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-[var(--radius)] px-3 py-2 text-sm",
          isUser
            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        )}
        data-pi-message-content
      >
        {children}
      </div>

      {showBranch ? (
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
      ) : null}
    </div>
  );
}
