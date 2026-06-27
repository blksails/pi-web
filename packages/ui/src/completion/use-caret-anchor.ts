/**
 * useCaretAnchor — 把浮层(补全/命令面板)锚定到 textarea 光标的共享 hook。
 *
 * 封装 caret 像素测量(getCaretCoordinates)+ 视口几何换算(computePlacement)+ 滚动/缩放
 * 重算 + SSR 安全的 layout effect,返回可直接铺到浮层容器的 `position: fixed` 样式。
 * `@` 补全与 `/` 命令面板共用,保证两者呈现一致(completion-cursor-anchor)。
 */
import * as React from "react";
import { getCaretCoordinates } from "./caret-coordinates.js";
import { computePlacement, type PlacementStyle } from "./placement.js";

/** 浮层估高(max-h-64 = 16rem ≈ 256px),供翻转判断。 */
const EST_POPOVER_HEIGHT = 256;

/** SSR 安全的 layout effect。 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface UseCaretAnchorArgs {
  /** 底层 textarea ref。 */
  readonly inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** 锚定的字符偏移(`@` 用活跃 token 起点,`/` 用 0 行首)。 */
  readonly offset: number;
  /** 浮层是否可见;为 false 时不测量、不挂监听,返回 null。 */
  readonly active: boolean;
  /** 触发重算的信号(通常为 `${value}:${cursor}`),变化即重新定位。 */
  readonly recomputeOn?: unknown;
}

/**
 * 返回浮层的 fixed 定位样式;active 为 false 时返回 null。首帧 ref/测量未就绪时退化为
 * 安全位置(贴左上),不崩。
 */
export function useCaretAnchor(
  args: UseCaretAnchorArgs,
): React.CSSProperties | null {
  const { inputRef, offset, active, recomputeOn } = args;
  const [placement, setPlacement] = React.useState<PlacementStyle | null>(null);

  const recompute = React.useCallback((): void => {
    const el = inputRef?.current ?? null;
    if (el === null || typeof window === "undefined") return;
    const caret = getCaretCoordinates(el, offset);
    const rect = el.getBoundingClientRect();
    setPlacement(
      computePlacement({
        rect: { top: rect.top, left: rect.left },
        caret,
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        viewportHeight: window.innerHeight,
        estPopoverHeight: EST_POPOVER_HEIGHT,
      }),
    );
  }, [inputRef, offset]);

  useIsomorphicLayoutEffect(() => {
    if (active) recompute();
    // recomputeOn 显式纳入依赖以在 value/cursor 变化时重定位。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, recomputeOn, recompute]);

  React.useEffect(() => {
    if (!active) return;
    const onScrollOrResize = (): void => recompute();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [active, recompute]);

  if (!active) return null;

  if (placement === null) {
    return { position: "fixed", left: 0, top: 0 };
  }
  return placement.flip
    ? { position: "fixed", left: placement.left, bottom: placement.bottom }
    : { position: "fixed", left: placement.left, top: placement.top };
}
