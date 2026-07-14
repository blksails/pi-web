/**
 * catalog-provider — agent 附件目录补全 provider(spec agent-attachment-catalog,
 * 任务 4.1;Req 2.1, 2.2, 2.4, 3.2, 5.4)。
 *
 * complete: 声明未缓存(`attachmentCatalogAvailable === false`)→ 零往返直接空数组;
 *           否则经会话 `requestCatalog({op:"list",query})` 索取,约 700ms 上限(留框架
 *           800ms per-provider 超时余量,design.md §决策)——超时/错误/`ok:false` 一律降级
 *           为空数组,绝不冒错(既有框架超时降级语义之外的额外一层保险)。
 * resolve:  提交期兜底物化通路(design.md「主路径 = accept 时物化;兜底 = resolve 同一通路」):
 *           `requestCatalog({op:"materialize",entryId})` → 成功按标准 `buildAttachmentRefs`
 *           产出文本标记(与普通附件同等待遇,Req 4.4);失败/超时 → `null`(框架保留原文,
 *           不构成失效引用)。
 *
 * 会话隔离:`ctx.sessionId` 是 list/materialize 的唯一会话来源(session getter 按此索取),
 * 与 attachment-provider 同语义。
 */
import type { Attachment, AttachmentCatalogResultFrame, CompletionItem } from "@blksails/pi-web-protocol";
import type {
  CompletionCtx,
  CompletionProvider,
  CompletionRef,
  ResolvedContext,
} from "../types.js";
import { serializeToken } from "../token.js";
import { buildAttachmentRefs } from "../../attachment-bridge/reference-injection.js";

export const CATALOG_PROVIDER_ID = "attachment-catalog";
export const CATALOG_KIND = "catalog";

/** provider.complete 内部的 list 索取时限(design.md §决策:留框架 800ms 余量)。 */
const CATALOG_LIST_TIMEOUT_MS = 700;

/** provider 仅依赖会话的只读子集(list/materialize 索取 + 可用性门控)。 */
export interface CatalogSource {
  readonly attachmentCatalogAvailable: boolean;
  requestCatalog(
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string },
    timeoutMs?: number,
  ): Promise<AttachmentCatalogResultFrame>;
}

/** provider 仅依赖 AttachmentStore 的只读子集(resolve 兜底构造引用标记所需)。 */
export interface CatalogAttachmentLister {
  head(id: string): Promise<Attachment | undefined>;
}

/** 创建 catalog 补全 provider。 */
export function createCatalogProvider(
  getSession: (sessionId: string) => CatalogSource | undefined,
  attachments: CatalogAttachmentLister,
): CompletionProvider {
  return {
    id: CATALOG_PROVIDER_ID,
    trigger: "@",
    kind: CATALOG_KIND,
    extract: "wordTail",
    priority: 0,

    async complete({ query, ctx }): Promise<readonly CompletionItem[]> {
      const session = getSession(ctx.sessionId);
      if (session === undefined || !session.attachmentCatalogAvailable) {
        return []; // 未声明 → 零往返(Req 1.2 结构性零变化,亦免 700ms 空等)
      }
      let result: AttachmentCatalogResultFrame;
      try {
        result = await session.requestCatalog({ op: "list", query }, CATALOG_LIST_TIMEOUT_MS);
      } catch {
        return []; // 超时/转发失败 → 降级为空(Req 2.4,不影响其他 provider)
      }
      if (!result.ok || result.entries === undefined) return [];
      return result.entries.map((entry) => {
        const item: CompletionItem = {
          providerId: CATALOG_PROVIDER_ID,
          kind: CATALOG_KIND,
          id: entry.id,
          label: entry.name,
          insertText: serializeToken({ trigger: "@", kind: CATALOG_KIND, id: entry.id }),
        };
        const detail = entry.description ?? entry.mimeType;
        if (detail !== undefined) item.detail = detail;
        return item;
      });
    },

    async resolve(
      ref: CompletionRef,
      ctx: CompletionCtx,
    ): Promise<ResolvedContext | null> {
      const session = getSession(ctx.sessionId);
      if (session === undefined) return null;
      let result: AttachmentCatalogResultFrame;
      try {
        result = await session.requestCatalog({ op: "materialize", entryId: ref.id });
      } catch {
        return null; // 超时/转发失败 → 降级(框架保留原文,不构成失效引用,Req 3.4)
      }
      if (!result.ok || result.attachmentId === undefined) return null;
      const att = await attachments.head(result.attachmentId);
      if (att === undefined) return null;
      return { text: buildAttachmentRefs([att]) };
    },
  };
}
