/**
 * CompositeSourceProvider — 合并多路来源、按 id 去重、稳定排序(Req 4.1–4.3)。
 *
 * - 合并顺序:先注册表(registry)后扫描(scan);按 `id` 去重,**先见者胜** → registry
 *   记录覆盖 scan 记录的元数据(Req 4.1/4.2)。
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
 * @param registry 注册表 provider(优先级更高,覆盖同 id)。
 * @param scan 目录扫描 provider。
 */
export function createCompositeSourceProvider(
  registry: AgentSourceProvider,
  scan: AgentSourceProvider,
): AgentSourceProvider {
  return {
    async list(): Promise<AgentSourceRecord[]> {
      const [reg, scanned] = await Promise.all([
        safeList(registry),
        safeList(scan),
      ]);
      // registry 先入,占据 id;scan 仅补充未出现的 id(registry 覆盖 scan)。
      const byId = new Map<string, AgentSourceRecord>();
      for (const r of reg) if (!byId.has(r.id)) byId.set(r.id, r);
      for (const r of scanned) if (!byId.has(r.id)) byId.set(r.id, r);

      return [...byId.values()].sort(compareAgentSourceRecords);
    },
  };
}
