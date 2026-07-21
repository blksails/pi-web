// [迁移壳层] 源:aigc-agent lib/workspace/search-query-store.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * 搜索词 store（Search-to-Tab 的传参通道，来源 04 §5.6）。
 *
 * 浮层（Cmd/Ctrl+K）与右栏的搜索模块**不在同一棵子树**（后者在 vendor `panelRight` slot
 * 里），prop-drill 会穿过 vendor 边界。仿本仓既有 `skill-panel-store` 的 module-level
 * store 范式传参，不新造上下文。
 *
 * 带 `seq`：同一个词连搜两次也要重跑，只比较字符串会静默吞掉第二次。
 */
import * as React from "react";

export interface SearchQuery {
  readonly query: string;
  readonly seq: number;
}

let current: SearchQuery = { query: "", seq: 0 };
const listeners = new Set<() => void>();

export function getSearchQuery(): SearchQuery {
  return current;
}

export function setSearchQuery(query: string): void {
  current = { query, seq: current.seq + 1 };
  for (const l of listeners) l();
}

export function subscribeSearchQuery(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSearchQuery(): SearchQuery {
  return React.useSyncExternalStore(
    subscribeSearchQuery,
    getSearchQuery,
    getSearchQuery,
  );
}
