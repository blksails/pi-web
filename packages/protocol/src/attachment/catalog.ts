/**
 * pi-web 协议层 — agent 附件目录(agent-attachment-catalog)四种帧 + control 载荷。
 *
 * 与 `agent_routes`/`agent_attachment_profile` 同族的 pi-web 自建 JSONL 帧(不触及外部
 * pi SDK,也不进入 SseFrame 的 uiMessageChunk 判别分支):
 *  - `AgentAttachmentCatalogFrame`:装配期声明帧(agent 子进程 → 主进程,stdout 单次发射)。
 *  - `AttachmentCatalogRequestFrame`:运行期请求帧(主进程 → 子进程,stdin 行),`op` 判别
 *    list(按 query 枚举)/ materialize(按 entryId 惰性物化)两态。
 *  - `AttachmentCatalogResultFrame`:运行期结果帧(子进程 → 主进程,fd1 直写行),按 `id`
 *    回配请求;`ok` 判别成功(entries|attachmentId)/失败(error)。
 *  - `AttachmentEventFrame`:子进程主动推送帧(`publish` 落库后发射),`event` 判别语义。
 *
 * `control:"attachment"` 是 SSE 侧 `ControlPayloadSchema` 的新增判别分支(定义在
 * `transport/sse-frame.ts`,本文件仅导出其载荷 schema 供彼处组合),承载事件帧的主进程
 * 转发投影,非粘性(错过不补,design.md §行为规约)。
 */
import { z } from "zod";
import { AttachmentSchema } from "./attachment-dto.js";

/** 目录条目公开标识格式:会话内稳定,字母/数字开头,允许字母/数字/`.`/`_`/`-`。 */
export const CATALOG_ENTRY_ID_PATTERN = /^[A-Za-z0-9][\w.-]*$/;

/**
 * 目录条目纯数据投影(agent `list` handler 的返回项,经装配期/运行期帧过进程边界)。
 * `version` 为幂等锚的一部分:同 `id` 不同 `version` 视为新内容(子进程重新物化)。
 */
export const CatalogEntryDtoSchema = z.object({
  id: z.string().regex(CATALOG_ENTRY_ID_PATTERN),
  name: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  sizeHint: z.number().int().nonnegative().optional(),
  version: z.string().optional(),
});
export type CatalogEntryDto = z.infer<typeof CatalogEntryDtoSchema>;

/** 装配期 agent→server 一次性声明帧:声明本会话的附件目录可用。 */
export const AgentAttachmentCatalogFrameSchema = z.object({
  type: z.literal("agent_attachment_catalog"),
  available: z.literal(true),
});
export type AgentAttachmentCatalogFrame = z.infer<
  typeof AgentAttachmentCatalogFrameSchema
>;

/** 主进程→子进程 请求帧(stdin 行):list(按 query 枚举)。 */
const CatalogListRequestSchema = z.object({
  type: z.literal("piweb_attachment_catalog_request"),
  id: z.string().min(1),
  op: z.literal("list"),
  query: z.string(),
});

/** 主进程→子进程 请求帧(stdin 行):materialize(按 entryId 惰性物化)。 */
const CatalogMaterializeRequestSchema = z.object({
  type: z.literal("piweb_attachment_catalog_request"),
  id: z.string().min(1),
  op: z.literal("materialize"),
  entryId: z.string().min(1),
});

/** 请求帧判别联合(`op` 判别 list/materialize)。 */
export const AttachmentCatalogRequestFrameSchema = z.discriminatedUnion("op", [
  CatalogListRequestSchema,
  CatalogMaterializeRequestSchema,
]);
export type AttachmentCatalogRequestFrame = z.infer<
  typeof AttachmentCatalogRequestFrameSchema
>;

/**
 * 子进程→主进程 结果帧(fd1 直写行):按 `id` 回配请求。`ok:true` 时按发起请求的 `op`
 * 携带 `entries`(list)或 `attachmentId`(materialize);`ok:false` 携带归一化错误。
 * 两个成功负载字段均可选(而非按 op 再判别),与 `agent_routes` 结果帧同构风格一致,
 * 简化子进程侧构造(调用方按自己发起的 op 只读取对应字段)。
 */
export const AttachmentCatalogResultFrameSchema = z.object({
  type: z.literal("piweb_attachment_catalog_result"),
  id: z.string().min(1),
  ok: z.boolean(),
  entries: z.array(CatalogEntryDtoSchema).optional(),
  attachmentId: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type AttachmentCatalogResultFrame = z.infer<
  typeof AttachmentCatalogResultFrameSchema
>;

/**
 * 子进程→主进程 推送帧(fd1 直写行):agent 经 `publish` 主动落库后发射,`event` 判别语义
 * (v1 仅 `"added"`)。承载完整 {@link AttachmentSchema} 描述符投影(不含字节)。
 */
export const AttachmentEventFrameSchema = z.object({
  type: z.literal("piweb_attachment_event"),
  event: z.literal("added"),
  attachment: AttachmentSchema,
});
export type AttachmentEventFrame = z.infer<typeof AttachmentEventFrameSchema>;

/**
 * SSE `control:"attachment"` 载荷(供 `transport/sse-frame.ts` 的 `ControlPayloadSchema`
 * 判别联合组合)。主进程收到 {@link AttachmentEventFrame} 后按此形状转发给前端,
 * 尾沿节流 ≤1 帧/秒(design.md §行为规约,防风暴)。非粘性:错过不补。
 */
export const AttachmentControlPayloadSchema = z.object({
  control: z.literal("attachment"),
  event: z.literal("added"),
  attachment: AttachmentSchema,
});
export type AttachmentControlPayload = z.infer<
  typeof AttachmentControlPayloadSchema
>;
