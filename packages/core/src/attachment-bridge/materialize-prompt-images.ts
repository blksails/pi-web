/**
 * attachment-mention-vision — 把已落库图像附件物化为 prompt 原生多模态 `images`。
 *
 * 用途：用户 `@attachment:<id>` 或仅传 `attachmentIds` 时，主对话模型（native LLM）
 * 应收到像素，而不仅是文本引用标记。与 `image_vision` 工具无关。
 *
 * 不变式：
 * - 不把 base64 写入消息文本 / 引用标记（文本仍由 injectAttachmentRefs 负责）
 * - 仅 `image/*`；非图 / 未知 / 跨会话 / 读失败 → 跳过（fail-soft）
 * - 与客户端已提供的 `images` 按 data 去重，避免上传路径双份喂图
 */
import type { Attachment, ImageContent } from "@blksails/pi-web-protocol";

/** 只读：head 元数据 + 可选字节流（主进程 AttachmentStore 同形子集）。 */
export interface AttachmentImageSource {
  head(id: string): Promise<Attachment | undefined>;
  /**
   * 取附件字节流。缺省时 materialize 整体 no-op（仅文本引用仍可用）。
   * meta.mimeType 可与 head 交叉校验；以 head 的 mime 为准做 image/* 过滤。
   */
  getReadStream?(
    id: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: { mimeType: string } }>;
}

export interface MaterializePromptImagesInput {
  /** 原始或已解析的用户消息文本（含 `@attachment:` 或规范标记均可）。 */
  readonly messageText: string;
  /** 请求体 attachmentIds（可与消息内 mention 并存）。 */
  readonly attachmentIds?: readonly string[];
  /** 客户端已提供的 vision images（composer 上传路径）。 */
  readonly existingImages?: readonly ImageContent[];
  /** 当前会话 id：跨会话 id 不物化。 */
  readonly sessionId: string;
  readonly store: AttachmentImageSource;
}

/** 从文本中收集附件 id：`@attachment:<id>` 与 `[attachment id=<id> …]`。 */
export function collectAttachmentIdsFromText(messageText: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (id === "" || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const m of messageText.matchAll(/@attachment:([A-Za-z0-9_-]+)/g)) {
    push(m[1] ?? "");
  }
  for (const m of messageText.matchAll(/\[attachment id=([^\s\]]+)/g)) {
    push(m[1] ?? "");
  }
  return ids;
}

/**
 * 合并 body.attachmentIds 与消息内 id，保序去重：先消息出现顺序，再 body 中尚未见过的 id。
 */
export function collectOrderedAttachmentIds(
  messageText: string,
  attachmentIds: readonly string[] | undefined,
): string[] {
  const fromText = collectAttachmentIdsFromText(messageText);
  const seen = new Set(fromText);
  const out = [...fromText];
  if (attachmentIds !== undefined) {
    for (const id of attachmentIds) {
      if (id === "" || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

async function streamToBase64(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("base64");
}

/**
 * 按 id 列表把会话内图像附件物化为裸 base64 ImageContent[]（不含客户端已有图）。
 * 失败 / 非图 / 跨会话一律跳过，永不抛。
 */
export async function materializeAttachmentImages(opts: {
  readonly ids: readonly string[];
  readonly sessionId: string;
  readonly store: AttachmentImageSource;
}): Promise<ImageContent[]> {
  const { ids, sessionId, store } = opts;
  if (store.getReadStream === undefined || ids.length === 0) return [];

  const out: ImageContent[] = [];
  for (const id of ids) {
    try {
      const att = await store.head(id);
      if (att === undefined) continue;
      if (att.sessionId !== sessionId) continue;
      if (!att.mimeType.startsWith("image/")) continue;

      const { stream } = await store.getReadStream(id);
      const data = await streamToBase64(stream);
      if (data.length === 0) continue;
      out.push({ type: "image", data, mimeType: att.mimeType });
    } catch {
      // fail-soft：单张失败不影响整条消息
      continue;
    }
  }
  return out;
}

/**
 * 合并客户端 images 与物化结果：客户端优先，按 `data` 去重后追加物化项。
 * 返回 `undefined` 当最终列表为空（与既有「无 images 不带字段」习惯对齐）。
 */
export function mergePromptImages(
  existing: readonly ImageContent[] | undefined,
  materialized: readonly ImageContent[],
): ImageContent[] | undefined {
  const base = existing === undefined ? [] : [...existing];
  const seen = new Set(base.map((img) => img.data));
  for (const img of materialized) {
    if (seen.has(img.data)) continue;
    seen.add(img.data);
    base.push(img);
  }
  return base.length === 0 ? undefined : base;
}

/**
 * 端到端：从消息文本 + attachmentIds + store 产出应传给 session.prompt 的 images。
 * 不修改 message 文本；调用方仍负责 injectAttachmentRefs。
 */
export async function materializePromptImages(
  input: MaterializePromptImagesInput,
): Promise<ImageContent[] | undefined> {
  const ids = collectOrderedAttachmentIds(
    input.messageText,
    input.attachmentIds,
  );
  const materialized = await materializeAttachmentImages({
    ids,
    sessionId: input.sessionId,
    store: input.store,
  });
  return mergePromptImages(input.existingImages, materialized);
}
