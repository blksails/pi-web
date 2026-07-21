// [迁移壳层] 源:aigc-agent lib/workspace/workspace-store.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * 工作区状态（模块级单例 store）。
 *
 * 左栏（已打开模块列表 / ＋添加模块）与右栏（分屏 + Tab 条）共用**同一份真相源**——
 * 上游设计稿把它散在两处组件里，会立刻分叉。仿本仓既有 `skill-panel-store` 的做法：
 * module-level store + `useSyncExternalStore`，不引额外状态库。
 *
 * **不可放进组件**：随 render 重建 = 所有模块实例连同 DOM 重挂 = 画布/iframe 状态全丢。
 */
import * as React from "react";
import {
  activateTab,
  addTab,
  emptyLayout,
  findPaneOf,
  firstPaneId,
  getPane,
  listInstanceIds,
  listPanes,
  moveTab,
  removeTab,
  type DropZone,
  type LayoutNode,
} from "./layout-tree";
import { defaultOpenModuleIds, getWorkspaceModule } from "./module-registry";

export interface WorkspaceInstance {
  readonly instanceId: string;
  readonly moduleId: string;
  /** 覆盖模块默认标题（如「🔍 搜索: 概念设计」）。 */
  readonly title?: string;
}

export interface WorkspaceState {
  readonly layout: LayoutNode;
  /** 插入序即渲染序 —— 渲染顺序必须与布局无关，否则换窗会改变 fiber 位置 = 重建。 */
  readonly instances: readonly WorkspaceInstance[];
  /** 新模块默认落在哪个窗。 */
  readonly activePaneId: string;
}

const LS_KEY = "aigc.workspace.v2";

function initialState(): WorkspaceState {
  const root = emptyLayout();
  const ids = defaultOpenModuleIds();
  let layout = ids.reduce<LayoutNode>((l, id) => addTab(l, root.id, id), root);
  // addTab 激活「最后加入」的那个；首帧应停在**注册序第一个**默认模块。
  if (ids[0] !== undefined) layout = activateTab(layout, ids[0]);
  return {
    layout,
    instances: ids.map((id) => ({ instanceId: id, moduleId: id })),
    activePaneId: root.id,
  };
}

let state: WorkspaceState = initialState();
const listeners = new Set<() => void>();
let hydrated = false;

function emit(next: WorkspaceState): void {
  state = next;
  persist();
  for (const l of listeners) l();
}

export function getWorkspaceState(): WorkspaceState {
  return state;
}

export function subscribeWorkspace(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useWorkspaceState(): WorkspaceState {
  return React.useSyncExternalStore(
    subscribeWorkspace,
    getWorkspaceState,
    getWorkspaceState,
  );
}

// ── 持久化（best-effort；隐私模式/配额满静默降级） ─────────────────────────────

function persist(): void {
  if (typeof window === "undefined" || !hydrated) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* 忽略 */
  }
}

/**
 * 从 localStorage 读回（只在客户端 mount 后调一次；SSR 首帧用默认值）。
 * 只保留 moduleId 仍注册着的实例——模块被删/改名后残留的 tab 会渲染成空洞。
 */
export function hydrateWorkspace(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  let saved: WorkspaceState | null = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    saved = raw === null ? null : (JSON.parse(raw) as WorkspaceState);
  } catch {
    saved = null;
  }
  if (saved === null || typeof saved.layout !== "object") return;
  const alive = (saved.instances ?? []).filter(
    (i) => getWorkspaceModule(i.moduleId) !== undefined,
  );
  if (alive.length === 0) return;
  const aliveIds = new Set(alive.map((i) => i.instanceId));
  let layout = saved.layout;
  for (const id of listInstanceIds(layout)) {
    if (!aliveIds.has(id)) layout = removeTab(layout, id);
  }
  // 存档里没被放进任何窗的实例（异常存档）→ 补进首窗，避免渲染出孤儿。
  const placed = new Set(listInstanceIds(layout));
  for (const i of alive) {
    if (!placed.has(i.instanceId)) layout = addTab(layout, firstPaneId(layout), i.instanceId);
  }
  const activePaneId =
    getPane(layout, saved.activePaneId) !== undefined
      ? saved.activePaneId
      : firstPaneId(layout);
  emit({ layout, instances: alive, activePaneId });
}

// ── 操作 ──────────────────────────────────────────────────────────────────────

function newInstanceId(moduleId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(moduleId)) return moduleId;
  for (let n = 2; ; n += 1) {
    const id = `${moduleId}#${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * 打开一个模块。单例模块（默认）已开则**只聚焦**（来源 04 §5.2 action dispatch 第 2 步）；
 * `allowMultiple` 的模块每次都新开一个实例。返回被聚焦/新建的 instanceId。
 */
export function openWorkspaceModule(
  moduleId: string,
  opts: { readonly title?: string } = {},
): string | null {
  const mod = getWorkspaceModule(moduleId);
  if (mod === undefined) return null;
  if (mod.allowMultiple !== true) {
    const existing = state.instances.find((i) => i.moduleId === moduleId);
    if (existing !== undefined) {
      const pane = findPaneOf(state.layout, existing.instanceId);
      const instances =
        opts.title === undefined
          ? state.instances
          : state.instances.map((i) =>
              i.instanceId === existing.instanceId ? { ...i, title: opts.title } : i,
            );
      emit({
        layout: activateTab(state.layout, existing.instanceId),
        instances,
        activePaneId: pane?.id ?? state.activePaneId,
      });
      return existing.instanceId;
    }
  }
  const instanceId = newInstanceId(
    moduleId,
    new Set(state.instances.map((i) => i.instanceId)),
  );
  emit({
    layout: addTab(state.layout, state.activePaneId, instanceId),
    instances: [
      ...state.instances,
      { instanceId, moduleId, ...(opts.title !== undefined ? { title: opts.title } : {}) },
    ],
    activePaneId: state.activePaneId,
  });
  return instanceId;
}

export function closeWorkspaceInstance(instanceId: string): void {
  if (!state.instances.some((i) => i.instanceId === instanceId)) return;
  const layout = removeTab(state.layout, instanceId);
  emit({
    layout,
    instances: state.instances.filter((i) => i.instanceId !== instanceId),
    activePaneId:
      getPane(layout, state.activePaneId) !== undefined
        ? state.activePaneId
        : firstPaneId(layout),
  });
}

export function activateWorkspaceInstance(instanceId: string): void {
  const pane = findPaneOf(state.layout, instanceId);
  if (pane === undefined) return;
  emit({
    layout: activateTab(state.layout, instanceId),
    instances: state.instances,
    activePaneId: pane.id,
  });
}

export function moveWorkspaceInstance(
  instanceId: string,
  targetPaneId: string,
  zone: DropZone,
): void {
  const layout = moveTab(state.layout, instanceId, targetPaneId, zone);
  if (layout === state.layout) return;
  const pane = findPaneOf(layout, instanceId);
  emit({
    layout,
    instances: state.instances,
    activePaneId: pane?.id ?? firstPaneId(layout),
  });
}

/** 当前每个窗里可见（激活）的实例 id 集合 —— 决定 `<Activity mode>`。 */
export function visibleInstanceIds(s: WorkspaceState = state): ReadonlySet<string> {
  return new Set(
    listPanes(s.layout)
      .map((p) => p.activeTab)
      .filter((id): id is string => id !== null),
  );
}

/** 仅供测试：复位为「按注册表默认打开」的初态。 */
export function __resetWorkspaceState(): void {
  hydrated = false;
  state = initialState();
  for (const l of listeners) l();
}
