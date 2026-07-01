/**
 * FavoritesStore — agent source 收藏的读写存储(sidebar-launcher-rail)。
 *
 * 收藏是**用户偏好**,独立于只读源枚举(scan/registry)。持久化为单个 JSON 文件
 * `<agentDir>/agent-source-favorites.json`,形态 `{ "favorites": [ { source, name } ] }`。
 *
 * - `list()`:文件缺失/坏 JSON → 返回 [];逐条 zod 校验,坏条目跳过其余保留(Req 4.7)。
 * - `set()`:全量替换,原子写(写 `<file>.tmp` 后 rename),避免半写。仅写该偏好文件
 *   (Req 6.3),无其它副作用。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  AgentSourceFavoriteSchema,
  type AgentSourceFavorite,
} from "@blksails/pi-web-protocol";

export interface FavoritesStore {
  list(): Promise<AgentSourceFavorite[]>;
  set(favorites: readonly AgentSourceFavorite[]): Promise<void>;
}

export interface FavoritesStoreOptions {
  /** 收藏 JSON 文件绝对路径。 */
  readonly filePath: string;
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

/** 进程内单调计数,拼进临时文件名,避免同进程并发 PUT 共用同一 tmp 而互相踩写。 */
let tmpCounter = 0;

export function createFavoritesStore(
  opts: FavoritesStoreOptions,
): FavoritesStore {
  return {
    async list(): Promise<AgentSourceFavorite[]> {
      let raw: string;
      try {
        raw = await fs.readFile(opts.filePath, "utf8");
      } catch {
        return []; // 缺失/不可读 → 视为空(Req 4.7)
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return []; // 坏 JSON → 不使整体失败(Req 4.7)
      }
      return parseFavorites(parsed);
    },

    async set(favorites): Promise<void> {
      // 落盘前丢弃 source 为空的项,使磁盘内容与 list() 的返回一致(避免 PUT 回显与落盘不对称)。
      const clean = [...favorites].filter((f) => f.source.length > 0);
      const body = JSON.stringify({ favorites: clean }, null, 2);
      await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
      // 原子替换:先写临时文件再 rename(同目录 rename 原子),避免半写被读到。tmp 名带 pid +
      // 单调计数,防同进程并发 PUT 共用同一 tmp 互相踩写。
      tmpCounter += 1;
      const tmp = `${opts.filePath}.${process.pid}.${tmpCounter}.tmp`;
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, opts.filePath);
    },
  };
}
