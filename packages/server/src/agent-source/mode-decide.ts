/** 模式判定(纯函数,Req 4.1/4.2/1.6)。 */
import type { AgentMode, EntryProbe } from "./types.js";

/** 有入口 → custom;无入口(含缺省 source)→ cli。 */
export function decideMode(entry: EntryProbe): AgentMode {
  return entry.kind === "entry" ? "custom" : "cli";
}
