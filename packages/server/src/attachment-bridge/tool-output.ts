/**
 * attachment-tool-bridge · tool-output 落库回流 `putToolOutput`
 * (task 3.3;Req 7.1, 7.2, 7.3, 7.4)。
 *
 * tool 产出的新文件**先落库再以引用回流**:经上游 {@link AttachmentStore} 门面 `put`
 * (来源固定 `"tool-output"`)写入对象存储、由门面铸造公开 `att_` id(先落 blob 后描述符,
 * 失败时门面回滚已落 blob、绝不暴露半落库引用),再以 `presignUrl` 签发展示 URL,
 * 返回**不含字节**的回流引用 {@link ToolOutputRef}。
 *
 * 设计约束(design.md §tool-output / §Components and Interfaces · tool-output):
 * - **同一 id 空间**:经**同一** `put` 写入(枚举已含 `tool-output`),产出 `att_` id 与上传 id
 *   同一空间 → 可被后续用户消息以相同引用方式再次引用、可被 `resolveAttachment` 再次解析(Req 7.2)。
 * - **引用而非内联字节**:回流物为 `{ attachmentId, displayUrl, name, mimeType }`,**不含 bytes/base64**,
 *   展示侧经既有 `/raw` 分发 URL 呈现(Req 7.3)。base64 不在此出口物化(守不变式)。
 * - **先落库后引用**:`put` 由门面保证先落 blob 后写描述符;落库失败由门面抛错,此处**不构造引用**,
 *   而以可 `instanceof` 识别的 {@link ToolOutputPutError} 向上抛,使 tool `execute` 据此标失败、
 *   绝不回流半落库或不存在的引用(Req 7.4)。
 * - **origin 固定**:`origin:"tool-output"` 在此固定,不重定义上游 `PutInput`;`size` 由字节长度内部计算。
 */
import type { AttachmentStore } from "../attachment/attachment-store.js";

/**
 * `putToolOutput` 入参:产出字节 + 描述符元数据(`origin` 在内部固定为 `"tool-output"`,
 * `size` 由 `bytes.length` 内部计算,故入参不含此二者)。
 */
export interface PutToolOutputInput {
  /** 产出物字节(已物化的 `Uint8Array`)。 */
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
  /** 所属会话 id(描述符属主;与发起该 tool 调用的会话一致)。 */
  readonly sessionId: string;
}

/**
 * tool-output 回流引用:**不含字节**,仅承载公开 id 与展示 URL(及类型/文件名),
 * 供 tool 以引用回流到对话、展示侧经 `/raw` 分发 URL 呈现(Req 7.3)。
 */
export interface ToolOutputRef {
  /** 产出附件的公开 id(`att_<nanoid>`;与上传 id 同一空间,Req 7.2)。 */
  readonly attachmentId: string;
  /** 客户端可达展示 URL(上游 `presignUrl` 签发,与分发签名同形,Req 7.3)。 */
  readonly displayUrl: string;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * 落库失败错误:产出物写入对象存储失败时抛出(Req 7.4)。
 *
 * 可经 `instanceof` 识别、是 `Error` 子类、经 `cause` 携带门面 `put` 抛出的原始错误,
 * 使 tool `execute` 能据此以 `details` 标失败,而非回流半落库/不存在的引用。
 * 风格与上游可识别错误(`BlobNotFoundError`/`AttachmentResolveError`)一致。
 */
export class ToolOutputPutError extends Error {
  constructor(cause: unknown) {
    super(
      `tool output not persisted: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
    this.name = "ToolOutputPutError";
  }
}

/**
 * 把 tool 产出物先落库(来源 `"tool-output"`)再以引用回流(Req 7.1/7.2/7.3/7.4)。
 *
 * 成功 → 返回**不含字节**的 {@link ToolOutputRef}(公开 id + 展示 URL);
 * 门面 `put` 抛错(落库失败)→ 抛 {@link ToolOutputPutError},**不返回引用**、不暴露半落库引用。
 *
 * @param store 子进程 store 客户端(上游 {@link AttachmentStore} 门面);经其 `put` 落库、`presignUrl` 签发。
 * @param input 产出字节 + 元数据(`origin`/`size` 内部决定)。
 * @returns 回流引用 {@link ToolOutputRef}。
 * @throws {ToolOutputPutError} 落库失败(门面 `put` 抛错);此时不构造也不返回任何引用。
 */
export async function putToolOutput(
  store: AttachmentStore,
  input: PutToolOutputInput,
): Promise<ToolOutputRef> {
  // 1) 先落库:经同一门面 put 写入,origin 固定 tool-output、size 由字节长度计算。
  //    门面 put 保证先落 blob 后写描述符、失败回滚 → 此处不必处理半落库,仅在失败时不构造引用。
  let attachmentId: string;
  try {
    const att = await store.put({
      bytes: input.bytes,
      name: input.name,
      mimeType: input.mimeType,
      size: input.bytes.length,
      sessionId: input.sessionId,
      origin: "tool-output",
    });
    attachmentId = att.id;
  } catch (cause) {
    // 落库失败 → 不构造引用,抛可识别失败(Req 7.4)。
    throw new ToolOutputPutError(cause);
  }

  // 2) 后引用:已落库才签发展示 URL,以引用(不含字节)回流(Req 7.3)。
  const displayUrl = await store.presignUrl(attachmentId);
  return {
    attachmentId,
    displayUrl,
    name: input.name,
    mimeType: input.mimeType,
  };
}
