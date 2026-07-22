/**
 * FavoritesStore — agent source 收藏的读写存储(sidebar-launcher-rail)。
 *
 * 收藏是**用户偏好**,独立于只读源枚举(scan/registry)。
 *
 * host-contract v1(M4,spec: host-contract-stores-on-workspace):内部改建到
 * `LocalWorkspace` 的 user 命名空间之上(§3.7,键 `agent-source-favorites.json`),
 * 不再直接 `node:fs`。落盘路径/权限/字节与迁移前逐字节不变;原子写由 Workspace 承接。
 *
 * - `list()`:缺文件/坏 JSON/任何读错误 → 返回 `[]`(**保持现状对所有读错误静默降级**;
 *   readJson 缺文件→`{}`→[],损坏→抛 corrupt→catch→[]);逐条 zod 校验,坏条目跳过。
 *   ⚠ 现状(迁移前)`list` 对**所有**读错误 catch→[](含 io),非 ConfigCodec 的 io-rethrow;
 *   为行为零变化,此处保持全 catch。
 * - `set()`:全量替换,`writeJson(merge:false)`;仅写该偏好键,无其它副作用。
 */
import { createLocalWorkspaceNamespace } from "../workspace/index.js";
import {
  AgentSourceFavoriteSchema,
  type AgentSourceFavorite,
} from "@blksails/pi-web-protocol";

/** user 命名空间下的收藏键(§3.7 表)。 */
const FAVORITES_KEY = "agent-source-favorites.json";

export interface FavoritesStore {
  list(): Promise<AgentSourceFavorite[]>;
  set(favorites: readonly AgentSourceFavorite[]): Promise<void>;
}

export interface FavoritesStoreOptions {
  /** user 命名空间根目录(agentDir)。收藏落 `<root>/agent-source-favorites.json`。 */
  readonly root: string;
}

/** 从原始 JSON 提取合法收藏项(坏条目静默跳过)。 */
function parseFavorites(parsed: unknown): AgentSourceFavorite[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const arr = (parsed as { favorites?: unknown }).favorites;
  if (!Array.isArray(arr)) return [];
  const out: AgentSourceFavorite[] = [];
  for (const item of arr) {
    const r = AgentSourceFavoriteSchema.safeParse(item);
    if (r.success && r.data.source.length > 0) out.push(r.data);
  }
  return out;
}

export function createFavoritesStore(
  opts: FavoritesStoreOptions,
): FavoritesStore {
  const ns = createLocalWorkspaceNamespace(opts.root);
  return {
    async list(): Promise<AgentSourceFavorite[]> {
      try {
        return parseFavorites(await ns.readJson(FAVORITES_KEY));
      } catch {
        // 保持现状:对所有读错误(含损坏 JSON / io)静默降级为 [](行为零变化)。
        return [];
      }
    },

    async set(favorites): Promise<void> {
      // 落盘前丢弃 source 为空的项,使磁盘内容与 list() 的返回一致(避免 PUT 回显与落盘不对称)。
      const clean = [...favorites].filter((f) => f.source.length > 0);
      await ns.writeJson(FAVORITES_KEY, { favorites: clean }, { merge: false });
    },
  };
}
