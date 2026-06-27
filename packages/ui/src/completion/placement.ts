/**
 * 补全浮层定位(纯函数)。
 *
 * 把"textarea 视口几何 + caret 内容坐标"换算为浮层的 `position: fixed` 样式:
 * 默认在 caret 下方弹出;下方空间不足时翻转到上方(浮层底贴 caret 顶)。抽成纯函数以便
 * 不依赖真实 layout 做单测。
 */
import type { CaretCoordinates } from "./caret-coordinates.js";

export interface PlacementInput {
  /** textarea getBoundingClientRect 的 top/left(视口坐标)。 */
  readonly rect: { readonly top: number; readonly left: number };
  /** caret 在 textarea 内容坐标系的位置。 */
  readonly caret: CaretCoordinates;
  /** textarea 自身滚动偏移。 */
  readonly scrollTop: number;
  readonly scrollLeft: number;
  /** 视口高度(window.innerHeight)。 */
  readonly viewportHeight: number;
  /** 浮层估高,用于判断下方是否放得下。 */
  readonly estPopoverHeight: number;
}

export type PlacementStyle =
  | { readonly left: number; readonly top: number; readonly flip: false }
  | { readonly left: number; readonly bottom: number; readonly flip: true };

/**
 * 计算浮层 fixed 定位。`left` 对齐 caret;垂直默认在 caret 下方,空间不足翻转到上方。
 */
export function computePlacement(input: PlacementInput): PlacementStyle {
  const { rect, caret, scrollTop, scrollLeft, viewportHeight, estPopoverHeight } =
    input;
  const left = rect.left + caret.left - scrollLeft;
  const caretTop = rect.top + caret.top - scrollTop;
  const below = caretTop + caret.height;

  if (below + estPopoverHeight > viewportHeight) {
    // 下方放不下 → 翻到上方:浮层底边贴 caret 顶。
    return { left, bottom: viewportHeight - caretTop, flip: true };
  }
  return { left, top: below, flip: false };
}
