/**
 * @deprecated 转发兼容层(canvas-ui-m15 · Req 1.3/3.4)——保留**一个大版本**。
 *
 * Select 已整体下沉至 `@blksails/pi-web-primitives`,本模块只做**显式清单转发**:
 * 原模块 HEAD 版导出全集(6 值)逐一对应,深路径 import
 * (`.../src/ui/select.js`)与 ui 内部相对路径消费者双兼容。
 *
 * - 新代码请直接 `import ... from "@blksails/pi-web-primitives"`;
 * - 刻意用显式 `export {...} from` 而非 `export *`:primitives 出口另含其余
 *   组件与 cn,不得经本兼容层泄漏成 ui 的既成公开面。
 */

// ── 值导出(6)──────────────────────────────────────────────────────────────
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@blksails/pi-web-primitives";
