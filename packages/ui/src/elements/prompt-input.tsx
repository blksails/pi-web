/**
 * PromptInput — 无状态的富输入外壳。
 *
 * 提供一个受控多行文本框与若干子控件插槽位;真正的附件/模型/语音/发送等子控件由装配层
 * (PiChat)注入,本组件只负责展示、本地键盘交互与插槽布局:
 *  - textarea:Enter 提交(调 onSubmit 并阻止默认换行)(Req 1.2);Shift+Enter 换行不提交
 *    (Req 1.4);value 为空或仅空白时不触发提交(Req 1.3)。
 *  - 受控 props:value/onChange/onSubmit/placeholder/disabled;placeholder 等可由调用方覆盖
 *    默认值(Req 1.5)。
 *  - 子控件插槽:toolbar(动作栏)/ leftSlot / rightSlot / children,供装配层注入附件菜单、
 *    模型选择器、语音、联网开关、发送按钮等(Req 1.1)。
 *
 * 本组件不持有任何 pi 接线逻辑。主题经 shadcn CSS 变量(cn),无硬编码颜色(Req 11.5);
 * textarea 始终带 `aria-label` 以满足无障碍(Req 11.4)。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";

/** SSR 安全的 layout effect:服务端退化为 useEffect,避免 useLayoutEffect 警告。 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface PromptInputProps {
  /** 受控文本值。 */
  readonly value: string;
  /** 文本变化回调,接收新的完整文本。 */
  readonly onChange: (value: string) => void;
  /** 提交回调(Enter 或外部发送按钮触发);value 为空/仅空白或 disabled 时不会被调用。 */
  readonly onSubmit: () => void;
  /** 占位符,默认中文;可由调用方覆盖(Req 1.5)。 */
  readonly placeholder?: string;
  /** 是否禁用输入与提交。 */
  readonly disabled?: boolean;
  /** textarea 初始/最小行数,默认 2。内容增多时自动增高,至多 maxRows 行。 */
  readonly rows?: number;
  /** textarea 最大行数,内容超过后固定高度并内部滚动,默认 10。 */
  readonly maxRows?: number;
  /** textarea 的无障碍标签,默认中文"消息输入"。 */
  readonly textareaLabel?: string;
  /** 动作栏插槽(通常承载附件/模型/语音/联网开关/发送按钮)。 */
  readonly toolbar?: React.ReactNode;
  /** 文本框左侧插槽。 */
  readonly leftSlot?: React.ReactNode;
  /** 文本框右侧插槽。 */
  readonly rightSlot?: React.ReactNode;
  /** 额外内容插槽(如附件 chips 区),渲染于文本行上方。 */
  readonly children?: React.ReactNode;
  readonly className?: string;
  /** textarea 区域的额外 className。 */
  readonly textareaClassName?: string;
  /**
   * 命令模式激活时禁用 textarea 的 Enter 提交(Enter 让位给命令浮层选中)。默认 false。
   * 为真时 Enter(非 Shift)`preventDefault` 且不调用 `onSubmit`;Shift+Enter 仍换行不提交。
   * (Req 4.1/4.4)
   */
  readonly suppressEnterSubmit?: boolean;
  /** inlineComplete 的灰字 ghost 后缀(Tier3 贡献点 R20);Tab 接受。 */
  readonly ghostSuffix?: string;
  /** Tab 接受 ghost 后缀时回调(通常把 value 拼上 ghostSuffix)。 */
  readonly onAcceptGhost?: () => void;
}

/** value 去除首尾空白后是否为空(用于空提交判定,Req 1.3)。 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "输入消息…",
  disabled = false,
  rows = 2,
  maxRows = 10,
  textareaLabel = "消息输入",
  toolbar,
  leftSlot,
  rightSlot,
  children,
  className,
  textareaClassName,
  suppressEnterSubmit = false,
  ghostSuffix,
  onAcceptGhost,
}: PromptInputProps): React.JSX.Element {
  const canSubmit = !disabled && !isBlank(value);
  const hasGhost =
    ghostSuffix !== undefined &&
    ghostSuffix.length > 0 &&
    onAcceptGhost !== undefined;

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // 自动增高:把 textarea 高度贴合内容,夹在 [rows, maxRows] 行之间;达 maxRows 后固定
  // 高度并内部滚动(overflowY auto,配 pi-scrollbar-thin 细滚动条)。行高/内边距经
  // getComputedStyle 实测,故 textareaClassName 覆盖字号(如 text-base)也能算准。
  const resize = React.useCallback((): void => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto"; // 先归零,使 scrollHeight 反映真实内容高度(支持收缩回弹)。
    const cs = window.getComputedStyle(el);
    const lineHeight =
      parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const minH = lineHeight * Math.max(1, rows) + padV;
    const maxH = lineHeight * Math.max(rows, maxRows) + padV;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minH), maxH)}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }, [rows, maxRows]);

  // value 变化(含程序化填充/清空)与挂载时同步高度;窗口尺寸变化致换行改变时重算。
  useIsomorphicLayoutEffect(() => {
    resize();
  }, [value, resize]);
  React.useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    // Tab:接受 inlineComplete ghost 后缀(R20)。
    if (event.key === "Tab" && hasGhost) {
      event.preventDefault();
      onAcceptGhost();
      return;
    }
    // Shift+Enter:换行,不提交(Req 1.4)——交由浏览器默认行为插入换行。
    if (event.key !== "Enter" || event.shiftKey) return;
    // 命令模式激活时:阻止默认换行并让位给命令浮层(Req 4.1);不调用 onSubmit。
    if (suppressEnterSubmit) {
      event.preventDefault();
      return;
    }
    // Enter:阻止默认换行并提交(Req 1.2);空/仅空白或禁用时不提交(Req 1.3)。
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2",
        className,
      )}
      data-pi-prompt-input
    >
      {children !== undefined ? (
        <div data-pi-prompt-input-extra>{children}</div>
      ) : null}

      <div className="flex items-end gap-2">
        {leftSlot !== undefined ? (
          <div className="shrink-0" data-pi-prompt-input-left>
            {leftSlot}
          </div>
        ) : null}

        <div className="relative min-w-0 flex-1">
          {hasGhost ? (
            // inlineComplete ghost:与 textarea 同字号/内边距,value 透明占位 + 后缀灰字。
            <div
              aria-hidden="true"
              data-pi-inline-complete={ghostSuffix}
              className={cn(
                "pointer-events-none absolute inset-0 whitespace-pre-wrap break-words p-1 text-sm",
                textareaClassName,
              )}
            >
              <span className="invisible">{value}</span>
              <span className="text-[hsl(var(--muted-foreground))]">
                {ghostSuffix}
              </span>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            aria-label={textareaLabel}
            value={value}
            disabled={disabled}
            rows={rows}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "pi-scrollbar-thin relative min-w-0 w-full resize-none bg-transparent p-1 text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              textareaClassName,
            )}
            data-pi-input-textarea
          />
        </div>

        {rightSlot !== undefined ? (
          <div className="shrink-0" data-pi-prompt-input-right>
            {rightSlot}
          </div>
        ) : null}
      </div>

      {toolbar !== undefined ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-pi-prompt-input-toolbar
        >
          {toolbar}
        </div>
      ) : null}
    </div>
  );
}
