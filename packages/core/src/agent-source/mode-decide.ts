/** 模式判定(纯函数,Req 4.1/4.2/1.6)。 */
import { createLogger } from "@blksails/pi-web-logger";
import type { AgentMode, EntryProbe } from "./types.js";

// 命名空间 agent:resolve —— 与 resolver 同域,记录 custom vs pi --mode rpc 的判定细节。
const modeLog = createLogger({ namespace: "agent:resolve" });

/** 有入口 → custom;无入口(含缺省 source)→ cli。 */
export function decideMode(entry: EntryProbe): AgentMode {
  const mode: AgentMode = entry.kind === "entry" ? "custom" : "cli";
  modeLog.debug("mode decided", {
    mode,
    reason: entry.kind === "entry" ? "entry found → custom" : "no entry → cli (pi --mode rpc)",
  });
  return mode;
}
