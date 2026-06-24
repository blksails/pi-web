/**
 * completion-provider-framework(前端)— 触发符 token 提取器。
 *
 * 各触发符的提取规则不同:`wordTail`(@/$ 词尾非空白)、`lineStart`(/ 行首)。
 * 服务端只下发"触发符 + 规则名",前端按名执行,得出查询串与替换区间。
 */
import type { CompletionTriggerSpec } from "@blksails/pi-web-protocol";

export interface ActiveToken {
  readonly trigger: string;
  readonly query: string;
  /** 替换区间 [start, end):从触发符起到光标。 */
  readonly start: number;
  readonly end: number;
}

function matchWordTail(
  value: string,
  cursor: number,
  trigger: string,
): ActiveToken | null {
  if (cursor <= 0) return null;
  const idx = value.lastIndexOf(trigger, cursor - 1);
  if (idx < 0) return null;
  const after = value.slice(idx + trigger.length, cursor);
  if (after.length > 0 && /\s/.test(after)) return null;
  return { trigger, query: after, start: idx, end: cursor };
}

function matchLineStart(
  value: string,
  cursor: number,
  trigger: string,
): ActiveToken | null {
  if (cursor <= 0) return null;
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  if (value[lineStart] !== trigger) return null;
  const after = value.slice(lineStart + trigger.length, cursor);
  if (after.length > 0 && /\s/.test(after)) return null;
  return { trigger, query: after, start: lineStart, end: cursor };
}

/**
 * 在 value/cursor 处,按活跃触发符规则找出当前活跃 token。
 * 多触发符同时可能匹配时取离光标最近者(互斥让位)。无则 null。
 */
export function findActiveToken(
  specs: readonly CompletionTriggerSpec[],
  value: string,
  cursor: number,
): ActiveToken | null {
  let best: ActiveToken | null = null;
  for (const spec of specs) {
    const m =
      spec.extract === "lineStart"
        ? matchLineStart(value, cursor, spec.trigger)
        : matchWordTail(value, cursor, spec.trigger);
    if (m === null) continue;
    if (best === null || m.start > best.start) best = m;
  }
  return best;
}
