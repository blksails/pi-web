/**
 * model-catalog · provider 标识的校验与冲突检测规则(spec: multi-gateway-providers,
 * 任务 1.1;design.md「core / ProviderIdentity」组件块;Req 1.4, 2.2, 7.6, 9.3)。
 *
 * provider 标识是全系统的连接键(目录条目、registry 注册名、`settings.json` 的
 * `defaultProvider`、hidden 名单四处必须逐字一致)。本模块是其唯一事实源:
 * - **合法形态**:小写字母、数字、连字符,不以连字符起止(Req 7.6 的校验前半段)。
 * - **保留名冲突**:自定义标识不得与 pi SDK 内置 provider 同名,避免「同一个 provider
 *   有两处凭证入口」(Req 2.2/7.6)。
 * - **冲突检测**:两个来源声明同一 id 时,返回**全部**冲突项及其来源,而非遇到
 *   第一个即停(Req 1.4)——供装配层在启动期一次性报出全部问题。
 * - **存量归一**:把历史标识映射到当前标识,函数本身幂等(Req 9.3)。
 *
 * 纯函数模块:零 IO、零 env 读取、零 pi SDK 值导入(保留名清单是手工维护的字面量
 * 快照——见下方 `RESERVED_PROVIDER_IDS` 的来源说明,而非运行时导入 pi SDK)。
 */

/** provider 标识的合法形态:小写字母、数字、连字符;不以连字符起止。 */
export type ProviderId = string & { readonly __brand: "ProviderId" };

/** `validateProviderId` 的返回形态:合法则携带品牌化后的 id,非法则给出可读原因。 */
export type ProviderIdValidation =
  | { readonly ok: true; readonly id: ProviderId }
  | { readonly ok: false; readonly reason: string };

/** 一批 id 的来源标注,供 `findProviderIdConflicts` 聚合冲突。 */
export interface ProviderIdSource {
  readonly id: string;
  /** 该 id 的来源标注(如来源 sourceId、配置文件路径、网关实例名等)。 */
  readonly source: string;
}

/** 一个冲突 id 及其**全部**来源(长度 ≥ 2)。 */
export interface ProviderIdConflict {
  readonly id: string;
  readonly sources: readonly string[];
}

/** 存量标识 → 当前标识的归一表。 */
export type LegacyProviderIdMap = Readonly<Record<string, string>>;

const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * pi SDK 内置 provider 名快照(用于保留名冲突校验,Req 2.2/7.6)。
 *
 * 来源:`@earendil-works/pi-coding-agent` 的 `dist/core/provider-display-names.js`
 * `BUILT_IN_PROVIDER_DISPLAY_NAMES` 键集合(2026-07-31 抓取,pi SDK 0.80.3)。
 * 该常量未经包的公开 `exports` 字段导出,core 包又刻意零 pi SDK 值导入
 * (`@earendil-works/pi-coding-agent` 是 optional peer dep),因此只能维护一份
 * 手工快照而非运行时导入 —— pi SDK 升级新增内置 provider 时需手工同步本列表。
 */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "anthropic",
  "amazon-bedrock",
  "ant-ling",
  "azure-openai-responses",
  "cerebras",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "deepseek",
  "fireworks",
  "google",
  "google-vertex",
  "groq",
  "huggingface",
  "kimi-coding",
  "mistral",
  "minimax",
  "minimax-cn",
  "moonshotai",
  "moonshotai-cn",
  "nvidia",
  "opencode",
  "opencode-go",
  "openai",
  "openrouter",
  "together",
  "vercel-ai-gateway",
  "xai",
  "zai",
  "zai-coding-cn",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
]);

/**
 * 校验字面量是否为合法的 provider id;不合法时给出可读原因。
 *
 * 校验分两层:形态合法(小写字母/数字/连字符,不以连字符起止)与保留名冲突
 * (不得与 `RESERVED_PROVIDER_IDS` 同名)。任一层失败即返回 `ok: false`。
 */
export function validateProviderId(raw: string): ProviderIdValidation {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "provider id 不能为空" };
  }
  if (!PROVIDER_ID_PATTERN.test(raw)) {
    return {
      ok: false,
      reason: "provider id 只能包含小写字母、数字与连字符,且不能以连字符开头或结尾",
    };
  }
  if (RESERVED_PROVIDER_IDS.has(raw)) {
    return {
      ok: false,
      reason: `provider id "${raw}" 与 pi SDK 内置 provider 同名,请改用其他标识`,
    };
  }
  return { ok: true, id: raw as ProviderId };
}

/**
 * 检测一批(id, source)条目中的重复 id,返回**全部**冲突项及其**全部**来源
 * (Req 1.4)——不是遇到第一个冲突就停,也不是每个冲突只报两个来源中的一个。
 *
 * 未冲突(该 id 只出现一次)的条目不出现在返回结果中。
 */
export function findProviderIdConflicts(
  entries: readonly ProviderIdSource[],
): readonly ProviderIdConflict[] {
  const sourcesById = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = sourcesById.get(entry.id);
    if (existing) {
      existing.push(entry.source);
    } else {
      sourcesById.set(entry.id, [entry.source]);
    }
  }

  const conflicts: ProviderIdConflict[] = [];
  for (const [id, sources] of sourcesById) {
    if (sources.length > 1) {
      conflicts.push({ id, sources });
    }
  }
  return conflicts;
}

/**
 * 存量归一表:把历史 provider 标识映射到当前标识。
 *
 * 本特性引入时尚无需要迁移的已知记录 ——「默认网关实例沿用旧名 `ai-gateway`」
 * 是刻意保留、不是需要迁移的标识变化(design.md 迁移策略表)。后续任务如有确切
 * 的迁移场景(如 AIGC 侧去重),在此追加映射项即可;`normalizeLegacyProviderId`
 * 的幂等性不依赖本表是否为空。
 */
export const LEGACY_PROVIDER_ID_MAP: LegacyProviderIdMap = {};

/**
 * 存量归一:把历史标识映射到当前标识;无映射时原样返回。
 *
 * 幂等(Req 9.3):对同一输入反复调用,结果不再变化——即便归一表含链式映射
 * (a→b→c)也会一次性追至链尾,且对自环/循环映射有防护,不会死循环。
 *
 * @param legacyMap 默认使用模块内置的 `LEGACY_PROVIDER_ID_MAP`;显式传入以支持
 *   调用方(或测试)注入自定义归一表。
 */
export function normalizeLegacyProviderId(
  raw: string,
  legacyMap: LegacyProviderIdMap = LEGACY_PROVIDER_ID_MAP,
): string {
  const visited = new Set<string>();
  let current = raw;
  while (!visited.has(current)) {
    const next = legacyMap[current];
    if (next === undefined) break;
    visited.add(current);
    current = next;
  }
  return current;
}
