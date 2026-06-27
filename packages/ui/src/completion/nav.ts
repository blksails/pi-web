/**
 * 补全浮层键盘导航辅助(纯函数)。
 *
 * 把按 kind 分组的候选拍平为单一线性可选序列,使方向键可在分组之间连续移动;过滤不可选
 * 的占位项(`insertText === ""`,如截断标示)。
 */
import type { CompletionItem } from "@blksails/pi-web-protocol";
import type { CompletionGroupView } from "./use-completion.js";

/** 占位项(不可选):insertText 为空串(如"还有 N 项"截断标示)。 */
export function isSelectable(item: CompletionItem): boolean {
  return item.insertText !== "";
}

/** 跨组拍平为线性可选序列(保持分组渲染顺序)。 */
export function flattenSelectable(
  groups: readonly CompletionGroupView[],
): readonly CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (isSelectable(it)) out.push(it);
    }
  }
  return out;
}

/** 在 [0,len) 内按方向环绕移动;len 为 0 时返回 0。 */
export function nextActiveIndex(
  current: number,
  len: number,
  dir: 1 | -1,
): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}
