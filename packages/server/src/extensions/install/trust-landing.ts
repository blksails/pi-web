/**
 * extension-management — 信任落地映射(纯函数,Req 6.1–6.6/10.1)。
 *
 * 调用注入的 `trustPolicy(source)`(消费 agent-source-resolver,默认 "ask")得到
 * `TrustDecision`,再经 agent-source-resolver 的 `applyTrust(mode, decision)` 映射为
 * `TrustFragment`(cli:`--approve`;custom:`PI_WEB_TRUST_PROJECT=1`)。
 *
 * - `always` + cli → extraArgs `["--approve"]`。
 * - `always` + custom → extraEnv `PI_WEB_TRUST_PROJECT=1`。
 * - `ask`/`never` → 空放行片段(headless 默认忽略 `.pi/` 项目资源,Req 6.3/6.5)。
 * - 任何取值都不抑制 context 文件(AGENTS.md/CLAUDE.md)与全局/用户扩展(Req 6.4)——
 *   片段仅"加项"放行 `.pi/`,从不下达抑制信号。
 *
 * 本层仅"消费"上游决策与映射,不重定义默认值或决策算法(Req 6.6)。
 */
import { applyTrust, defaultTrustPolicy } from "../../agent-source/index.js";
import type {
  AgentMode,
  TrustDecision,
  TrustFragment,
} from "../ext.types.js";

/**
 * 计算给定来源在给定会话模式下的信任片段。
 *
 * @param source     原始来源标识。
 * @param mode       会话模式(cli/custom)。
 * @param trustPolicy 注入的信任策略;缺省 agent-source-resolver 的默认("ask")。
 */
export function landTrust(
  source: string,
  mode: AgentMode,
  trustPolicy: (source: string) => TrustDecision = defaultTrustPolicy,
): TrustFragment {
  const decision = trustPolicy(source);
  return applyTrust(mode, decision);
}
