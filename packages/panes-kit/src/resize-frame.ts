/** 每动画帧至多通知一次的 Pane 尺寸；供高频侧栏拖拽时延后内部重排。 */
export interface PaneResizeFrame {
  readonly width: number;
  readonly height: number;
}

/**
 * 观察元素尺寸，并把同帧内多次 ResizeObserver 通知合并为末值。
 * 自定义 Pane 建议用此入口，避免每个原生 resize 事件都触发 React 重排。
 */
export function observePaneResizeFrame(
  element: Element,
  listener: (frame: PaneResizeFrame) => void,
): () => void {
  let animationFrame: number | undefined;
  let pending: PaneResizeFrame | undefined;
  let disposed = false;
  const observer = new ResizeObserver((entries) => {
    const entry = entries.at(-1);
    if (entry === undefined || disposed) return;
    pending = {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    };
    animationFrame ??= requestAnimationFrame(() => {
      animationFrame = undefined;
      const next = pending;
      pending = undefined;
      if (!disposed && next !== undefined) listener(next);
    });
  });
  observer.observe(element);
  return () => {
    disposed = true;
    observer.disconnect();
    pending = undefined;
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  };
}
