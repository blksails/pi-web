/**
 * SessionFavoritesStore — 会话收藏的读写存储(session-list-item-actions)。
 *
 * 会话收藏是**用户偏好**(按 sessionId 记录),独立于只读的会话枚举(session-list)。持久化为
 * 单个 JSON 文件 `<agentDir>/session-favorites.json`,形态 `{ "sessionIds": string[] }`。
 *
 * - `list()`:文件缺失/坏 JSON → 返回 [](不使请求失败);去重、丢空串。
 * - `set()`:全量替换,原子写(写 `<file>.tmp` 后 rename),避免半写。仅写该偏好文件,无其它副作用。
 *
 * 形态与 `agent-source-list/favorites-store` 同范式,但载荷键为 `sessionIds`(字符串数组),
 * 不复用 `AgentSourceFavorite`(source+name)类型 —— 二者语义不同,存储文件亦独立。
 *
 * host-contract v1(M4,spec: host-contract-stores-on-workspace):内部改建到 `LocalWorkspace`
 * user 命名空间(§3.7,键 `session-favorites.json`),不再直接 `node:fs`;落盘字节/权限/原子写
 * 与迁移前逐字节不变。`list()` 对**所有**读错误 catch→[](保持现状静默降级,行为零变化)。
 */
import { createLocalWorkspaceNamespace } from "../workspace/index.js";

/** user 命名空间下的会话收藏键(§3.7 表)。 */
const SESSION_FAVORITES_KEY = "session-favorites.json";

export interface SessionFavoritesStore {
  /** 返回已收藏的 sessionId 集合(去重、无空串)。 */
  list(): Promise<string[]>;
  /** 全量替换收藏集合(去重、丢空串),原子落盘。 */
  set(sessionIds: readonly string[]): Promise<void>;
}

export interface SessionFavoritesStoreOptions {
  /** user 命名空间根目录(agentDir)。收藏落 `<root>/session-favorites.json`。 */
  readonly root: string;
}

/** 去重 + 丢空串,保持首次出现顺序。 */
function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 从原始 JSON 提取合法 sessionId 集合(坏结构 → [])。 */
function parseFavorites(parsed: unknown): string[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const arr = (parsed as { sessionIds?: unknown }).sessionIds;
  if (!Array.isArray(arr)) return [];
  return normalizeIds(arr.filter((x): x is string => typeof x === "string"));
}

export function createSessionFavoritesStore(
  opts: SessionFavoritesStoreOptions,
): SessionFavoritesStore {
  const ns = createLocalWorkspaceNamespace(opts.root);
  return {
    async list(): Promise<string[]> {
      try {
        return parseFavorites(await ns.readJson(SESSION_FAVORITES_KEY));
      } catch {
        // 保持现状:对所有读错误(含损坏 JSON / io)静默降级为 [](行为零变化)。
        return [];
      }
    },

    async set(sessionIds): Promise<void> {
      const clean = normalizeIds(sessionIds);
      await ns.writeJson(SESSION_FAVORITES_KEY, { sessionIds: clean }, { merge: false });
    },
  };
}
