/**
 * kernel/stage — 舞台视口与坐标内核(L1,**不从包根出口导出**;task 2.1,Req 2.1)。
 *
 * design.md「L1 集成核 / stage」:`createStageController` 持视口(scale/offset)与
 * `toNatural(clientX, clientY): {x,y}|null`;纯函数芯独立导出给单测与后续
 * pointer(2.4)/tool-runtime(2.5)消费。
 *
 * 原样迁移自 canvas-workbench:
 * - toNatural 换算数学 = workbench :867(现树 :852-:861)逐语义一致:客户端坐标经
 *   overlay 的 BoundingClientRect(天然含 translate/scale transform)线性映射为源图
 *   像素坐标;rect 不可得(元素缺失/零尺寸)或 natural 未量到 → null,手势不启动;
 * - 视口钳制 = workbench :92-:94(ZOOM_MIN/ZOOM_MAX/clampZoom);
 * - 视口初值/复位 = workbench :520-:521/:549-:552(scale=1, offset=(0,0))。
 *
 * 本模块只做视口**状态容器**与换算纯函数 —— 平移/缩放**手势**(wheel 监听、drag 会话)
 * 属 pointer 路由与装配方,不在此处(React 无关,纯 TS)。
 */

// ── 常量与钳制(workbench :92-:94 原样迁移)───────────────────────────────────

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// ── toNatural 纯函数芯(workbench :852-:861 原样迁移)─────────────────────────

/** getBoundingClientRect 的最小子形(便于单测注入,不依赖 DOMRect)。 */
export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 客户端坐标 → 源图像素坐标(唯一实现,Req 2.1)。
 *
 * rect 为 overlay 的 BoundingClientRect 投影(天然含视口 translate/scale,故此处
 * 无视口数学);rect/natural 不可得或 rect 零/负尺寸 → null(现状语义:手势不启动)。
 */
export function toNatural(
  clientX: number,
  clientY: number,
  rect: RectLike | null | undefined,
  natural: { readonly w: number; readonly h: number } | null | undefined,
): { x: number; y: number } | null {
  if (rect === null || rect === undefined || natural === null || natural === undefined) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * natural.w,
    y: ((clientY - rect.top) / rect.height) * natural.h,
  };
}

// ── StageController(视口状态容器)───────────────────────────────────────────

/** 视口快照(不可变;变更即换新引用,useSyncExternalStore 适配前提)。 */
export interface StageViewport {
  readonly scale: number;
  readonly offset: { readonly x: number; readonly y: number };
}

/** 装配方注入的环境访问器(DOM 量取留在装配层,kernel 零 DOM 依赖)。 */
export interface StageEnv {
  /** overlay 元素当前 BoundingClientRect(不可得 → null)。 */
  getRect(): RectLike | null;
  /** 源图自然尺寸(未量到 → null)。 */
  getNaturalSize(): { readonly w: number; readonly h: number } | null;
}

export interface StageController {
  /** 当前视口快照(未变更时引用稳定)。 */
  getViewport(): StageViewport;
  /** 直设缩放(钳制于 [ZOOM_MIN, ZOOM_MAX])。 */
  setScale(scale: number): void;
  /** 乘法缩放一档(滚轮/按钮语义:clampZoom(scale × factor),workbench :594)。 */
  zoomBy(factor: number): void;
  /** 直设偏移(平移 drag 会话在装配/pointer 层,此处只收状态)。 */
  setOffset(offset: { readonly x: number; readonly y: number }): void;
  /** 相对平移(ToolContext `stage.panBy` 能力面,design「CanvasToolContext」)。 */
  panBy(dx: number, dy: number): void;
  /** 复位视图(scale=1, offset=(0,0);workbench resetView)。 */
  reset(): void;
  /** 视口变更订阅(返回退订;无实效变更不通知)。 */
  subscribe(listener: () => void): () => void;
  /** 客户端坐标 → 源图像素坐标(经 env 取 rect/natural;不可得 → null)。 */
  toNatural(clientX: number, clientY: number): { x: number; y: number } | null;
}

export function createStageController(env: StageEnv): StageController {
  let viewport: StageViewport = { scale: 1, offset: { x: 0, y: 0 } };
  const listeners = new Set<() => void>();

  const commit = (next: StageViewport): void => {
    if (
      next.scale === viewport.scale &&
      next.offset.x === viewport.offset.x &&
      next.offset.y === viewport.offset.y
    ) {
      return; // 无实效变更:保持快照引用稳定,不通知。
    }
    viewport = next;
    for (const l of listeners) l();
  };

  return {
    getViewport: () => viewport,
    setScale: (scale) => commit({ scale: clampZoom(scale), offset: viewport.offset }),
    zoomBy: (factor) => commit({ scale: clampZoom(viewport.scale * factor), offset: viewport.offset }),
    setOffset: (offset) => commit({ scale: viewport.scale, offset: { x: offset.x, y: offset.y } }),
    panBy: (dx, dy) =>
      commit({
        scale: viewport.scale,
        offset: { x: viewport.offset.x + dx, y: viewport.offset.y + dy },
      }),
    reset: () => commit({ scale: 1, offset: { x: 0, y: 0 } }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toNatural: (clientX, clientY) => toNatural(clientX, clientY, env.getRect(), env.getNaturalSize()),
  };
}
