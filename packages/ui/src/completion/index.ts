/**
 * completion-provider-framework(前端)— 公共出口。
 */
export {
  PiCompletionPopover,
  type PiCompletionPopoverProps,
} from "./pi-completion-popover.js";
export {
  useCompletion,
  type CompletionClient,
  type UseCompletionArgs,
  type UseCompletionResult,
  type CompletionGroupView,
} from "./use-completion.js";
export { findActiveToken, type ActiveToken } from "./extractors.js";
export {
  getCaretCoordinates,
  type CaretCoordinates,
} from "./caret-coordinates.js";
export {
  computePlacement,
  type PlacementInput,
  type PlacementStyle,
} from "./placement.js";
export {
  flattenSelectable,
  isSelectable,
  nextActiveIndex,
} from "./nav.js";
export {
  useCaretAnchor,
  type UseCaretAnchorArgs,
} from "./use-caret-anchor.js";
