/**
 * PiSessionConnection — 对每会话持有唯一 /stream fetch 订阅 + 帧分流。
 *
 * 用注入 fetch 订阅 GET /sessions/:id/stream(可带 headers / Last-Event-ID),经 TextDecoder
 * + parseSse 切帧,对每帧用 @blksails/pi-web-protocol SseFrameSchema.safeParse 校验:
 *   - kind:"uiMessageChunk" → decodeUiMessageChunk → 写入 ChunkStream(喂 AI SDK useChat)
 *   - kind:"control"        → 写入 ControlStore(旁路,不污染消息流)
 * 记录 lastEventId(取 id: 行)供重连;结束帧(uiMessageChunk finish/abort)关闭 ChunkStream;
 * close() abort reader + 清理。同会话仅一条订阅。
 */
import type { UIMessageChunk } from "ai";
import { SseFrameSchema } from "@blksails/pi-web-protocol";
import { parseSse } from "./parse-sse.js";
import { decodeUiMessageChunk } from "./decode-chunk.js";
import { ControlStore } from "./control-store.js";
import { assertProtocolVersion } from "../version.js";
import type { FetchLike } from "../client/request.js";
import { joinUrl } from "../client/request.js";

export interface PiSessionConnectionOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly fetchImpl?: FetchLike;
  readonly headers?: Record<string, string> | Headers;
  /** 解析/版本错误上报(可观测);默认 console.error。 */
  readonly onError?: (error: unknown) => void;
}

interface OpenStreamOptions {
  readonly lastEventId?: string;
  readonly headers?: Record<string, string> | Headers;
}

function mergeHeaders(
  base: Record<string, string> | Headers | undefined,
  extra: Record<string, string> | Headers | undefined,
  lastEventId: string | undefined,
): Headers {
  const h = new Headers();
  const add = (src: Record<string, string> | Headers | undefined): void => {
    if (src instanceof Headers) src.forEach((v, k) => h.set(k, v));
    else if (src !== undefined)
      for (const [k, v] of Object.entries(src)) h.set(k, v);
  };
  add(base);
  add(extra);
  if (lastEventId !== undefined) h.set("Last-Event-ID", lastEventId);
  h.set("accept", "text/event-stream");
  return h;
}

export class PiSessionConnection {
  readonly controlStore = new ControlStore();

  private readonly baseUrl: string;
  private readonly sessionId: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseHeaders: Record<string, string> | Headers | undefined;
  private readonly onError: (error: unknown) => void;

  private _lastEventId: string | undefined;
  private _ended = false;
  private abortController: AbortController | undefined;
  private currentController: ReadableStreamDefaultController<UIMessageChunk> | undefined;
  private subscribed = false;

  constructor(opts: PiSessionConnectionOptions) {
    this.baseUrl = opts.baseUrl;
    this.sessionId = opts.sessionId;
    this.fetchImpl =
      opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseHeaders = opts.headers;
    this.onError =
      opts.onError ??
      ((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[pi-web/react] SSE error", e);
      });
  }

  get lastEventId(): string | undefined {
    return this._lastEventId;
  }

  isEnded(): boolean {
    return this._ended;
  }

  /**
   * 订阅 /stream 并返回 uiMessageChunk 可读流。可带 Last-Event-ID 续流。
   * 同一连接对象一次只持有一条订阅;再次调用会关闭旧订阅再开新订阅。
   */
  openChunkStream(opts?: OpenStreamOptions): ReadableStream<UIMessageChunk> {
    // 关闭可能存在的旧订阅(单订阅不变式)。
    this.closeSubscription();

    const abort = new AbortController();
    this.abortController = abort;
    this.subscribed = true;

    const lastEventId = opts?.lastEventId ?? this._lastEventId;
    const headers = mergeHeaders(this.baseHeaders, opts?.headers, lastEventId);
    const url = joinUrl(
      this.baseUrl,
      `/sessions/${encodeURIComponent(this.sessionId)}/stream`,
    );

    const pump = async (
      controller: ReadableStreamDefaultController<UIMessageChunk>,
    ): Promise<void> => {
      this.currentController = controller;
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers,
          signal: abort.signal,
        });
        if (!res.ok || res.body === null) {
          this.onError(
            new Error(`stream subscribe failed: status ${res.status}`),
          );
          this.safeClose(controller);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSse(buffer);
          buffer = rest;
          for (const ev of frames) {
            const closed = this.handleEvent(ev, controller);
            if (closed) {
              await reader.cancel().catch(() => undefined);
              return;
            }
          }
        }
        // 流自然结束(服务端关闭连接)。
        this.safeClose(controller);
      } catch (err) {
        if (abort.signal.aborted) {
          this.safeClose(controller);
          return;
        }
        this.onError(err);
        this.safeClose(controller);
      }
    };

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        void pump(controller);
      },
      cancel: () => {
        this.closeSubscription();
      },
    });
  }

  /**
   * 开一条持久的「仅 ui-rpc 控制帧」订阅,与 per-prompt 消息流并存(服务端支持并发订阅,
   * 见 sse-response「不影响同会话其他订阅者」)。仅把 `control: ui-rpc` 帧应用到 controlStore
   * (派发给 ui-rpc 监听,按 correlationId 配对),其余帧(消息块 / 其他 control 子类)丢弃——
   * 故不会与 per-prompt 流重复应用 ambient(extension-ui)帧;ui-rpc 帧即便双发也按 correlationId
   * 去重(未知 id 丢弃)。用于**空闲期** Tier3 贡献点(slash/mention 等)的回包投递。
   * 返回 close 函数。
   */
  openControlOnlyStream(): () => void {
    const abort = new AbortController();
    const headers = mergeHeaders(this.baseHeaders, undefined, undefined);
    const url = joinUrl(
      this.baseUrl,
      `/sessions/${encodeURIComponent(this.sessionId)}/stream`,
    );
    const pump = async (): Promise<void> => {
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers,
          signal: abort.signal,
        });
        if (!res.ok || res.body === null) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSse(buffer);
          buffer = rest;
          for (const ev of frames) {
            if (ev.data === "") continue;
            let json: unknown;
            try {
              json = JSON.parse(ev.data);
            } catch {
              continue;
            }
            const result = SseFrameSchema.safeParse(json);
            if (!result.success) continue;
            const frame = result.data;
            if (frame.kind === "control" && frame.payload.control === "ui-rpc") {
              this.controlStore.applyControlFrame(frame.payload);
            }
          }
        }
      } catch {
        // abort / 网络中断:静默(空闲控制流,不影响主流程)。
      }
    };
    void pump();
    return () => abort.abort();
  }

  /**
   * 处理单个解析出的 SSE 事件。返回 true 表示遇结束帧、流已关闭(应停止读取)。
   */
  private handleEvent(
    ev: { data: string; id: string | undefined; event: string | undefined },
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): boolean {
    if (ev.id !== undefined) this._lastEventId = ev.id;
    if (ev.data === "") return false;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(ev.data);
    } catch (err) {
      this.onError(err);
      return false;
    }

    // 版本判定(不兼容显式上报,不静默误解析)。
    if (
      typeof parsedJson === "object" &&
      parsedJson !== null &&
      typeof (parsedJson as Record<string, unknown>)["protocolVersion"] ===
        "string"
    ) {
      try {
        assertProtocolVersion(
          (parsedJson as Record<string, unknown>)["protocolVersion"] as string,
        );
      } catch (err) {
        this.onError(err);
        return false;
      }
    }

    const result = SseFrameSchema.safeParse(parsedJson);
    if (!result.success) {
      this.onError(result.error);
      return false; // 不向可读流注入污染数据
    }
    const frame = result.data;

    if (frame.kind === "control") {
      this.controlStore.applyControlFrame(frame.payload);
      return false;
    }

    // kind === "uiMessageChunk"
    const chunk = decodeUiMessageChunk(frame.chunk);
    controller.enqueue(chunk);
    if (frame.chunk.type === "finish" || frame.chunk.type === "abort") {
      this._ended = true;
      this.safeClose(controller);
      return true;
    }
    return false;
  }

  private safeClose(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    try {
      controller.close();
    } catch {
      // 已关闭,忽略
    }
    if (this.currentController === controller) {
      this.currentController = undefined;
    }
    this.subscribed = false;
  }

  private closeSubscription(): void {
    if (this.abortController !== undefined) {
      this.abortController.abort();
      this.abortController = undefined;
    }
    if (this.currentController !== undefined) {
      try {
        this.currentController.close();
      } catch {
        // 忽略
      }
      this.currentController = undefined;
    }
    this.subscribed = false;
  }

  /** abort reader + 清理监听。卸载/显式关闭会话时调用,避免悬挂连接。 */
  close(): void {
    this.closeSubscription();
  }

  /** 是否已有活动订阅。 */
  get isSubscribed(): boolean {
    return this.subscribed;
  }
}
