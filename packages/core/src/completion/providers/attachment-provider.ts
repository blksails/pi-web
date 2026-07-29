/**
 * attachment-mention-completion — attachment provider(trigger `@`, kind `attachment`)。
 *
 * complete: `store.listBySession(ctx.sessionId)` 取本会话附件(origin upload/tool-output),
 *           按 query 对附件名子序列模糊匹配,映射为 `@attachment:<id>` 候选;列举抛错/空会话 → 空数组。
 * resolve(v1): `@attachment:<id>` → 仅当 `head(id)` 命中且 `att.sessionId === ctx.sessionId`
 *           时复用 `buildAttachmentRefs([att])` 产出规范引用标记;否则 null(框架保留原文降级)。
 *
 * 会话隔离:complete/resolve 均以 `ctx.sessionId` 为唯一会话来源;resolve 额外校验归属,
 * 杜绝跨会话引用/枚举。仅产出文本标记,绝不内联附件字节(守「base64 仅具名出口」不变式)。
 */
import type { Attachment, CompletionItem } from "@blksails/pi-web-protocol";
import type {
  CompletionCtx,
  CompletionProvider,
  CompletionRef,
  ResolvedContext,
} from "../types.js";
import { serializeToken } from "../token.js";
import { buildAttachmentRefs } from "../../attachment-bridge/reference-injection.js";

export const ATTACHMENT_PROVIDER_ID = "attachment";
export const ATTACHMENT_KIND = "attachment";

/**
 * provider 仅依赖 AttachmentStore 的只读子集,便于单测注入存根并窄化依赖。
 * `listBySession` 须已按会话隔离;`head` 全局按 id 查,会话归属由 resolve 二次校验。
 */
export interface AttachmentLister {
  listBySession(sessionId: string): Promise<readonly Attachment[]>;
  head(id: string): Promise<Attachment | undefined>;
  /**
   * 可选:签发某附件的分发展示 URL(根相对 `/attachments/:id/raw?exp&sig`)。
   * 提供时,图片类附件候选携带 `previewUrl` 供补全浮层渲染缩略图(attachment-mention-preview)。
   */
  presignUrl?(id: string): Promise<string>;
}

/** 字节数 → 人类可读(B/KB/MB/GB,1024 进制,≤1 位小数)。 */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    unit === 0 ? value : Math.round(value * 10) / 10;
  // 整数不显示 ".0"(如 128 KB 而非 128.0 KB)。
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** 子序列模糊匹配(大小写不敏感)。空 query 视为全部命中。 */
function nameMatches(name: string, query: string): boolean {
  if (query === "") return true;
  const hay = name.toLowerCase();
  const needle = query.toLowerCase();
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** 创建 attachment provider。 */
export function createAttachmentProvider(
  store: AttachmentLister,
): CompletionProvider {
  return {
    id: ATTACHMENT_PROVIDER_ID,
    trigger: "@",
    kind: ATTACHMENT_KIND,
    extract: "wordTail",
    priority: 0,

    async complete({ query, ctx }): Promise<readonly CompletionItem[]> {
      let attachments: readonly Attachment[];
      try {
        attachments = await store.listBySession(ctx.sessionId);
      } catch {
        return []; // 列举失败 → 补全降级为空,不阻断 UI
      }
      const items: CompletionItem[] = [];
      for (const att of attachments) {
        if (!nameMatches(att.name, query)) continue;
        // 图片类附件:签发展示 URL 作缩略图预览(attachment-mention-preview);
        // 签发失败 / 非图片 / 无 presignUrl 能力 → 不带 previewUrl(浮层退化为纯文本行)。
        let previewUrl: string | undefined;
        if (store.presignUrl !== undefined && att.mimeType.startsWith("image/")) {
          try {
            previewUrl = await store.presignUrl(att.id);
          } catch {
            previewUrl = undefined;
          }
        }
        items.push({
          providerId: ATTACHMENT_PROVIDER_ID,
          kind: ATTACHMENT_KIND,
          id: att.id,
          label: att.name,
          detail: `${att.mimeType} · ${humanSize(att.size)}`,
          insertText: serializeToken({
            trigger: "@",
            kind: ATTACHMENT_KIND,
            id: att.id,
          }),
          ...(previewUrl !== undefined ? { previewUrl } : {}),
        });
      }
      return items;
    },

    async resolve(
      ref: CompletionRef,
      ctx: CompletionCtx,
    ): Promise<ResolvedContext | null> {
      const att = await store.head(ref.id);
      if (att === undefined || att.sessionId !== ctx.sessionId) {
        return null; // 未命中 / 跨会话 → 降级保留原文(框架据此保留 token)
      }
      return { text: buildAttachmentRefs([att]) };
    },
  };
}
