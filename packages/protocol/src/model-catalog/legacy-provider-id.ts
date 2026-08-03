/**
 * provider 标识的**存量归一表**(multi-gateway-providers 任务 4.0)。
 *
 * ## 为什么住在 protocol 而不是 core
 *
 * 归一表必须是**单一事实源** —— 同一个 provider 在不同层用不同键空间比对,正是本 spec
 * 要根治的那类缺陷。而消费方分居依赖图两侧:
 *
 *   - `@blksails/pi-web-core` 的目录服务(条目投影 + hidden 过滤)
 *   - `@blksails/pi-web-tool-kit` 的 AIGC 扩展(工具侧可用模型的 hidden 过滤)
 *
 * tool-kit **不依赖** core(且不该依赖:core 是服务端内核,tool-kit 跑在 agent 子进程)。
 * 两者共同依赖的最内层是 protocol,故归一表落在这里;core 的
 * `model-catalog/provider-identity.ts` 原样再导出,既有 import 点无需改动。
 *
 * ★ 曾经的失效模式(第七批完整性批评 gap 1 实测):目录端点按**归一后**的
 *   `blksails-ai` 过滤隐藏名单,而工具侧按**归一前**的 `ai-gateway` 过滤同一份
 *   `PI_WEB_HIDE_PROVIDERS`。两个方向都出错 ——
 *   `PI_WEB_HIDE_PROVIDERS=blksails-ai` 让模型「界面看不见但工具照常能跑」,
 *   `PI_WEB_HIDE_PROVIDERS=ai-gateway` 则「界面列着但工具跑不了」。
 */

/** 历史标识 → 当前标识的映射表形状。 */
export type LegacyProviderIdMap = Readonly<Record<string, string>>;

/**
 * 存量 provider 标识的归一表 —— **当前为空**。
 *
 * ## 为什么是空的(2026-08-03)
 *
 * 本表曾有唯一一条 `"ai-gateway" → "blksails-ai"`:AIGC 静态目录把网关图像模型标成了
 * `provider: "ai-gateway"`,与**对话侧缺省网关实例 id** 撞了同名不同义,归一用于拆开二者。
 *
 * 该冲突现已在**源头**消除 —— `AI_GATEWAY_AIGC_CATALOG` 的三条条目直接声明
 * `provider: "cloudflare"`(用户决策),不再产出 `ai-gateway`。源头改对之后再留着这条映射
 * 是有害的:它不映射任何现存条目(纯死数据),却会让**将来**任何写了 `ai-gateway` 的
 * image 条目被静默改名成 `blksails-ai` —— 一个如今只是「某部署的对话侧实例 id」的名字。
 *
 * ## 表为空 ≠ 机制无用
 *
 * 归一的**调用点**(`toImageCatalogModel` 的条目投影、`imageEntries()` 与工具侧
 * `hiddenModelIds()` 的隐藏名单比对)一律保留:它们保证目录端点与工具侧**始终处于同一
 * 键空间**。这条不变式曾被打破过一次(目录侧比归一后、工具侧比归一前,导致隐藏名单两个
 * 方向都失效),不能因为表暂时为空就把机制拆掉 —— 表一旦再加条目,缝就会立刻重开。
 *
 * ## 再加条目时的硬要求
 *
 * `normalizeLegacyProviderId` 的幂等性不依赖本表是否为空;但本表**一旦非空**,必须补一条
 * **非幂等**用例(断言归一后的值确实不同于输入),否则把本表清空也不会让任何单测报红。
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
