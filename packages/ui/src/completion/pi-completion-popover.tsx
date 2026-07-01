/**
 * PiCompletionPopover — core 触发符补全浮层(completion-provider-framework)。
 *
 * 平台级:对活跃触发符(由服务端通用端点驱动)弹出按 kind 分区的候选,选中插入带类型回环的
 * token(如 `@file:src/a.ts `)。与 agent 专属的 webext mention 浮层并存,由装配层按"core
 * 已接管触发符"让位。失败/空安全收敛(不渲染)。
 *
 * completion-cursor-anchor:
 *  - 浮层按活跃触发符处的 caret 像素坐标 fixed 锚定(默认光标下方,空间不足翻转上方)。
 *  - 键盘导航 ↑↓/Enter|Tab/Esc(复用 PiCommandPalette 的 document keydown 捕获范式),跨 kind
 *    分组维护单一线性高亮;Esc 经 dismiss 关闭(不清空输入),token 变化重新可弹。
 *  - 选中后按 accept() 的 nextCursor 经 setSelectionRange 复位光标(支持文本中间插入)。
 */
import * as React from "react";
import type { CompletionItem } from "@blksails/pi-web-protocol";
import { cn } from "../lib/cn.js";
import {
  useCompletion,
  type CompletionClient,
} from "./use-completion.js";
import { flattenSelectable, isSelectable, nextActiveIndex } from "./nav.js";
import { useCaretAnchor } from "./use-caret-anchor.js";
import { useI18n } from "../i18n/index.js";

export interface PiCompletionPopoverProps {
  readonly value: string;
  readonly cursor: number;
  readonly onChange: (next: string) => void;
  readonly client?: CompletionClient;
  readonly sessionId?: string;
  /** 底层 textarea ref:用于 caret 像素测量与选中后光标复位(completion-cursor-anchor)。 */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly onCaptureChange?: (capturing: boolean) => void;
  /** 让出的触发符(由别的浮层独占,如 "/" 归 PiCommandPalette)。 */
  readonly excludeTriggers?: readonly string[];
  readonly className?: string;
}

export function PiCompletionPopover({
  value,
  cursor,
  onChange,
  client,
  sessionId,
  inputRef,
  onCaptureChange,
  excludeTriggers,
  className,
}: PiCompletionPopoverProps): React.JSX.Element | null {
  const t = useI18n();
  const { open, groups, activeToken, accept } = useCompletion({
    client,
    sessionId,
    value,
    cursor,
    ...(excludeTriggers !== undefined ? { excludeTriggers } : {}),
  });
  const listId = React.useId();

  // 活跃 token 的稳定键:trigger+起点+查询;Esc dismiss 以此为粒度,token 变化即解除。
  const tokenKey =
    activeToken === null
      ? ""
      : `${activeToken.trigger}:${activeToken.start}:${activeToken.query}`;

  const [dismissedKey, setDismissedKey] = React.useState<string>("");
  const shouldRender = open && dismissedKey !== tokenKey;

  // 线性可选序列(跨组拍平、过滤占位项)与单一高亮索引。
  const selectable = React.useMemo(() => flattenSelectable(groups), [groups]);
  const [active, setActive] = React.useState<number>(0);
  // 查询/分组刷新时把高亮重置到首个可选(Req 3.6)。
  React.useEffect(() => {
    setActive(0);
  }, [tokenKey, groups]);
  const activeClamped =
    selectable.length === 0
      ? 0
      : Math.min(active, selectable.length - 1);

  // 捕获信号:浮层可见时让上层(prompt-input)不把 Enter 当发送。
  const onCaptureRef = React.useRef(onCaptureChange);
  onCaptureRef.current = onCaptureChange;
  const prevCaptureRef = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    if (prevCaptureRef.current !== shouldRender) {
      prevCaptureRef.current = shouldRender;
      onCaptureRef.current?.(shouldRender);
    }
  }, [shouldRender]);

  // 选中:替换 token 区间、写回输入,并把光标复位到插入串之后(Req 4)。
  const select = React.useCallback(
    (item: CompletionItem): void => {
      if (!isSelectable(item)) return; // 占位项不可选
      const { nextValue, nextCursor } = accept(item, value);
      onChange(nextValue);
      // onChange 引发重渲染后再复位选区并保持焦点(经 PromptInput 的 onSelect 上报新光标)。
      const el = inputRef?.current ?? null;
      if (el !== null) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        });
      }
    },
    [accept, value, onChange, inputRef],
  );

  // 键盘导航:浮层可见时即便焦点在 textarea 也捕获 ↑↓/Enter/Esc(复用 command-palette 范式)。
  const handleKey = React.useCallback(
    (e: KeyboardEvent): void => {
      if (selectable.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          setDismissedKey(tokenKey);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => nextActiveIndex(i, selectable.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => nextActiveIndex(i, selectable.length, -1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = selectable[Math.min(activeClamped, selectable.length - 1)];
        if (item !== undefined) select(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDismissedKey(tokenKey);
      }
    },
    [selectable, activeClamped, select, tokenKey],
  );
  React.useEffect(() => {
    if (!shouldRender) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [shouldRender, handleKey]);

  // caret 锚定定位(与 / 命令面板共用):按活跃 token 起点锚定,value/cursor 变化重定位。
  const positionStyle = useCaretAnchor({
    inputRef,
    offset: activeToken?.start ?? 0,
    active: shouldRender,
    recomputeOn: `${value}:${cursor}`,
  });

  if (!shouldRender) return null;

  // 渲染:为各候选分配跨组的全局可选序号,驱动高亮与 aria-activedescendant。
  let selIndex = -1;
  const activeId = `${listId}-opt-${activeClamped}`;

  return (
    <div
      className={cn(
        "z-50 min-w-[16rem] max-w-[24rem] rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      style={positionStyle ?? undefined}
      data-pi-completion-popover
    >
      <ul
        role="listbox"
        id={listId}
        aria-label={t("completion.aria.completions")}
        aria-activedescendant={activeId}
        tabIndex={-1}
        className="max-h-64 overflow-y-auto p-1"
      >
        {groups.map((group) => (
          <li key={group.kind} data-pi-completion-group={group.kind}>
            <div className="px-2 py-1 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {group.kind}
            </div>
            <ul role="group">
              {group.items.map((item) => {
                const selectableItem = isSelectable(item);
                const gi = selectableItem ? ++selIndex : -1;
                const isActive = selectableItem && gi === activeClamped;
                return (
                  <li
                    key={`${item.kind}:${item.id}`}
                    {...(gi >= 0 ? { id: `${listId}-opt-${gi}` } : {})}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={
                      selectableItem ? () => setActive(gi) : undefined
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(item)}
                    className={cn(
                      "rounded-sm px-2 py-1.5 text-sm",
                      selectableItem
                        ? "cursor-pointer"
                        : "cursor-default opacity-60",
                      isActive
                        ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                        : selectableItem
                          ? "hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
                          : "",
                    )}
                    data-pi-completion-item={item.id}
                    data-kind={item.kind}
                    {...(isActive ? { "data-active": "true" } : {})}
                  >
                    {item.label}
                    {item.detail !== undefined ? (
                      <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">
                        {item.detail}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
