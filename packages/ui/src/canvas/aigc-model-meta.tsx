/**
 * @deprecated 转发兼容层(canvas-ui-m15 · Req 3.1/3.2/3.4)——保留**一个大版本**。
 *
 * aigc-model-meta 已整体下沉至 `@blksails/pi-web-canvas-ui`(canvas 领域组件 canonical 家),
 * 本模块只做**显式清单转发**:原模块 HEAD 版导出全集(3 值)逐一对应,
 * 深路径 import(`.../src/canvas/aigc-model-meta.js`)与 ui 内部消费者
 * (设置面板 aigc-model-toggles-field)双兼容。
 *
 * - 新代码请直接 `import ... from "@blksails/pi-web-canvas-ui"`;
 * - 刻意用显式 `export {...} from` 而非 `export *`:canvas-ui 出口另含其余
 *   canvas 组件与纯函数,不得经本兼容层泄漏成 ui 的既成公开面。
 */

// ── 值导出(3)──────────────────────────────────────────────────────────────
export { PROVIDER_META, displayNameOf, ProviderBadge } from "@blksails/pi-web-canvas-ui";
