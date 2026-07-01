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
import { useI18n } from "../i18n/index.js";

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
  /**
   * 外部 textarea ref:与内部(自动增高用)ref 合并,供装配层读取真实光标 / 做 caret 测量
   * 与选区复位(completion-cursor-anchor)。
   */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * 光标(selectionStart)变化上报:输入、点击、方向键移动、选区变化、聚焦时触发,使装配层
   * 能用真实光标位置驱动补全(completion-cursor-anchor R1)。
   */
  readonly onSelectionChange?: (selectionStart: number) => void;
  /**
   * bang shell 命令视觉提示(spec bang-shell-command,Req 6.x)。
   * `"bash"`:输入以 `!` 开头;`"bash-no-context"`:以 `!!` 开头(输出不进上下文)。
   * 命中时换强调边框、显示 BASH 徽标并切换占位符;`undefined` 为常规外观。
   * 仅在前端体验开关开启时由装配层传入(关闭时恒为 undefined)。
   */
  readonly mode?: "bash" | "bash-no-context";
}

/** value 去除首尾空白后是否为空(用于空提交判定,Req 1.3)。 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  rows = 2,
  maxRows = 10,
  textareaLabel,
  toolbar,
  leftSlot,
  rightSlot,
  children,
  className,
  textareaClassName,
  suppressEnterSubmit = false,
  ghostSuffix,
  onAcceptGhost,
  inputRef,
  onSelectionChange,
  mode,
}: PromptInputProps): React.JSX.Element {
  const t = useI18n();
  const canSubmit = !disabled && !isBlank(value);
  const effectiveTextareaLabel = textareaLabel ?? t("promptInput.textareaLabel");
  // bash 模式时占位符切换为 shell 提示(Req 6.1)。
  const effectivePlaceholder =
    mode !== undefined
      ? t("promptInput.bashPlaceholder")
      : (placeholder ?? t("promptInput.placeholder"));
  const hasGhost =
    ghostSuffix !== undefined &&
    ghostSuffix.length > 0 &&
    onAcceptGhost !== undefined;

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // 合并内部 ref(自动增高需要)与外部 inputRef(装配层读光标/做 caret 测量)。
  const setTextareaRef = React.useCallback(
    (el: HTMLTextAreaElement | null): void => {
      textareaRef.current = el;
      if (inputRef !== undefined) inputRef.current = el;
    },
    [inputRef],
  );

  // 上报当前光标(selectionStart);输入/点击/方向键/选区/聚焦时调用。
  const onSelectionChangeRef = React.useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const reportSelection = React.useCallback((): void => {
    const el = textareaRef.current;
    if (el === null) return;
    onSelectionChangeRef.current?.(el.selectionStart);
  }, []);

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
    // Tab:接受 inlineComplete ghost 后缀(R20)。命令/补全浮层捕获中时(suppressEnterSubmit)
    // 让位给浮层——Tab 改由浮层确认选中项,避免与 ghost 接受双触发(完全清空条件外的自定义触发符)。
    if (event.key === "Tab" && hasGhost && !suppressEnterSubmit) {
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
        // bash 模式:强调边框 + ring(Req 6.1/6.2);退出后恢复常规(Req 6.3)。
        mode !== undefined &&
          "border-[hsl(var(--ring))] ring-1 ring-[hsl(var(--ring))]",
        className,
      )}
      data-pi-prompt-input
      {...(mode !== undefined ? { "data-pi-bash-mode": mode } : {})}
    >
      {mode !== undefined ? (
        <div
          className="flex items-center gap-1 text-xs font-mono font-semibold text-[hsl(var(--ring))]"
          data-pi-bash-badge
        >
          <span className="rounded bg-[hsl(var(--primary))] px-1.5 py-0.5 text-[hsl(var(--primary-foreground))]">
            {t("promptInput.bashBadge")}
          </span>
          {mode === "bash-no-context" ? (
            <span className="text-[hsl(var(--muted-foreground))]">{t("promptInput.bashNoContext")}</span>
          ) : null}
        </div>
      ) : null}

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
            ref={setTextareaRef}
            aria-label={effectiveTextareaLabel}
            value={value}
            disabled={disabled}
            rows={rows}
            placeholder={effectivePlaceholder}
            onChange={(e) => {
              onChange(e.target.value);
              // 值变即上报光标,保证 value 与 cursor 同帧一致(供补全提取)。
              onSelectionChangeRef.current?.(e.target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={reportSelection}
            onClick={reportSelection}
            onSelect={reportSelection}
            onFocus={reportSelection}
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
