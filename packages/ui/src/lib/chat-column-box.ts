/**
 * 解析 chat 主列矩形，供弹层在「有侧栏/Pane」时于 chat 侧居中。
 */
import type { CSSProperties } from "react";

const CHAT_COLUMN_SELECTORS = [
  "[data-pi-chat-conversation-column]",
  "[data-pi-chat-pro]",
] as const;

export function queryChatColumnElement(
  root: ParentNode = document,
): HTMLElement | null {
  for (const sel of CHAT_COLUMN_SELECTORS) {
    const el = root.querySelector(sel);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

/** 取 chat 主列 viewport 矩形；找不到则 null（调用方回退全屏）。 */
export function getChatColumnBox(): DOMRect | null {
  if (typeof document === "undefined") return null;
  const el = queryChatColumnElement();
  return el !== null ? el.getBoundingClientRect() : null;
}

export function chatColumnBoxToOverlayStyle(box: DOMRect | null): CSSProperties {
  if (box === null) {
    return { position: "fixed", inset: 0 };
  }
  return {
    position: "fixed",
    top: box.top,
    left: box.left,
    width: Math.max(0, box.width),
    height: Math.max(0, box.height),
  };
}
