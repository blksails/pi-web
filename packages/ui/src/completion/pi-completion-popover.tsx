/**
 * PiCompletionPopover — core 触发符补全浮层(completion-provider-framework)。
 *
 * 平台级:对活跃触发符(由服务端通用端点驱动)弹出按 kind 分区的候选,点选插入带
 * 类型回环的 token(如 `@file:src/a.ts `)。与 agent 专属的 webext mention 浮层并存,
 * 由装配层按"core 已接管触发符"让位。失败/空安全收敛(不渲染)。
 */
import * as React from "react";
import type { CompletionItem } from "@pi-web/protocol";
import { cn } from "../lib/cn.js";
import {
  useCompletion,
  type CompletionClient,
} from "./use-completion.js";

export interface PiCompletionPopoverProps {
  readonly value: string;
  readonly cursor: number;
  readonly onChange: (next: string) => void;
  readonly client?: CompletionClient;
  readonly sessionId?: string;
  readonly onCaptureChange?: (capturing: boolean) => void;
  readonly className?: string;
}

export function PiCompletionPopover({
  value,
  cursor,
  onChange,
  client,
  sessionId,
  onCaptureChange,
  className,
}: PiCompletionPopoverProps): React.JSX.Element | null {
  const { open, groups, accept } = useCompletion({
    client,
    sessionId,
    value,
    cursor,
  });

  // 捕获信号:浮层开时让上层(prompt-input)不把 Enter 当发送。
  const onCaptureRef = React.useRef(onCaptureChange);
  onCaptureRef.current = onCaptureChange;
  const prevRef = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    if (prevRef.current !== open) {
      prevRef.current = open;
      onCaptureRef.current?.(open);
    }
  }, [open]);

  if (!open) return null;

  const select = (item: CompletionItem): void => {
    if (item.insertText === "") return; // 占位项(如截断标示)不可选
    const { nextValue } = accept(item, value);
    onChange(nextValue);
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      data-pi-completion-popover
    >
      <ul
        role="listbox"
        aria-label="Completions"
        tabIndex={-1}
        className="max-h-64 overflow-y-auto p-1"
      >
        {groups.map((group) => (
          <li key={group.kind} data-pi-completion-group={group.kind}>
            <div className="px-2 py-1 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {group.kind}
            </div>
            <ul role="group">
              {group.items.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(item)}
                  className="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
                  data-pi-completion-item={item.id}
                  data-kind={item.kind}
                >
                  {item.label}
                  {item.detail !== undefined ? (
                    <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">
                      {item.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
