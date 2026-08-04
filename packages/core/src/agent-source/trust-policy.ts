/** 信任策略(Req 5.1/5.2/8.2)。默认返回 "ask";可被 ResolveOptions.trustPolicy 覆盖。 */
import type { ResolveOptions, TrustDecision, TrustPolicy, TrustPolicyInput } from "./types.js";

/**
 * 旧契约:按 `source` 字符串的信任策略默认。
 * 仅供扩展安装 / 重载的 trust-landing 子系统(extensions/*)使用——那是独立流程,
 * 以会话 source 为键,不在本次 `.pi/` 初始加载链路内。保持不变以免破坏既有调用。
 */
export function defaultTrustPolicy(_source: string): TrustDecision {
  return "ask";
}

/** agent-source resolver 的信任策略默认:headless 安全默认 —— 不无脑全开。 */
export function defaultResolverTrustPolicy(_input: TrustPolicyInput): TrustDecision {
  return "ask";
}

/** 解析 resolver 最终采用的策略(注入优先,缺省安全默认)。 */
export function resolveTrustPolicy(opts: ResolveOptions): TrustPolicy {
  return opts.trustPolicy ?? defaultResolverTrustPolicy;
}
