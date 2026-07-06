/**
 * Canvas UI 本地视图偏好(aigc-canvas · Req 3.2 / 3.3 / 3.5 / 6.4 / 10.3)。
 *
 * 这些偏好是**客户端 state**(localStorage),**不进权威快照**(对齐 AAS「UI 本地偏好走客户端」):
 *  - `density`:概览 / 瀑布流 / 聚焦;
 *  - `page`:客户端分页页码;
 *  - `group`:时间 / 血缘 / 无 分组;
 *  - `selected`:选中资产 id(A-B 对比 / 工作台目标);
 *  - `chain`:当前工作图链(沿 derivedFrom 的一条 UI 本地路径,前进 / 回退)。
 *
 * 另暴露一个**跨 slot 共享**的「画廊开合」store(`canvasOpenStore`):launcherRail 的入口按钮与
 * panelRight 的画廊面板是不同 slot 子树,经此 module-level 可订阅 store(+ localStorage)联动开合,
 * 刷新后从本地恢复(配合上游粘性快照,画廊仍在)。
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type CanvasDensity = "overview" | "waterfall" | "focus";
export type CanvasGroupMode = "time" | "lineage" | "none";

export interface CanvasViewState {
  density: CanvasDensity;
  page: number;
  group: CanvasGroupMode;
  /** 选中资产 id 列表(A-B 对比取前两项)。 */
  selected: string[];
  /** 当前工作图链(att_id 序列;末项为当前工作图)。 */
  chain: string[];
}

function defaultViewState(): CanvasViewState {
  return { density: "overview", page: 0, group: "time", selected: [], chain: [] };
}

const VIEW_KEY = "pi-web:canvas:view";
const OPEN_KEY = "pi-web:canvas:open";

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 配额 / 隐私模式:忽略。 */
  }
}

// ── 跨 slot 共享的「画廊开合」store(module singleton)────────────────────────────

interface OpenStore {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
  set(open: boolean): void;
  toggle(): void;
}

function createOpenStore(): OpenStore {
  let open = readLocal<boolean>(OPEN_KEY, false);
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (open === next) return;
      open = next;
      writeLocal(OPEN_KEY, open);
      emit();
    },
    toggle: () => {
      open = !open;
      writeLocal(OPEN_KEY, open);
      emit();
    },
  };
}

/** module-level 单例(同一 app bundle 内 launcher / panel 共享)。 */
export const canvasOpenStore: OpenStore = createOpenStore();

const SERVER_OPEN = (): boolean => false;

/** 订阅跨 slot 的画廊开合态。 */
export function useCanvasOpen(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
} {
  const open = useSyncExternalStore(
    canvasOpenStore.subscribe,
    canvasOpenStore.getSnapshot,
    SERVER_OPEN,
  );
  return {
    open,
    setOpen: useCallback((next: boolean) => canvasOpenStore.set(next), []),
    toggle: useCallback(() => canvasOpenStore.toggle(), []),
  };
}

// ── 视图偏好 store(localStorage;单例,便于跨 slot 一致)────────────────────────

interface ViewStore {
  getSnapshot(): CanvasViewState;
  subscribe(listener: () => void): () => void;
  update(patch: (prev: CanvasViewState) => CanvasViewState): void;
}

function createViewStore(): ViewStore {
  let state: CanvasViewState = { ...defaultViewState(), ...readLocal(VIEW_KEY, {}) };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (patch) => {
      state = patch(state);
      writeLocal(VIEW_KEY, state);
      for (const l of listeners) l();
    },
  };
}

export const canvasViewStore: ViewStore = createViewStore();

const SERVER_VIEW = (): CanvasViewState => defaultViewState();

export interface UseCanvasViewResult extends CanvasViewState {
  setDensity(density: CanvasDensity): void;
  setPage(page: number): void;
  setGroup(group: CanvasGroupMode): void;
  toggleSelected(id: string): void;
  clearSelected(): void;
  /** 把资产推进当前工作图链(末项)。 */
  pushChain(id: string): void;
  /** 沿工作图链回退一步。 */
  popChain(): void;
}

/** UI 本地视图偏好(localStorage 持久;刷新后从本地恢复)。 */
export function useCanvasView(): UseCanvasViewResult {
  const state = useSyncExternalStore(
    canvasViewStore.subscribe,
    canvasViewStore.getSnapshot,
    SERVER_VIEW,
  );

  const setDensity = useCallback((density: CanvasDensity) => {
    canvasViewStore.update((s) => ({ ...s, density, page: 0 }));
  }, []);
  const setPage = useCallback((page: number) => {
    canvasViewStore.update((s) => ({ ...s, page: Math.max(0, page) }));
  }, []);
  const setGroup = useCallback((group: CanvasGroupMode) => {
    canvasViewStore.update((s) => ({ ...s, group }));
  }, []);
  const toggleSelected = useCallback((id: string) => {
    canvasViewStore.update((s) => ({
      ...s,
      selected: s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id],
    }));
  }, []);
  const clearSelected = useCallback(() => {
    canvasViewStore.update((s) => ({ ...s, selected: [] }));
  }, []);
  const pushChain = useCallback((id: string) => {
    canvasViewStore.update((s) => ({
      ...s,
      chain: [...s.chain.filter((x) => x !== id), id],
    }));
  }, []);
  const popChain = useCallback(() => {
    canvasViewStore.update((s) => ({ ...s, chain: s.chain.slice(0, -1) }));
  }, []);

  return useMemo(
    () => ({
      ...state,
      setDensity,
      setPage,
      setGroup,
      toggleSelected,
      clearSelected,
      pushChain,
      popChain,
    }),
    [state, setDensity, setPage, setGroup, toggleSelected, clearSelected, pushChain, popChain],
  );
}

/** 每页容量(over 轻量快照列表;9 宫格默认视图)。 */
export const CANVAS_PAGE_SIZE: Record<CanvasDensity, number> = {
  overview: 9,
  waterfall: 12,
  focus: 1,
};
