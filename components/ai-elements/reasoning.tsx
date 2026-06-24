"use client";

/**
 * AI Elements `Reasoning` 等价原语(自包含 vendoring)。
 *
 * 与 ai-elements `Reasoning/ReasoningTrigger/ReasoningContent` 同 API、同组合方式,
 * 但直接装配(React context + 受控折叠 + 流式自动展开/收起 + 思考时长),不拉 shadcn
 * registry、不引 radix——与本仓 `packages/ui/src/ui/response.tsx`(同样直接装配以避免
 * 网络拉取)的约定一致。
 *
 * 行为(对齐 ai-elements):
 *  - 流式开始(isStreaming=true)自动展开;结束后延迟自动收起一次(不覆盖用户手动)。
 *  - 触发器默认显示 "Thinking…" / "Thought for Ns";`aria-expanded` 反映状态。
 *  - 历史/冷恢复(进来即非流式)保持折叠,由用户点击展开。
 */
import * as React from "react";
import { cn } from "@blksails/ui";

/** 内联 Brain / ChevronDown 图标(lucide 路径),避免在 app 层引入 lucide-react 依赖。 */
function BrainIcon({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    </svg>
  );
}

function ChevronDownIcon({
  className,
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const AUTO_CLOSE_DELAY_MS = 1000;
const MS_IN_S = 1000;

interface ReasoningContextValue {
  readonly isStreaming: boolean;
  readonly isOpen: boolean;
  readonly setIsOpen: (open: boolean) => void;
  readonly durationSec: number;
}

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
  const ctx = React.useContext(ReasoningContext);
  if (ctx === null) {
    throw new Error("Reasoning components 必须在 <Reasoning> 内使用");
  }
  return ctx;
}

export interface ReasoningProps
  extends React.ComponentPropsWithoutRef<"div"> {
  readonly isStreaming?: boolean;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** 外部提供的思考时长(秒);缺省则内部按流式起止自动计算。 */
  readonly duration?: number;
}

export const Reasoning = React.memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen = false,
  onOpenChange,
  duration,
  children,
  ...props
}: ReasoningProps): React.JSX.Element {
  const [isOpen, setIsOpenState] = React.useState<boolean>(open ?? defaultOpen);
  const [durationSec, setDurationSec] = React.useState<number>(duration ?? 0);
  const [hasAutoClosed, setHasAutoClosed] = React.useState<boolean>(false);
  const startRef = React.useRef<number | null>(null);

  const setIsOpen = React.useCallback(
    (next: boolean): void => {
      setIsOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // 受控 open。
  React.useEffect(() => {
    if (open !== undefined) setIsOpenState(open);
  }, [open]);

  // 跟踪流式起止 → 计算思考时长(外部未提供 duration 时)。
  React.useEffect(() => {
    if (duration !== undefined) return;
    if (isStreaming) {
      if (startRef.current === null) startRef.current = Date.now();
    } else if (startRef.current !== null) {
      setDurationSec(Math.max(1, Math.round((Date.now() - startRef.current) / MS_IN_S)));
      startRef.current = null;
    }
  }, [isStreaming, duration]);

  // 流式开始自动展开;结束后延迟自动收起一次。
  React.useEffect(() => {
    if (isStreaming && !isOpen) {
      setIsOpen(true);
    } else if (!isStreaming && isOpen && !hasAutoClosed) {
      const t = setTimeout(() => {
        setIsOpen(false);
        setHasAutoClosed(true);
      }, AUTO_CLOSE_DELAY_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isStreaming, isOpen, hasAutoClosed, setIsOpen]);

  const value = React.useMemo<ReasoningContextValue>(
    () => ({
      isStreaming,
      isOpen,
      setIsOpen,
      durationSec: duration ?? durationSec,
    }),
    [isStreaming, isOpen, setIsOpen, duration, durationSec],
  );

  return (
    <ReasoningContext.Provider value={value}>
      <div className={cn("flex flex-col gap-3", className)} {...props}>
        {children}
      </div>
    </ReasoningContext.Provider>
  );
});

export interface ReasoningTriggerProps
  extends React.ComponentPropsWithoutRef<"button"> {}

export const ReasoningTrigger = React.memo(function ReasoningTrigger({
  className,
  children,
  ...props
}: ReasoningTriggerProps): React.JSX.Element {
  const { isStreaming, isOpen, setIsOpen, durationSec } = useReasoning();
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      onClick={() => setIsOpen(!isOpen)}
      className={cn(
        "flex w-fit items-center gap-2 rounded text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="h-4 w-4 shrink-0" />
          {isStreaming || durationSec === 0 ? (
            <span>思考中…</span>
          ) : (
            <span>已思考 {durationSec} 秒</span>
          )}
          <ChevronDownIcon
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </>
      )}
    </button>
  );
});

export interface ReasoningContentProps
  extends React.ComponentPropsWithoutRef<"div"> {
  readonly children: React.ReactNode;
}

export const ReasoningContent = React.memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps): React.JSX.Element | null {
  const { isOpen } = useReasoning();
  if (!isOpen) return null;
  // 字符串内容按空行切段,渲染为有间距的段落(对齐目标的无框正文外观);
  // 非字符串(已是 ReactNode)原样渲染。
  const body =
    typeof children === "string"
      ? children
          .split(/\n{2,}/)
          .map((para, i) => (
            <p key={i} className="mb-3 whitespace-pre-wrap last:mb-0">
              {para}
            </p>
          ))
      : children;
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-[hsl(var(--foreground))]",
        className,
      )}
      {...props}
    >
      {body}
    </div>
  );
});
