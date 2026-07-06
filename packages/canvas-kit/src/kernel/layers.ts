/**
 * kernel/layers — 图层树 store 与 move/resize reducer(L1,**不从包根出口导出**;
 * task 2.3,Req 5.1)。
 *
 * design.md「L1 集成核 / layers」:`createLayersStore`(WorkLayer 树 + 命中 +
 * move/resize reducer + useSyncExternalStore 适配);拍平仍经 bitmap-io
 * `flattenLayers`(不在本模块)。
 *
 * 行为语义原样迁移自 canvas-workbench(M3 图层,逐语义一致):
 * - add(:871-908 addLayer):初始宽 = 底图宽 40%,高 = 宽(占位方形,加载后按
 *   真实纵横比修正);落点居中(缺省底图中心);natural 未量到退化 1024 占位
 *   (与 sourceSize 同策略);id 序列 `layer-<n>`(per-store);加层即选中;
 * - markLoaded(:892-905 loader.then 修正):`{...l, loaded, h: l.w×ratio,
 *   y: cy0 − (l.w×ratio)/2}` —— cy0 为**加层时**捕获的落点纵中心(闭包语义,
 *   本模块以私有表保存);ratio = img.width>0 ? h/w : 1;层已删 → no-op
 *   (原 prev.map 空命中);加载失败不进本模块(装配层 catch 后不调用);
 * - remove(:1693-1694)= filter + 删的是选中层时清选中;clear(:562-563/
 *   :1095-1096/:1706-1707)= 全清 + 清选中;
 * - 命中 = id 查找(:978 `layers.find(x => x.id === id)`);
 * - move/resize reducer(:998-1007):move = orig + 位移;resize = 右下角手柄
 *   等比缩放(以横向位移为准,`w = max(24, orig.w + dx)`,dy 不参与;
 *   ratio = orig.w>0 ? orig.h/orig.w : 1)。每帧从 orig + 总位移重算(非增量
 *   累加)。位移单位 = **底图像素**(client→natural 换算在 pointer/装配层,2.4)。
 *
 * 指针事件本身(capture/drag 会话 ref/stopPropagation)不在本模块 —— 2.4 pointer
 * 路由职责;本模块只承载纯 reducer 与树状态(React 无关,纯 TS)。
 *
 * useSyncExternalStore 适配契约(hook 本体在装配层):subscribe/getSnapshot;
 * **未变更时快照引用稳定**(no-op 不换引用、不通知 —— 参照 2.1/2.2 先例)。
 */
import type { LoadedImage, WorkLayer } from "../types.js";

// ── 常量(workbench :1004 原样迁移)──────────────────────────────────────────

/** resize 最小边长钳制(源图像素;:1004 `Math.max(24, ...)`)。 */
export const LAYER_MIN_SIZE = 24;

/** natural 未量到时的占位底图边长(:874,与 sourceSize 同策略)。 */
export const LAYER_FALLBACK_NATURAL = 1024;

/** 新层初始宽 = 底图宽 × 0.4(:877)。 */
export const LAYER_INITIAL_WIDTH_RATIO = 0.4;

// ── move/resize reducer 纯函数芯(workbench :998-1007 原样迁移)───────────────

/** 手势起点(down 时捕获的层几何;每帧以此为基准重算,防增量漂移)。 */
export interface LayerGestureOrigin {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一次层手势描述(id + 模式 + down 时捕获的 orig)。 */
export interface LayerGesture {
  readonly id: string;
  readonly mode: "move" | "resize";
  readonly orig: LayerGestureOrigin;
}

/**
 * 层手势 reducer(:998-1007 逐语义):给定当前层数组 + 底图像素位移 → 新数组。
 * move = orig + 位移;resize = 等比缩放(横向位移为准,钳最小 24px,dy 不参与)。
 * 非目标层保持同一引用;目标不存在时返回原数组引用(no-op)。
 */
export function applyLayerGesture(
  layers: readonly WorkLayer[],
  gesture: LayerGesture,
  dx: number,
  dy: number,
): readonly WorkLayer[] {
  if (!layers.some((l) => l.id === gesture.id)) return layers;
  return layers.map((l) => {
    if (l.id !== gesture.id) return l;
    if (gesture.mode === "move") return { ...l, x: gesture.orig.x + dx, y: gesture.orig.y + dy };
    // 等比缩放(右下角手柄;以横向位移为准,钳最小 24px)。
    const ratio = gesture.orig.w > 0 ? gesture.orig.h / gesture.orig.w : 1;
    const w = Math.max(LAYER_MIN_SIZE, gesture.orig.w + dx);
    return { ...l, w, h: w * ratio };
  });
}

// ── LayersStore ───────────────────────────────────────────────────────────────

/** 图层快照(不可变;变更即换新引用,useSyncExternalStore 适配前提)。 */
export interface LayersSnapshot {
  readonly layers: readonly WorkLayer[];
  readonly selectedId: string | null;
}

/** add 的资产输入(画廊资产/上传结果的最小子形,:872)。 */
export interface AddLayerInput {
  readonly attachmentId: string;
  readonly displayUrl: string;
}

/**
 * 插件图层元数据(task 3.2,Req 1.1/1.2;additive)。meta 缺省 = 既有基于附件的图像图层
 * 语义**零变**(add 第 4 参不传时 kind/data 均不落到 WorkLayer,渲染/拍平走 img 既有路径)。
 * meta.kind 存在 = 插件图层:装配层据 kind 命中 registry.layers 渲染器/拍平器,data 为该
 * 插件私有数据(Inspector 经 updateData 回写)。
 */
export interface LayerMeta {
  readonly kind?: string;
  readonly data?: unknown;
}

/**
 * 只读能力面(design `CanvasToolContext.layers: LayersReadApi`;2.5/2.6 注入
 * 工具上下文 —— 工具插件经此读层,不直接改组件私有状态,Req 5.1)。
 */
export interface LayersReadApi {
  /** 图层数组(后加的在上;不可变)。 */
  readonly layers: readonly WorkLayer[];
  /** 当前选中层 id(无 → null)。 */
  readonly selectedId: string | null;
  /** id 命中查找(:978 find 语义;未知 → undefined)。 */
  get(id: string): WorkLayer | undefined;
}

export interface LayersStore extends LayersReadApi {
  /**
   * 加一层(:871-908 缺省语义):初始宽 = natural.w × 0.4、占位方形、落点居中
   * (`at` 缺省 = 底图中心);natural 未量到(null/undefined)退化 1024 占位。
   * 返回新层 id(`layer-<n>`,per-store 单调);加层即选中。
   * 图像异步加载归装配层:成功后调 markLoaded 修正纵横比,失败保留占位。
   */
  add(
    att: AddLayerInput,
    at?: { readonly x: number; readonly y: number } | null,
    natural?: { readonly w: number; readonly h: number } | null,
    meta?: LayerMeta | null,
  ): string;
  /**
   * 更新插件图层私有数据(task 3.2,Req 1.3;additive,Inspector 编辑回写)。未知 id → no-op;
   * 值未变(引用相同)也换新引用触发重渲(Inspector 语义:一次编辑一次呈现更新)。既有图像
   * 图层不携带 data,不经此路径(零变)。撤销/重做由装配层以 op 承载(裁定 C 之外的 data-op)。
   */
  updateData(id: string, data: unknown): void;
  /**
   * 加载修正(:895-901):`{...l, loaded, h: l.w×ratio, y: cy0 − (l.w×ratio)/2}`
   * (cy0 = 加层时落点纵中心;用**当时**的 l.w —— 加载慢于缩放时按新宽修正)。
   * 层已删除 → no-op。
   */
  markLoaded(id: string, image: LoadedImage): void;
  /** 删层(:1693-1694):filter;删的是选中层时清选中;未知 id → no-op。 */
  remove(id: string): void;
  /** 全清 + 清选中(:562-563/:1095-1096/:1706-1707 复位语义);已空 → no-op。 */
  clear(): void;
  /** 直设选中(:891/:980 setSelectedLayer 语义;null = 取消选中)。 */
  select(id: string | null): void;
  /** 层手势 reducer 落栈(applyLayerGesture;目标不存在 → no-op)。 */
  applyGesture(gesture: LayerGesture, dx: number, dy: number): void;
  /** 变更订阅(返回退订;无实效变更不通知)。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照(未变更时引用稳定)。 */
  getSnapshot(): LayersSnapshot;
}

export function createLayersStore(): LayersStore {
  let snapshot: LayersSnapshot = { layers: [], selectedId: null };
  let seq = 0; // :499 layerSeq(per-store)
  /** 加层时捕获的落点纵中心(:879-880 闭包 cy0 的等价保存;markLoaded 消费)。 */
  const dropCenterY = new Map<string, number>();
  const listeners = new Set<() => void>();

  const commit = (layers: readonly WorkLayer[], selectedId: string | null): void => {
    if (layers === snapshot.layers && selectedId === snapshot.selectedId) return; // no-op:引用稳定
    snapshot = { layers, selectedId };
    for (const l of listeners) l();
  };

  return {
    add: (att, at, natural, meta) => {
      // :873-874 natural 未量到(jsdom / 未加载)退化 1024 占位,与 sourceSize 同策略。
      const nat = natural ?? { w: LAYER_FALLBACK_NATURAL, h: LAYER_FALLBACK_NATURAL };
      seq += 1;
      const id = `layer-${seq}`;
      const w0 = nat.w * LAYER_INITIAL_WIDTH_RATIO;
      const h0 = w0; // 占位方形,markLoaded 后按真实纵横比修正
      const cx0 = at?.x ?? nat.w / 2;
      const cy0 = at?.y ?? nat.h / 2;
      dropCenterY.set(id, cy0);
      const layer: WorkLayer = {
        id,
        attachmentId: att.attachmentId,
        displayUrl: att.displayUrl,
        x: cx0 - w0 / 2,
        y: cy0 - h0 / 2,
        w: w0,
        h: h0,
        // 插件图层元数据(task 3.2):meta 缺省时 kind/data 均不落(图像图层零变);spread 空对象。
        ...(meta?.kind !== undefined ? { kind: meta.kind } : {}),
        ...(meta !== undefined && meta !== null && "data" in meta ? { data: meta.data } : {}),
      };
      commit([...snapshot.layers, layer], id); // :890-891 append + 选中新层
      return id;
    },
    updateData: (id, data) => {
      if (!snapshot.layers.some((l) => l.id === id)) return; // 未知 id:no-op
      commit(
        snapshot.layers.map((l) => (l.id === id ? { ...l, data } : l)),
        snapshot.selectedId,
      );
    },
    markLoaded: (id, image) => {
      const cur = snapshot.layers.find((l) => l.id === id);
      if (cur === undefined) return; // 层已删(:895 prev.map 空命中)
      const cy0 = dropCenterY.get(id) ?? cur.y + cur.h / 2; // 防御回退(正常路径必有记录)
      const ratio = image.width > 0 ? image.height / image.width : 1; // :894
      commit(
        snapshot.layers.map((l) =>
          l.id === id ? { ...l, loaded: image, h: l.w * ratio, y: cy0 - (l.w * ratio) / 2 } : l,
        ),
        snapshot.selectedId,
      );
    },
    remove: (id) => {
      if (!snapshot.layers.some((l) => l.id === id)) return; // 未知 id:no-op
      dropCenterY.delete(id);
      commit(
        snapshot.layers.filter((l) => l.id !== id),
        snapshot.selectedId === id ? null : snapshot.selectedId, // :1694 删选中层清选中
      );
    },
    clear: () => {
      if (snapshot.layers.length === 0 && snapshot.selectedId === null) return; // 已空:no-op
      dropCenterY.clear();
      commit([], null);
    },
    select: (id) => commit(snapshot.layers, id),
    applyGesture: (gesture, dx, dy) => {
      commit(applyLayerGesture(snapshot.layers, gesture, dx, dy), snapshot.selectedId);
    },
    get: (id) => snapshot.layers.find((l) => l.id === id), // :978 命中语义
    get layers() {
      return snapshot.layers;
    },
    get selectedId() {
      return snapshot.selectedId;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
