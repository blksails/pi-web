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
      ...(options.body ?? {}),
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
