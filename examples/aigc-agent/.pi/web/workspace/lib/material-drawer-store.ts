// [迁移壳层] 源:aigc-agent lib/stores/material-drawer-store.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
import { create } from "zustand";

/**
 * material-drawer UI 态(Zustand · ③ app 壳 · 数据层)。
 *
 * 管**素材抽屉的交互态**(tab / 过滤 / 树展开 / 选中目录),脱离组件生命周期存活 → 抽屉折叠/展开、
 * 右栏开关、甚至跨会话都**保持上次状态**,不再每次重置(承接用户要求:「一个管 ui(zustand),
 * 一个管 supabase 请求(react-query)」)。数据本身由 React Query 缓存,二者分工。
 *
 * 所有 UI 态经 localStorage 持久化(SSR 安全:默认固定,hydration 后在 MaterialDrawer 组件内
 * 通过 subscribe 写回)。键前缀 `aigc.drawer.`。
 */
export type DrawerTab = "lib" | "dir" | "split";
/** 素材库范围:当前会话 / 我的全部生成(跨会话,复用 /api/assets 无 session 参数)。 */
export type LibScope = "session" | "all";

export interface SelectedDir {
  readonly id: number;
  readonly name: string;
  readonly count: number;
}

/** 分栏占比钳制(15–85,与拖拽分隔条约定一致)。 */
const clampPct = (p: number): number => Math.min(85, Math.max(15, p));

const LS_PREFIX = "aigc.drawer.";

function lsRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const r = localStorage.getItem(LS_PREFIX + key);
    return r !== null ? (JSON.parse(r) as T) : fallback;
  } catch { return fallback; }
}

function lsWrite(key: string, val: unknown): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* best-effort */ }
}

interface MaterialDrawerUI {
  readonly tab: DrawerTab;
  readonly libScope: LibScope;
  readonly filter: string;
  /** 展开的树节点 key(数组以便可序列化/稳定)。 */
  readonly expanded: readonly string[];
  readonly selDir: SelectedDir | null;
  /** 并列视图:素材库 ↔ 目录组 分栏占比(素材库一侧,%,15–85)。 */
  readonly libSplitPct: number;
  /** 目录组内:当前目录 ↔ 目录树 分栏占比(当前目录一侧,%,15–85)。 */
  readonly dirSplitPct: number;
  readonly setTab: (t: DrawerTab) => void;
  readonly setLibScope: (s: LibScope) => void;
  readonly setFilter: (f: string) => void;
  readonly toggleNode: (key: string) => void;
  readonly setSelDir: (d: SelectedDir | null) => void;
  readonly setLibSplitPct: (pct: number) => void;
  readonly setDirSplitPct: (pct: number) => void;
}

const store = create<MaterialDrawerUI>((set) => ({
  tab: lsRead<DrawerTab>("tab", "split"),
  libScope: lsRead<LibScope>("libScope", "session"),
  filter: lsRead<string>("filter", "全部"),
  expanded: lsRead<string[]>("expanded", ["all"]),
  selDir: lsRead<SelectedDir | null>("selDir", null),
  libSplitPct: lsRead<number>("libSplitPct", 38),
  dirSplitPct: lsRead<number>("dirSplitPct", 45),
  setTab: (t) => { set({ tab: t }); lsWrite("tab", t); },
  setLibScope: (s) => { set({ libScope: s }); lsWrite("libScope", s); },
  setFilter: (f) => { set({ filter: f }); lsWrite("filter", f); },
  toggleNode: (key) =>
    set((s) => {
      const next = s.expanded.includes(key)
        ? s.expanded.filter((k) => k !== key)
        : [...s.expanded, key];
      lsWrite("expanded", next);
      return { expanded: next };
    }),
  setSelDir: (d) => { set({ selDir: d }); lsWrite("selDir", d); },
  setLibSplitPct: (pct) => { const v = clampPct(pct); set({ libSplitPct: v }); lsWrite("libSplitPct", v); },
  setDirSplitPct: (pct) => { const v = clampPct(pct); set({ dirSplitPct: v }); lsWrite("dirSplitPct", v); },
}));

// 全局 subscribe:任何变更同步到 localStorage(兜底,避免 setter 遗漏)。
store.subscribe((s) => {
  lsWrite("tab", s.tab);
  lsWrite("libScope", s.libScope);
  lsWrite("filter", s.filter);
  lsWrite("expanded", s.expanded);
  lsWrite("selDir", s.selDir);
  lsWrite("libSplitPct", s.libSplitPct);
  lsWrite("dirSplitPct", s.dirSplitPct);
});

export const useMaterialDrawerStore = store;
