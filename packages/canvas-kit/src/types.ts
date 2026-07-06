/**
 * canvas-kit 类型 canonical 家(task 1.2,design.md File Structure Plan)。
 *
 * Annotation / MaskStroke / ExpandEdges / WorkLayer / CanvasOp 的**唯一权威定义**:
 * - Annotation/MaskStroke/ExpandEdges 自 ui client-image-ops 收编(声明与注释原样);
 *   bitmap-io.ts 转发同一声明,导出清单与原 client-image-ops 逐一对应(5.2);
 * - WorkLayer(含支撑类型 LoadedImage)自 canvas-workbench 私有声明收编(5.1 图层内核铺垫);
 * - CanvasOp 为 history 开放栈的 op 形状(4.1/4.4,design「CanvasOp / History」)。
 */

// ── 标注(线/箭头/文本/画笔)───────────────────────────────────────────────────

/** 一条标注(源图**像素坐标**;text 时 `from` 为锚点、`text` 为内容)。 */
export interface Annotation {
  readonly kind: "line" | "arrow" | "text" | "draw";
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  /** 自由画笔折线(kind="draw";源图像素坐标)。 */
  readonly points?: readonly { x: number; y: number }[];
  readonly text?: string;
  /** 线宽(text 时为字号基数,实际字号 = size × 4)。 */
  readonly size: number;
  /** 每条标注的颜色(缺省用 drawAnnotations 的整体 color 参数,即批注红)。 */
  readonly color?: string;
}

// ── 掩码笔迹(掩码刷/擦除)─────────────────────────────────────────────────────

/** 一笔掩码笔迹(源图**像素坐标**折线;paint=涂白(重绘区) / erase=涂黑(收回))。 */
export interface MaskStroke {
  readonly mode: "paint" | "erase";
  /** 笔刷直径(源图像素)。 */
  readonly size: number;
  readonly points: readonly { x: number; y: number }[];
}

// ── 扩图(outpaint)────────────────────────────────────────────────────────────

/** 四边扩展量(源图像素,≥0)。 */
export interface ExpandEdges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

// ── 图层 ──────────────────────────────────────────────────────────────────────

/** 已加载的可绘图像(尺寸显式携带,便于注入 fake 测试)。 */
export interface LoadedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/** 舞台图层(位置/尺寸为**底图像素坐标**,后加的在上;独立于 undo 栈)。 */
export interface WorkLayer {
  readonly id: string;
  readonly attachmentId: string;
  readonly displayUrl: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 加载后的可绘源(拍平用;异步填充)。 */
  readonly loaded?: LoadedImage;
  /**
   * 插件图层类型(task 1.1,Req 1.1/1.5;additive 可选)。缺省 = 既有基于附件的图像图层
   * 语义**零变**:未声明 kind 者照现状渲染(drawImage)/拍平,不经插件图层分派。命名空间
   * 化后的 CanvasLayerPlugin.type(如 "acme-stickers:sticker"),装配层据此定位插件渲染器。
   */
  readonly kind?: string;
  /**
   * 插件图层私有数据(task 1.1;additive 可选)。类型边界为 unknown,由对应插件(Render/
   * bake/Inspector)自行收窄;既有图像图层不携带(零变)。
   */
  readonly data?: unknown;
}

// ── 编辑历史(开放栈)──────────────────────────────────────────────────────────

/**
 * 统一编辑历史项(开放形状,4.1/4.4):`kind` 开放注册(内置:"stroke" | "anno"),
 * 自定义 kind 与内置一视同仁地参与 undo/redo 与光栅化(经工具 opKinds 注册)。
 */
export interface CanvasOp {
  readonly kind: string;
  readonly item: unknown;
}
