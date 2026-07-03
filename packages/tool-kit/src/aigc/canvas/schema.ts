/**
 * Canvas 纯 schema / 类型(aigc-canvas · 领域拥有)。
 *
 * **纯模块,无 pi 值导入**(仅 zod),经浏览器安全子路径
 * `@blksails/pi-web-tool-kit/aigc-canvas-schema` 导出,UI 与 agent 双端共享。
 *
 * 定义:
 *  - `CanvasLineage`:派生血缘(`derivedFrom` / `genParams`);写入附件不透明扩展 meta,附件层不解释。
 *  - `GalleryAsset`:画廊资产(仅 `att_` 引用 + 签名 `displayUrl` + 轻量元数据 + 血缘,**无二进制**)。
 *  - `GalleryState`:surface 快照(`control:"state"` 的 value,key=`surface:canvas`;newest-first)。
 *  - A 档命令 args(`Edit`/`Inpaint`/`Reference`/`Variants`/`Outpaint`/`Reframe`)。
 *  - B 档回流 `Register` / 视图收敛 `Sync` / 删除 `Delete` args。
 *
 * 不变量:命令 args 与快照**只承载 `att_` 引用 + 文本参数**,base64 / 二进制永不进帧(Req 8)。
 */
import { z } from "zod";

/** 血缘:领域拥有;写入附件不透明 meta,附件层不解释。 */
export const CanvasLineageSchema = z.object({
  /** 源 att_id(根节点无)。 */
  derivedFrom: z.string().optional(),
  /** 产出该图的命令参数(供参数复用)。 */
  genParams: z.unknown().optional(),
});
export type CanvasLineage = z.infer<typeof CanvasLineageSchema>;

/** 画廊资产:仅引用 + 轻量元数据,无二进制(Bulk 走 `displayUrl`)。 */
export const GalleryAssetSchema = z.object({
  attachmentId: z.string(),
  /** 签名 URL(既有 HMAC),二进制旁路。 */
  displayUrl: z.string(),
  mimeType: z.string(),
  name: z.string(),
  createdAt: z.string(),
  origin: z.enum(["upload", "tool-output"]),
  derivedFrom: z.string().optional(),
  genParams: z.unknown().optional(),
});
export type GalleryAsset = z.infer<typeof GalleryAssetSchema>;

/**
 * 生成中的**临时渐进预览指示**(流式 partial_images「由糊变清」)。
 *
 * ⚠️ **刻意不承载图像二进制**(守「base64/二进制永不进帧」不变量,Req 8):渐进图**若**内联进快照,
 * 生成期(busy turn)大帧经 fd1 `writeSync` 会与 pi RPC 并发大帧交织损坏(JSONL 半行)→ 被丢弃。
 * 故快照仅带**阶段标识**(轻量帧),Canvas 据此渲染「生成中·由糊变清」指示;**完整渐进图由对话流工具卡
 * 承载**(经 pi 稳健 RPC 通道,4:6 布局下与 Canvas 并列可见)。`displayUrl` 保留为可选:仅当可提供**小
 * 尺寸**(缩略图 / att_ 签名 URL,不触发大帧)预览时才带。
 */
export const LivePreviewSchema = z.object({
  /** 可选小尺寸预览(缩略图 data URI 或 att_ 签名 URL);缺省则 UI 显示占位指示。**勿放大图 data URI**。 */
  displayUrl: z.string().optional(),
  /** 阶段:`partial`=渐进中;`finalizing`=已出终图、正在落库。 */
  stage: z.enum(["partial", "finalizing"]),
  /** 触发的命令动作(`edit`/`inpaint`/… 展示用)。 */
  action: z.string().optional(),
});
export type LivePreview = z.infer<typeof LivePreviewSchema>;

/** surface 快照(`control:"state"` 的 value,key=`surface:canvas`)。 */
export const GalleryStateSchema = z.object({
  /** newest-first。 */
  assets: z.array(GalleryAssetSchema),
  /** 生成中的临时渐进预览;空闲时省略 / null。 */
  livePreview: LivePreviewSchema.nullish(),
});
export type GalleryState = z.infer<typeof GalleryStateSchema>;

// ── A 档命令 args(仅 att_ 引用 + 文本,无二进制,Req 8)───────────────────────────

/** `edit`:整图指令编辑。 */
export const EditArgsSchema = z.object({
  image: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  size: z.string().optional(),
  n: z.number().int().min(1).max(10).optional(),
});
export type EditArgs = z.infer<typeof EditArgsSchema>;

/** `inpaint`:局部重绘(alpha mask PNG,OpenAI images/edits 标准:透明 alpha=0 = 编辑区,不透明 = 保留)。 */
export const InpaintArgsSchema = EditArgsSchema.extend({ mask: z.string() });
export type InpaintArgs = z.infer<typeof InpaintArgsSchema>;

/** `reference`:参考图融合。 */
export const ReferenceArgsSchema = EditArgsSchema.extend({
  reference_images: z.array(z.string()).min(1),
});
export type ReferenceArgs = z.infer<typeof ReferenceArgsSchema>;

/** `variants`:多变体(可跨多模型)。 */
export const VariantsArgsSchema = EditArgsSchema.extend({
  n: z.number().int().min(1).max(10),
  models: z.array(z.string()).optional(),
});
export type VariantsArgs = z.infer<typeof VariantsArgsSchema>;

/** `outpaint`:扩图(扩展画布 mask + prompt / size)。 */
export const OutpaintArgsSchema = z.object({
  image: z.string(),
  mask: z.string().optional(),
  prompt: z.string(),
  size: z.string().optional(),
  model: z.string().optional(),
});
export type OutpaintArgs = z.infer<typeof OutpaintArgsSchema>;

/** `reframe`:比例重构。 */
export const ReframeArgsSchema = z.object({
  image: z.string(),
  size: z.string(),
  prompt: z.string().optional(),
  model: z.string().optional(),
});
export type ReframeArgs = z.infer<typeof ReframeArgsSchema>;

// ── B 档回流 / 视图收敛 / 删除 ─────────────────────────────────────────────────

/** `register`:B 档客户端产物(已落 att_)登记进画廊。 */
export const RegisterArgsSchema = z.object({
  attachmentId: z.string(),
  derivedFrom: z.string().optional(),
  genParams: z.unknown().optional(),
});
export type RegisterArgs = z.infer<typeof RegisterArgsSchema>;

/** `sync`:重新枚举 attachment store 收敛画廊(无参)。 */
export const SyncArgsSchema = z.object({}).optional();
export type SyncArgs = z.infer<typeof SyncArgsSchema>;

/** `delete`:从快照移除资产。 */
export const DeleteArgsSchema = z.object({ attachmentId: z.string() });
export type DeleteArgs = z.infer<typeof DeleteArgsSchema>;

/** 画廊资产列表的空快照(默认值下沉工厂;避免跨会话共享引用)。 */
export function emptyGalleryState(): GalleryState {
  return { assets: [] };
}
