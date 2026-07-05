/**
 * @blksails/pi-web-canvas-kit — L2 开发者面唯一出口(出口纪律)。
 *
 * 纪律(Req 1.3/1.4,design.md「Boundary Commitments / L2 公开面」):
 * - 此出口只暴露 L2 开发者面(define* API、hooks、类型)与 bitmap-io 函数;
 * - kernel/ 内部件(L1 集成核:stage/pointer/history/layers/tool-runtime)
 *   **不得**出现在此出口 —— L1 可自由重构,不构成破坏性变更;
 * - 此出口是 semver 承诺面:任何导出的增删改按 semver 语义对待;
 * - 依赖方向:ui 消费 canvas-kit,反向禁止(本包零 @blksails/* 依赖)。
 *
 * 当前已填充(task 1.2):types(canonical 家)+ bitmap-io(client-image-ops 迁入);
 * 后续任务按 design.md File Structure Plan 续填:registry(defineCanvasTool/
 * createCanvasRegistry)/ builtin。
 */
// 类型 canonical 家(Annotation/MaskStroke/ExpandEdges/WorkLayer/CanvasOp + LoadedImage)。
export * from "./types.js";
// bitmap-io:client-image-ops 原样迁入(导出清单与原模块逐一对应,Req 5.2)。
export * from "./bitmap-io.js";
