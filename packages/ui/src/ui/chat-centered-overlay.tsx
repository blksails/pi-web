/**
 * Chat 列居中叠层：portal 到 body，有侧栏时遮罩/居中仅覆盖 chat 主列。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";
import {
  chatColumnBoxToOverlayStyle,
  getChatColumnBox,
} from "../lib/chat-column-box.js";

/** 订阅 chat 列矩形（resize/scroll 时更新）。 */
export function useChatColumnBox(): DOMRect | null {
  const [box, setBox] = React.useState<DOMRect | null>(() =>
    typeof document !== "undefined" ? getChatColumnBox() : null,
  );

  React.useLayoutEffect(() => {
    const pick = (): void => setBox(getChatColumnBox());
    pick();
    window.addEventListener("resize", pick);
    window.addEventListener("scroll", pick, true);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => pick())
        : undefined;
    const el =
      document.querySelector("[data-pi-chat-conversation-column]") ??
      document.querySelector("[data-pi-chat-pro]");
    if (el instanceof HTMLElement) ro?.observe(el);
    return () => {
      window.removeEventListener("resize", pick);
      window.removeEventListener("scroll", pick, true);
      ro?.disconnect();
    };
  }, []);

  return box;
}

export function useChatColumnOverlayStyle(): React.CSSProperties {
  return chatColumnBoxToOverlayStyle(useChatColumnBox());
}

/**
 * 居中于 chat 主列的遮罩容器（portal body）。
 * onBackdrop：点遮罩关闭。
 */
export function ChatCenteredOverlay(props: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly zIndexClassName?: string;
  readonly onBackdrop?: () => void;
  readonly "data-testid"?: string;
}): React.JSX.Element {
  const style = useChatColumnOverlayStyle();
  const node = (
    <div
      className={cn(
        "flex items-center justify-center bg-black/40 p-4",
        props.zIndexClassName ?? "z-[70]",
        props.className,
      )}
      style={style}
      role="presentation"
      data-pi-chat-centered-overlay=""
      data-testid={props["data-testid"]}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onBackdrop?.();
      }}
    >
      {props.children}
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
