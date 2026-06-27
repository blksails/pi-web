/**
 * PiAutocompletePopover — 通用自动补全(Tier3 贡献点,经 ui-rpc 回 agent 取候选)。
 *
 * 非 slash/mention 模式且输入非空时进入补全:调扩展 `contributions.autocomplete.complete(ctx, rpc)`
 * 取候选;点击候选把输入替换为其 `insertText`。与 slash("/")/mention("@")浮层互斥让位。
 * 缺贡献点/客户端时不渲染;不抢占 Enter(仅建议,可继续发送)。
 */
import * as React from "react";
import type { UiRpcClient } from "@blksails/pi-web-kit";
import { cn } from "../lib/cn.js";
import { useCaretAnchor } from "../completion/use-caret-anchor.js";

export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
}

export interface AutocompleteContribution {
  complete(ctx: string, rpc: UiRpcClient): Promise<readonly CompletionItem[]>;
}

export interface PiAutocompletePopoverProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly contribution?: AutocompleteContribution;
  readonly uiRpc?: UiRpcClient;
  /** 当前光标(selectionStart),浮层锚定到此处;缺省退化为文本末尾。 */
  readonly cursor?: number;
  /** 底层 textarea ref:把浮层锚定到当前光标(与 @/`/` 一致)。 */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly className?: string;
}

/** 是否进入补全模式:非空、非 slash、末尾非 mention。 */
function autocompleteActive(value: string): boolean {
  if (value.trim().length === 0) return false;
  if (value.startsWith("/")) return false; // slash 模式让位
  if (/@\S*$/.test(value)) return false; // mention 模式让位
  return true;
}

export function PiAutocompletePopover({
  value,
  onChange,
  contribution,
  uiRpc,
  cursor,
  inputRef,
  className,
}: PiAutocompletePopoverProps): React.JSX.Element | null {
  const open =
    contribution !== undefined &&
    uiRpc !== undefined &&
    autocompleteActive(value);

  const [items, setItems] = React.useState<readonly CompletionItem[]>([]);
  React.useEffect(() => {
    if (!open || contribution === undefined || uiRpc === undefined) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void contribution
      .complete(value, uiRpc)
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, value, contribution, uiRpc]);

  // caret 锚定(与 @/`/` 一致):锚定到当前光标(缺省退化为文本末尾)。
  const positionStyle = useCaretAnchor({
    inputRef,
    offset: cursor ?? value.length,
    active: open && items.length > 0,
    recomputeOn: `${value}:${cursor ?? value.length}`,
  });

  if (!open || items.length === 0) return null;

  return (
    <div
      className={cn(
        "z-30 min-w-[16rem] max-w-[24rem] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      style={positionStyle ?? undefined}
      data-pi-autocomplete
    >
      <ul
        role="listbox"
        aria-label="Autocomplete"
        tabIndex={-1}
        className="max-h-64 overflow-y-auto p-1"
      >
        {items.map((item) => (
          <li
            key={item.label}
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(item.insertText)}
            className="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
            data-pi-autocomplete-item={item.label}
          >
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
