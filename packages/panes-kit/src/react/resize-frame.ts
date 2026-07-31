import * as React from "react";
import {
  observePaneResizeFrame,
  type PaneResizeFrame,
} from "../resize-frame.js";

/** React Pane 的推荐尺寸 ref：逐帧合并 ResizeObserver 通知。 */
export function usePaneResizeFrame<T extends Element>(
  listener: (frame: PaneResizeFrame) => void,
): React.RefCallback<T> {
  const listenerRef = React.useRef(listener);
  const disposeRef = React.useRef<() => void>(() => undefined);
  listenerRef.current = listener;
  React.useEffect(() => () => disposeRef.current(), []);
  return React.useCallback((element: T | null) => {
    disposeRef.current();
    disposeRef.current = element === null
      ? () => undefined
      : observePaneResizeFrame(element, (frame) => listenerRef.current(frame));
  }, []);
}
