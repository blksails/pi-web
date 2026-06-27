/**
 * PiMentionPopover — "@" mention 补全(Tier3 贡献点,经 ui-rpc 回 agent 取候选)。
 *
 * 当输入中光标末尾出现 `trigger`(默认 "@")+ 连续非空白时进入 mention 模式:调扩展
 * `contributions.mention.query(q, rpc)` 取候选;点击候选把 `@<query>` 替换为 `@<label> `。
 * 与 slash 浮层(PiCommandPalette)逻辑隔离(各自触发字符)。缺贡献点/客户端时不渲染。
 */
import * as React from "react";
import type { UiRpcClient } from "@blksails/pi-web-kit";
import { cn } from "../lib/cn.js";
import { useCaretAnchor } from "../completion/use-caret-anchor.js";

export interface MentionItem {
  readonly id: string;
  readonly label: string;
}

export interface MentionContribution {
  /** 触发字符,默认 "@"。 */
  readonly trigger?: string;
  query(q: string, rpc: UiRpcClient): Promise<readonly MentionItem[]>;
}

export interface PiMentionPopoverProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly contribution?: MentionContribution;
  readonly uiRpc?: UiRpcClient;
  readonly onCaptureChange?: (capturing: boolean) => void;
  /** 底层 textarea ref:把浮层锚定到 mention 触发符光标(与 @/`/` 一致)。 */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly className?: string;
}

/** 取输入末尾的 `trigger`+word(其后无空白)作为 mention 查询;无则 null。 */
function matchMention(
  value: string,
  trigger: string,
): { query: string; start: number } | null {
  const idx = value.lastIndexOf(trigger);
  if (idx < 0) return null;
  const after = value.slice(idx + trigger.length);
  if (/\s/.test(after)) return null;
  return { query: after, start: idx };
}

export function PiMentionPopover({
  value,
  onChange,
  contribution,
  uiRpc,
  onCaptureChange,
  inputRef,
  className,
}: PiMentionPopoverProps): React.JSX.Element | null {
  const trigger = contribution?.trigger ?? "@";
  const match =
    contribution !== undefined && uiRpc !== undefined
      ? matchMention(value, trigger)
      : null;
  const open = match !== null;
  const query = match?.query ?? "";

  const [items, setItems] = React.useState<readonly MentionItem[]>([]);
  React.useEffect(() => {
    if (!open || contribution === undefined || uiRpc === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void contribution
      .query(query, uiRpc)
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, contribution, uiRpc]);

  const capturing = open && items.length > 0;
  const onCaptureChangeRef = React.useRef(onCaptureChange);
  onCaptureChangeRef.current = onCaptureChange;
  const prevRef = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    if (prevRef.current !== capturing) {
      prevRef.current = capturing;
      onCaptureChangeRef.current?.(capturing);
    }
  }, [capturing]);

  // caret 锚定(与 @/`/` 一致):锚定到 mention 触发符起点。
  const positionStyle = useCaretAnchor({
    inputRef,
    offset: match?.start ?? 0,
    active: open && match !== null && items.length > 0,
    recomputeOn: value,
  });

  if (!open || match === null || items.length === 0) return null;

  const select = (item: MentionItem): void => {
    onChange(`${value.slice(0, match.start)}${trigger}${item.label} `);
  };

  return (
    <div
      className={cn(
        "z-40 min-w-[16rem] max-w-[24rem] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      style={positionStyle ?? undefined}
      data-pi-mention-popover
    >
      <ul
        role="listbox"
        aria-label="Mentions"
        tabIndex={-1}
        className="max-h-64 overflow-y-auto p-1"
      >
        {items.map((item) => (
          <li
            key={item.id}
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => select(item)}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
            data-pi-mention-item={item.id}
          >
            {trigger}
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
