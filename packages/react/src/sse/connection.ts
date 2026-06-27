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
import { createLogger } from "@blksails/pi-web-logger";
import type { Sink } from "@blksails/pi-web-logger";

export interface PiSessionConnectionOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly fetchImpl?: FetchLike;
  readonly headers?: Record<string, string> | Headers;
  /**
   * 解析/版本/网络错误上报(可注入覆盖,向后兼容);若提供则优先使用覆盖而非默认 logger。
   * 默认经 createLogger({ namespace: "core:sse" }).error 产出(浏览器 sink→总线→面板)。
   */
  readonly onError?: (error: unknown) => void;
  /**
   * 注入 logger 的 sink(仅测试用);未注入时使用默认 sink (node: stderr / browser: bus)。
   */
  readonly loggerSink?: Sink;
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
    if (opts.onError !== undefined) {
      this.onError = opts.onError;
    } else {
      const _logger = createLogger({
        namespace: "core:sse",
        ...(opts.loggerSink !== undefined ? { sink: opts.loggerSink } : {}),
      });
      this.onError = (e: unknown) => {
        _logger.error(
          e instanceof Error ? e.message : "[pi-web/react] SSE error",
          e,
        );
      };
    }
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
   * 开一条持久的「控制帧」订阅,与 per-prompt 消息流并存(服务端支持并发订阅,见 sse-response
   * 「不影响同会话其他订阅者」)。默认把 `control: ui-rpc`(Tier3 回包,按 correlationId 配对)与
   * `control: session-status`(就绪握手粘性帧)应用到 controlStore,其余帧(消息块 / 其他 control
   * 子类)丢弃——故不会与 per-prompt 流重复应用 ambient(extension-ui)帧。用于**空闲期** Tier3
   * 贡献点(slash/mention 等)的回包投递,以及就绪握手期会话状态的投递(使迟到订阅经粘性回放获知就绪)。
   *
   * `applyAmbient: true` 时额外应用 `control: extension-ui`(ctx.ui notify/status/widget)帧:用于
   * **fire-and-forget 扩展命令**(/plugin 等)——它不开 per-prompt 流,故 ctx.ui 帧本无消费者;此时由本
   * 流承载。调用方须保证仅在空闲期(无 per-prompt 流)启用,避免与 per-prompt 流重复应用 ambient 帧。
   * 返回 close 函数。
   */
  openControlOnlyStream(opts?: { applyAmbient?: boolean }): () => void {
    const applyAmbient = opts?.applyAmbient === true;
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
            // 空闲控制流默认应用 ui-rpc(Tier3 回包)与 session-status(就绪握手粘性帧);
            // applyAmbient 时额外应用 extension-ui(fire-and-forget 扩展命令的 ctx.ui 帧)。
            // 其余帧丢弃,避免与 per-prompt 流重复应用 ambient(extension-ui)帧。
            if (
              frame.kind === "control" &&
              (frame.payload.control === "ui-rpc" ||
                frame.payload.control === "session-status" ||
                (applyAmbient && frame.payload.control === "extension-ui"))
            ) {
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
