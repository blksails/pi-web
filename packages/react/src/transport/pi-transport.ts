/**
 * PiTransport — AI SDK v5 ChatTransport 实现。
 *
 * sendMessages:经 client.prompt POST /sessions/:id/messages 提交 prompt;确保 /stream 已订阅;
 *   返回连接的 UIMessageChunk 可读流。透传 headers/body;abortSignal 触发即取消订阅并收束流。
 * reconnectToStream:带连接记录的 lastEventId(Last-Event-ID)重订阅 /stream 续流;
 *   会话已结束/不存在 → 返回 null(不挂起)。
 *
 * 仅依赖 Web Fetch 与 AI SDK 类型;不持服务端真值状态。
 */
import type { ImageContent } from "@pi-web/protocol";
import { ImageContentSchema } from "@pi-web/protocol";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";

export interface PiTransportOptions {
  readonly sessionId: string;
  readonly client: PiClient;
  readonly connection: PiSessionConnection;
}

interface SendMessagesOptions<MESSAGE extends UIMessage> {
  readonly trigger: "submit-message" | "regenerate-message";
  readonly chatId: string;
  readonly messageId: string | undefined;
  readonly messages: MESSAGE[];
  readonly abortSignal: AbortSignal | undefined;
  readonly headers?: Record<string, string> | Headers;
  readonly body?: object;
  readonly metadata?: unknown;
}

interface ReconnectOptions {
  readonly chatId: string;
  readonly headers?: Record<string, string> | Headers;
  readonly body?: object;
  readonly metadata?: unknown;
}

const ImageContentArraySchema = ImageContentSchema.array();

/**
 * 从 useChat 透传的 body/metadata 中提取图片附件,映射为 pi 的 `images`。
 *
 * 来源约定(见 design.md「PiTransport(附件映射)」):图片经 useChat
 * `sendMessage` 的 `body.images` 或 `metadata.images` 传入(`useAttachments.toImageContents`
 * 产出的 `ImageContent[]`)。优先 body,其次 metadata;两者皆缺或解析失败 →
 * 不带 `images`(与现状一致)。
 */
function extractImages(
  body: object | undefined,
  metadata: unknown,
): ImageContent[] | undefined {
  for (const source of [body, metadata]) {
    if (source === null || typeof source !== "object") continue;
    const raw = (source as { images?: unknown }).images;
    if (raw === undefined) continue;
    const parsed = ImageContentArraySchema.safeParse(raw);
    if (parsed.success && parsed.data.length > 0) return parsed.data;
  }
  return undefined;
}

/**
 * 从 useChat 透传的 body/metadata 中提取正式附件 id 列表,映射为 pi 的 `attachmentIds`。
 *
 * 来源约定:正式落库附件的公开 id(`att_<nanoid>`)经 useChat `sendMessage` 的
 * `body.attachmentIds` 或 `metadata.attachmentIds` 传入。优先 body,其次 metadata;
 * 校验为非空 `string[]`,非法/缺失/空数组 → 不带 `attachmentIds`。与 `images`/vision 并存。
 */
function extractAttachmentIds(
  body: object | undefined,
  metadata: unknown,
): string[] | undefined {
  for (const source of [body, metadata]) {
    if (source === null || typeof source !== "object") continue;
    const raw = (source as { attachmentIds?: unknown }).attachmentIds;
    if (raw === undefined) continue;
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((id) => typeof id === "string")
    ) {
      return raw as string[];
    }
  }
  return undefined;
}

/** 从 UIMessage 数组取最后一条 user message 的纯文本。 */
function extractPromptText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg === undefined || msg.role !== "user") continue;
    const text = msg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    return text;
  }
  return "";
}

export class PiTransport<MESSAGE extends UIMessage = UIMessage>
  implements ChatTransport<MESSAGE>
{
  private readonly sessionId: string;
  private readonly client: PiClient;
  private readonly connection: PiSessionConnection;

  constructor(opts: PiTransportOptions) {
    this.sessionId = opts.sessionId;
    this.client = opts.client;
    this.connection = opts.connection;
  }

  sendMessages = async (
    options: SendMessagesOptions<MESSAGE>,
  ): Promise<ReadableStream<UIMessageChunk>> => {
    const message = extractPromptText(options.messages);
    const images = extractImages(options.body, options.metadata);
    const attachmentIds = extractAttachmentIds(options.body, options.metadata);

    // 先建立 /stream 订阅,再 POST prompt,避免错过早到的帧。
    const stream = this.connection.openChunkStream(
      options.headers === undefined ? undefined : { headers: options.headers },
    );

    if (options.abortSignal !== undefined) {
      if (options.abortSignal.aborted) {
        this.connection.close();
      } else {
        options.abortSignal.addEventListener(
          "abort",
          () => this.connection.close(),
          { once: true },
        );
      }
    }

    await this.client.prompt(this.sessionId, {
      message,
      ...(images === undefined ? {} : { images }),
      ...(attachmentIds === undefined ? {} : { attachmentIds }),
    });

    return stream;
  };

  reconnectToStream = async (
    options: ReconnectOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> => {
    void options;
    // 会话已结束 → 无可续流。
    if (this.connection.isEnded()) return null;

    // 确认会话仍存在;不存在(404)→ 视为无可续流返回 null,不挂起。
    try {
      await this.client.getState(this.sessionId);
    } catch {
      return null;
    }

    const lastEventId = this.connection.lastEventId;
    return this.connection.openChunkStream(
      lastEventId === undefined
        ? undefined
        : { lastEventId },
    );
  };
}
