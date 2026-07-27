/**
 * CompositeSourceProvider — 合并多路来源、按 id 去重、稳定排序(Req 4.1–4.3;
 * desktop-hybrid-agent-sources: N 路 providers)。
 *
 * - 合并顺序:调用方传入的 providers **从左到右优先**;按 `id` 去重,**先见者胜**。
 * - 二元调用 `createCompositeSourceProvider(registry, scan)` 与历史行为一致
 *   (registry 覆盖 scan 元数据)。
 * - 稳定排序:registry 优先(origin),其后按 name(localeCompare),再按 id 兜底全序(Req 4.3)。
 * - 容错:任一子 provider 抛错退化为空贡献,不使整体失败。
 */
import type { AgentSourceProvider, AgentSourceRecord } from "./types.js";

async function safeList(p: AgentSourceProvider): Promise<AgentSourceRecord[]> {
  try {
    return await p.list();
  } catch {
    return [];
  }
}

function originRank(o: AgentSourceRecord["origin"]): number {
  return o === "registry" ? 0 : 1;
}

/**
 * 记录的全序比较器:(originRank asc, name asc, id asc)。
 * 排序与端点 keyset 游标共用此比较器,保证"排序键"与"续取判定"一致(不漂移)。
 * name 用固定 "en" locale,避免跨环境 locale 差异导致顺序不确定(Req 4.3)。
 */
export function compareAgentSourceRecords(
  a: AgentSourceRecord,
  b: AgentSourceRecord,
): number {
  const ra = originRank(a.origin);
  const rb = originRank(b.origin);
  if (ra !== rb) return ra - rb;
  const byName = a.name.localeCompare(b.name, "en");
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 合并任意数量的 `AgentSourceProvider`。
 *
 * @param providers 从高到低优先;同 id 保留先出现的记录。
 */
export function createCompositeSourceProvider(
  ...providers: readonly AgentSourceProvider[]
): AgentSourceProvider {
  return {
    async list(): Promise<AgentSourceRecord[]> {
      const lists = await Promise.all(providers.map((p) => safeList(p)));
      const byId = new Map<string, AgentSourceRecord>();
      for (const recs of lists) {
        for (const r of recs) {
          if (!byId.has(r.id)) byId.set(r.id, r);
        }
      }
      return [...byId.values()].sort(compareAgentSourceRecords);
    },
  };
}
