/** 信任策略(Req 5.1/5.2/8.2)。默认返回 "ask";可被 ResolveOptions.trustPolicy 覆盖。 */
import type { ResolveOptions, TrustDecision } from "./types.js";

/** 默认策略:headless 安全默认 —— 不无脑全开。 */
export function defaultTrustPolicy(_source: string): TrustDecision {
  return "ask";
}

/** 解析最终采用的策略(注入优先)。 */
export function resolveTrustPolicy(
  opts: ResolveOptions,
): (source: string) => TrustDecision {
  return opts.trustPolicy ?? defaultTrustPolicy;
}
