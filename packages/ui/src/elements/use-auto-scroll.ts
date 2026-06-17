/**
 * useAutoScroll — 无状态滚动容器的自动滚动钩子。
 *
 * 跟踪滚动容器是否"贴底"(带阈值容差):
 *  - 贴底(`atBottom=true`):children 变化(新消息/流式增量)时自动滚动到底 (Req 7.1)。
 *  - 离底(`atBottom=false`):停止自动滚动,交由 UI 显示"回到底部"入口 (Req 7.2)。
 *  - `scrollToBottom()`:平滑滚动到底并恢复自动滚动 (Req 7.3)。
 *
 * 本钩子不渲染任何 DOM,仅返回供 `<Conversation>` 绑定的 ref / 状态 / 动作,
 * 以便在 jsdom 下通过受控的 scrollTop/scrollHeight/clientHeight 驱动三态(可测)。
 */
import * as React from "react";

export interface UseAutoScrollOptions {
  /** 贴底判定的像素容差,默认 24。 */
  readonly threshold?: number;
}

export interface UseAutoScrollResult {
  /** 绑定到滚动容器的 ref。 */
  readonly ref: React.RefObject<HTMLDivElement | null>;
  /** 当前是否贴底。 */
  readonly atBottom: boolean;
  /** 平滑滚动到底并恢复自动滚动。 */
  readonly scrollToBottom: () => void;
}

const DEFAULT_THRESHOLD = 24;

function computeAtBottom(el: HTMLElement, threshold: number): boolean {
  // scrollTop + clientHeight 达到(或在容差内接近)scrollHeight 即视为贴底。
  return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

export function useAutoScroll(
  /** 触发自动滚动评估的依赖(通常为 children/messages 的标识)。 */
  dep: unknown,
  options?: UseAutoScrollOptions,
): UseAutoScrollResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const ref = React.useRef<HTMLDivElement | null>(null);
  // 初始默认贴底(空会话时新内容应自动滚动)。
  const [atBottom, setAtBottom] = React.useState<boolean>(true);
  const atBottomRef = React.useRef<boolean>(true);

  const sync = React.useCallback((): void => {
    const el = ref.current;
    if (el === null) return;
    const next = computeAtBottom(el, threshold);
    atBottomRef.current = next;
    setAtBottom((prev) => (prev === next ? prev : next));
  }, [threshold]);

  // 监听容器滚动事件以更新贴底状态 (Req 7.2)。
  React.useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const onScroll = (): void => {
      sync();
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [sync]);

  const scrollToBottom = React.useCallback((): void => {
    const el = ref.current;
    if (el === null) return;
    const top = el.scrollHeight - el.clientHeight;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollTop = top;
    }
    // 恢复自动滚动 (Req 7.3)。
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // children/messages 变化时:若仍贴底,则自动滚动到底 (Req 7.1)。
  // 使用 useLayoutEffect 以在浏览器绘制前完成滚动,避免可见跳动。
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (!atBottomRef.current) return;
    const top = el.scrollHeight - el.clientHeight;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: "auto" });
    } else {
      el.scrollTop = top;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return { ref, atBottom, scrollToBottom };
}
