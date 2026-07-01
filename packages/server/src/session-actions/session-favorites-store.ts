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
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface SessionFavoritesStore {
  /** 返回已收藏的 sessionId 集合(去重、无空串)。 */
  list(): Promise<string[]>;
  /** 全量替换收藏集合(去重、丢空串),原子落盘。 */
  set(sessionIds: readonly string[]): Promise<void>;
}

export interface SessionFavoritesStoreOptions {
  /** 收藏 JSON 文件绝对路径。 */
  readonly filePath: string;
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

/** 进程内单调计数,拼进临时文件名,避免同进程并发写共用同一 tmp 而互相踩写。 */
let tmpCounter = 0;

export function createSessionFavoritesStore(
  opts: SessionFavoritesStoreOptions,
): SessionFavoritesStore {
  return {
    async list(): Promise<string[]> {
      let raw: string;
      try {
        raw = await fs.readFile(opts.filePath, "utf8");
      } catch {
        return []; // 缺失/不可读 → 视为空
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return []; // 坏 JSON → 不使整体失败
      }
      return parseFavorites(parsed);
    },

    async set(sessionIds): Promise<void> {
      const clean = normalizeIds(sessionIds);
      const body = JSON.stringify({ sessionIds: clean }, null, 2);
      await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
      // 原子替换:先写临时文件再 rename(同目录 rename 原子),避免半写被读到。tmp 名带 pid +
      // 单调计数,防同进程并发写共用同一 tmp 互相踩写。
      tmpCounter += 1;
      const tmp = `${opts.filePath}.${process.pid}.${tmpCounter}.tmp`;
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, opts.filePath);
    },
  };
}
