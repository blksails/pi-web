/**
 * completion-provider-framework — 提交期 token 解析。
 *
 * 扫描消息中的补全 token,按 kind 分发对应 provider 的 resolve,把 token 替换为
 * 解析文本。无对应 provider / provider 无 resolve / resolve 抛错或返回 null →
 * 保留原始 token 文本(不阻断发送)。无 token → 原样返回。
 */
import type { CompletionCtx } from "./types.js";
import type { CompletionRegistry } from "./registry.js";
import { tokenMatches } from "./token.js";

/** 解析 message 中的补全 token,返回重写后的文本(位置式重写,前缀 token 不互污)。 */
export async function resolveCompletions(
  message: string,
  ctx: CompletionCtx,
  registry: CompletionRegistry,
): Promise<string> {
  const matches = tokenMatches(message);
  if (matches.length === 0) return message;

  // 逐 token 解析为替换文本;无 provider/无 resolve/抛错 → 保留 raw。
  const texts = await Promise.all(
    matches.map(async (m) => {
      const provider = registry.findByKind(m.kind);
      if (provider?.resolve === undefined) return m.raw;
      try {
        const resolved = await provider.resolve(m, ctx);
        return resolved?.text ?? m.raw;
      } catch {
        return m.raw;
      }
    }),
  );

  // 按匹配位置顺序拼接(matchAll 已按出现顺序、互不重叠)。
  let out = "";
  let last = 0;
  matches.forEach((m, i) => {
    out += message.slice(last, m.index) + texts[i];
    last = m.index + m.length;
  });
  out += message.slice(last);
  return out;
}
