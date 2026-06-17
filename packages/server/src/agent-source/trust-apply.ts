/**
 * trust → spawnSpec 片段映射(纯函数,Req 5.3–5.7)。
 *
 * | mode   | trust  | 落地                                            |
 * |--------|--------|-------------------------------------------------|
 * | cli    | always | extraArgs += ["--approve"]                      |
 * | cli    | never  | extraArgs += ["--no-approve"]                   |
 * | cli    | ask    | 无信任标志(headless 默认忽略 .pi/)            |
 * | custom | always | 向 runner 传信任决策(PI_WEB_TRUST_PROJECT=1)  |
 * | custom | never  | 不传放行信号                                    |
 * | custom | ask    | 不传放行信号                                    |
 *
 * 任何取值都不抑制 context 文件(AGENTS.md/CLAUDE.md)与全局/用户扩展加载,
 * 且不产生交互提示(Req 5.7)。
 */
import type { AgentMode, TrustDecision, TrustFragment } from "./types.js";

export function applyTrust(mode: AgentMode, trust: TrustDecision): TrustFragment {
  const fragment: TrustFragment = { extraArgs: [], extraEnv: {} };

  if (mode === "cli") {
    if (trust === "always") {
      fragment.extraArgs.push("--approve");
    } else if (trust === "never") {
      fragment.extraArgs.push("--no-approve");
    }
    // ask → 无标志。
    return fragment;
  }

  // custom 模式:仅 always 向 runner 传放行信号;never/ask 不传。
  if (trust === "always") {
    fragment.extraEnv["PI_WEB_TRUST_PROJECT"] = "1";
  }
  return fragment;
}
