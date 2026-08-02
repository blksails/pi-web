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
 *
 * ★ `openrouter` 刻意从本快照中豁免(design.md 迁移策略表;Req 2.1, 7.6),与
 * pi SDK 实际内置 openrouter 的事实不符——这是本项目层面的例外,而非快照抓取
 * 疏漏。理由:AIGC 静态目录里已有 6 条在用的 `provider: "openrouter"` 条目,
 * 是 pi-web 自己的图像路由键,与 SDK 的同名对话 provider 是两套独立的东西。
 * 若保留为冲突名,键空间合并后这 6 条会撞冲突校验;若归并进 SDK 内置
 * openrouter,图像路由会错误地继承 SDK 的对话 provider 定义。因此豁免,允许
 * 自定义/既有条目使用 `"openrouter"` 这个标识。
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
  // "openrouter" 刻意豁免,不在此列 —— 见下方独立说明(Req 2.1, 7.6)。
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
 * `"ai-gateway": "blksails-ai"` 是本特性**唯一一处真映射**(design.md 迁移策略表;
 * Req 2.2, 2.3, 9.3)。注意与 Req 9.1 的另一处「`ai-gateway`」刻意区分:
 * `settings.json` 的 `defaultProvider: "ai-gateway"` 指的是**对话侧缺省网关实例
 * id**,原样有效、不在此归一之列;这里归一的是**image 侧**历史标识——AIGC 静态
 * 目录里把 BlackSail 自建网关的图像模型标成了 `provider: "ai-gateway"`,与对话侧
 * 的实例 id 撞了同名不同义。键空间合并后二者会被当成同一个 provider,因此把
 * image 侧的 `ai-gateway` 归一到自建网关的当前标识 `blksails-ai`,消除同名不同义。
 *
 * `normalizeLegacyProviderId` 的幂等性不依赖本表是否为空;但本表非空后必须有
 * **非幂等**用例覆盖(即断言归一后的值确实不同于输入),否则把本表清空也不会
 * 让任何单测报红。
 */
export const LEGACY_PROVIDER_ID_MAP: LegacyProviderIdMap = {
  "ai-gateway": "blksails-ai",
};

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

/**
 * 存量**复合键**归一(spec: multi-gateway-providers,任务 7.1;Req 9.1, 9.2, 9.3)。
 *
 * `aigc.json` 的 `visionModel` 等字段存的是 `${provider}/${modelId}` 复合键
 * (design.md「存量兼容」表)。当 provider 段经 {@link normalizeLegacyProviderId} 迁移后
 * (目前唯一真映射是 image 侧 `ai-gateway` → `blksails-ai`),存量存的复合键原样字符串
 * 不再命中归一后的目录条目 —— 存量写着 `ai-gateway/qwen-image` 的值,归一后目录里的
 * 条目已是 `blksails-ai/qwen-image`,直接字符串比较会判定为「未选择」,不是「零迁移」
 * 而是静默失效(tasks.md 任务 7.1 描述的真实缺陷)。
 *
 * 本函数只归一复合键的 **provider 段**(以复合键中**首个** `/` 切分),modelId 段原样
 * 保留 —— modelId 本身可能含 `/`(如 `openrouter/amazon/nova-2-lite-v1` 的 modelId 段是
 * `amazon/nova-2-lite-v1`,research.md §0 的实测样本),故不能按最后一个 `/` 或整体重新
 * 拼装。不含 `/` 的输入(非复合键形态)原样返回。
 *
 * 幂等性与 {@link normalizeLegacyProviderId} 一致:对已归一的复合键再次归一,结果不变。
 */
export function normalizeLegacyCompoundModelKey(
  compoundKey: string,
  legacyMap: LegacyProviderIdMap = LEGACY_PROVIDER_ID_MAP,
): string {
  const slashIndex = compoundKey.indexOf("/");
  if (slashIndex === -1) return compoundKey;
  const provider = compoundKey.slice(0, slashIndex);
  const modelId = compoundKey.slice(slashIndex + 1);
  const normalizedProvider = normalizeLegacyProviderId(provider, legacyMap);
  if (normalizedProvider === provider) return compoundKey;
  return `${normalizedProvider}/${modelId}`;
}
