/**
 * @deprecated 转发兼容层(canvas-ui-m15 · Req 3.1/3.2/3.4)——保留**一个大版本**。
 *
 * CanvasWorkbench(工作台组件 + 生成决策纯函数 + inpaint 回合成)已整体下沉至
 * `@blksails/pi-web-canvas-ui`(canvas 领域组件 canonical 家),本模块只做**显式清单转发**:
 * 原模块 HEAD 版导出全集(5 值 + 5 类型,含 LoadedImage 单点类型 re-export)逐一对应,
 * 深路径 import(`.../src/canvas/canvas-workbench.js`)与 ui 包入口导出链双兼容。
 *
 * - 新代码请直接 `import ... from "@blksails/pi-web-canvas-ui"`;
 * - 刻意用显式 `export {...} from` 而非 `export *`:canvas-ui 出口另含其余
 *   canvas 组件与纯函数,不得经本兼容层泄漏成 ui 的既成公开面。
 */

// ── 值导出(5)──────────────────────────────────────────────────────────────
export {
  CanvasWorkbench,
  decideGenerate,
  buildSurfaceOp,
  buildToolPrompt,
  composeInpaintBack,
} from "@blksails/pi-web-canvas-ui";

// ── 类型导出(5)────────────────────────────────────────────────────────────
export type {
  CanvasWorkbenchProps,
  GenerateDecision,
  GenerateDecisionInput,
  ImageLoader,
  LoadedImage,
} from "@blksails/pi-web-canvas-ui";
