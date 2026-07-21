// [迁移壳层] 源:aigc-agent lib/workspace/layout-tree.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * 工作区分屏布局树（纯函数，零 React 依赖 —— 故可被 node e2e 直测）。
 *
 * 单一真相源：一棵递归的 split/pane 树（来源 `docs/webext-digest/04-…md` §5.3）。
 * 关键取舍（与三份上游设计稿都不同，理由见 `CONTRACT-iteration-6.md`「已定方案」）：
 * **布局只产出百分比矩形，不产出 DOM 结构**——模块实例在 React 树里位置恒定，换窗/拖拽
 * 只改 inline style。DOM 节点从不移动 ⇒ iframe 不重载、画布状态不丢，也不必用 portal
 * 或 `ResizeObserver` 去同步矩形（`createPortal` 换 container 同样会重挂子树）。
 *
 * 窗口数上限 4（来源 04 §5.4「屏幕内最多同时平铺 4 个窗口」）；达上限后新页面只能并为 tab。
 */

/** `horizontal` = 子节点左右排列；`vertical` = 上下排列。 */
export type SplitDirection = "horizontal" | "vertical";

export interface PaneNode {
  readonly type: "pane";
  readonly id: string;
  /** 该窗内的实例 id（tab 顺序即数组顺序）。 */
  readonly tabs: readonly string[];
  readonly activeTab: string | null;
}

export interface SplitNode {
  readonly type: "split";
  readonly direction: SplitDirection;
  /** 恒 2 个子节点：二分递归已足以表达 2×2 与「1 宽 + 2 窄」。 */
  readonly children: readonly [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | SplitNode;

/** 百分比矩形（0..100），直接喂给 inline style。 */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 拖拽停靠热区（来源 04 §5.4）：四边 25% 切分，中心 50% 并为 tab。 */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export const MAX_PANES = 4;

export function emptyLayout(paneId = "pane-1"): PaneNode {
  return { type: "pane", id: paneId, tabs: [], activeTab: null };
}

export function listPanes(node: LayoutNode): readonly PaneNode[] {
  return node.type === "pane"
    ? [node]
    : [...listPanes(node.children[0]), ...listPanes(node.children[1])];
}

export function countPanes(node: LayoutNode): number {
  return listPanes(node).length;
}

export function firstPaneId(node: LayoutNode): string {
  return listPanes(node)[0]!.id;
}

export function getPane(node: LayoutNode, paneId: string): PaneNode | undefined {
  return listPanes(node).find((p) => p.id === paneId);
}

export function findPaneOf(
  node: LayoutNode,
  instanceId: string,
): PaneNode | undefined {
  return listPanes(node).find((p) => p.tabs.includes(instanceId));
}

/** 全树的实例 id（按窗顺序 → tab 顺序）。 */
export function listInstanceIds(node: LayoutNode): readonly string[] {
  return listPanes(node).flatMap((p) => p.tabs);
}

/** 下一个可用 pane id（`pane-N`，取现有最大值 +1，保证稳定不复用）。 */
function nextPaneId(node: LayoutNode): string {
  const used = listPanes(node).map((p) => {
    const n = Number.parseInt(p.id.replace(/^pane-/, ""), 10);
    return Number.isFinite(n) ? n : 0;
  });
  return `pane-${Math.max(0, ...used) + 1}`;
}

/** 递归重写：对每个 pane 应用 `fn`，返回 null 表示删除该 pane（父 split 随之折叠）。 */
function mapPanes(
  node: LayoutNode,
  fn: (pane: PaneNode) => PaneNode | null,
): LayoutNode | null {
  if (node.type === "pane") return fn(node);
  const a = mapPanes(node.children[0], fn);
  const b = mapPanes(node.children[1], fn);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.children[0] && b === node.children[1]) return node;
  return { ...node, children: [a, b] };
}

/** 把某个 pane 就地替换为任意节点（用于「切分」）。 */
function replacePane(
  node: LayoutNode,
  paneId: string,
  build: (pane: PaneNode) => LayoutNode,
): LayoutNode {
  if (node.type === "pane") return node.id === paneId ? build(node) : node;
  const a = replacePane(node.children[0], paneId, build);
  const b = replacePane(node.children[1], paneId, build);
  if (a === node.children[0] && b === node.children[1]) return node;
  return { ...node, children: [a, b] };
}

/** 追加一个实例到指定窗并激活；窗不存在则落到首窗。 */
export function addTab(
  node: LayoutNode,
  paneId: string,
  instanceId: string,
): LayoutNode {
  const target = getPane(node, paneId) !== undefined ? paneId : firstPaneId(node);
  const next = mapPanes(node, (p) =>
    p.id !== target || p.tabs.includes(instanceId)
      ? p
      : { ...p, tabs: [...p.tabs, instanceId], activeTab: instanceId },
  );
  // mapPanes 在此不会删除任何 pane，故 next 必非 null。
  return next ?? node;
}

/**
 * 关掉一个实例。若其所在窗因此变空且不是最后一个窗 → 该窗被移除、父 split 折叠
 * （树里不留空节点）；若是最后一个窗则保留为空窗。
 */
export function removeTab(node: LayoutNode, instanceId: string): LayoutNode {
  const onlyPane = countPanes(node) === 1;
  const next = mapPanes(node, (p) => {
    if (!p.tabs.includes(instanceId)) return p;
    const tabs = p.tabs.filter((t) => t !== instanceId);
    if (tabs.length === 0) return onlyPane ? { ...p, tabs, activeTab: null } : null;
    const activeTab = p.activeTab === instanceId ? (tabs[0] ?? null) : p.activeTab;
    return { ...p, tabs, activeTab };
  });
  return next ?? emptyLayout();
}

/** 激活某实例（其所在窗的 activeTab 指向它）。 */
export function activateTab(node: LayoutNode, instanceId: string): LayoutNode {
  const next = mapPanes(node, (p) =>
    p.tabs.includes(instanceId) ? { ...p, activeTab: instanceId } : p,
  );
  return next ?? node;
}

/**
 * 拖拽落位。`center` = 并入目标窗的 tab 条；四边 = 在该侧切出新窗。
 *
 * 达 `MAX_PANES` 上限、或源窗因此清空导致目标窗消失时，**静默退化为 center 合并**
 * （来源 04 §5.2 action dispatch 第 3 步）。
 */
export function moveTab(
  node: LayoutNode,
  instanceId: string,
  targetPaneId: string,
  zone: DropZone,
): LayoutNode {
  const from = findPaneOf(node, instanceId);
  if (from === undefined) return node;
  if (zone === "center" && from.id === targetPaneId) return activateTab(node, instanceId);
  // 源窗只剩这一个 tab 且就是往自己边上拖 ⇒ 无意义（切出去等于原地不动）。
  if (zone !== "center" && from.id === targetPaneId && from.tabs.length === 1) {
    return node;
  }

  const removed = removeTab(node, instanceId);
  const target = getPane(removed, targetPaneId);
  if (target === undefined) return node; // 目标窗已随源窗折叠 —— 放弃本次移动
  if (zone === "center" || countPanes(removed) >= MAX_PANES) {
    return addTab(removed, targetPaneId, instanceId);
  }

  const newPane: PaneNode = {
    type: "pane",
    id: nextPaneId(removed),
    tabs: [instanceId],
    activeTab: instanceId,
  };
  const direction: SplitDirection =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const before = zone === "left" || zone === "top";
  return replacePane(removed, targetPaneId, (pane) => ({
    type: "split",
    direction,
    children: before ? [newPane, pane] : [pane, newPane],
  }));
}

/**
 * 布局树 → 每个窗的百分比矩形。二分等分（暂不做可拖拽的分割比例）。
 *
 * ponytail: 上限 = 分割线不可拖动，窗永远等分。升级路径 = 给 `SplitNode` 加
 * `ratio: number`（默认 0.5）并在此处按比例分配，其余调用方无需改动。
 */
export function paneRects(node: LayoutNode): ReadonlyMap<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: LayoutNode, r: Rect): void => {
    if (n.type === "pane") {
      out.set(n.id, r);
      return;
    }
    if (n.direction === "horizontal") {
      const w = r.width / 2;
      walk(n.children[0], { ...r, width: w });
      walk(n.children[1], { ...r, left: r.left + w, width: w });
    } else {
      const h = r.height / 2;
      walk(n.children[0], { ...r, height: h });
      walk(n.children[1], { ...r, top: r.top + h, height: h });
    }
  };
  walk(node, { left: 0, top: 0, width: 100, height: 100 });
  return out;
}

/**
 * 响应式收敛（来源 04 §5.5）：右栏总宽小于阈值时，多窗拍平为单窗 tab 堆叠
 * （**不改树本身**，只改渲染用的矩形与 tab 归属；宽度恢复后自动弹回平铺）。
 *
 * 阈值取 420 而非来源写的「工作区总宽 < 800px / 单窗 < 400px」：那份设计假定的是
 * Codex 式**整窗工作区**；本仓的工作区是对话右侧的侧栏，按 800 判会永远处于收敛态、
 * 分屏形同虚设。偏差记录在此。
 */
export const COLLAPSE_WIDTH_PX = 420;

export function collapseIfNarrow(
  node: LayoutNode,
  widthPx: number,
): LayoutNode {
  if (widthPx >= COLLAPSE_WIDTH_PX || countPanes(node) === 1) return node;
  const panes = listPanes(node);
  const tabs = panes.flatMap((p) => p.tabs);
  const active =
    panes.find((p) => p.activeTab !== null)?.activeTab ?? (tabs[0] ?? null);
  return { type: "pane", id: panes[0]!.id, tabs, activeTab: active };
}

/** 点（相对某窗，0..1）落在哪个热区：四边 25%、中心 50%。 */
export function zoneAt(xRatio: number, yRatio: number): DropZone {
  const edge = 0.25;
  const dist = {
    left: xRatio,
    right: 1 - xRatio,
    top: yRatio,
    bottom: 1 - yRatio,
  };
  const nearest = (Object.keys(dist) as (keyof typeof dist)[]).reduce((a, b) =>
    dist[a] <= dist[b] ? a : b,
  );
  return dist[nearest] < edge ? nearest : "center";
}
