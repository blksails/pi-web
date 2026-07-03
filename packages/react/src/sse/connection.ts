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
  /**
   * 解析于「本轮 /stream 订阅已在服务端建立」之后(见 whenSubscribed)。初始为 resolved,
   * 每次 openChunkStream 重建;pump 收到响应(或失败/中断降级)时 resolve。
   */
  private _subscribeReady: Promise<void> = Promise.resolve();

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
   * 解析于「本轮 /stream 订阅已在服务端建立」之后:收到 GET /stream 响应即证明服务端已
   * subscribe()(SSE 响应的 ReadableStream.start() 在响应构造/handler return 前同步执行
   * subscribe)。PiTransport.sendMessages 在 POST prompt 之前 await 本 promise,消除
   * 「prompt 早于订阅到达服务端 → 本轮回复帧在无订阅者窗口被广播而永久丢失」的竞态。
   * 订阅失败/中断亦 resolve(降级为旧行为,不挂起调用方)。
   */
  whenSubscribed(): Promise<void> {
    return this._subscribeReady;
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

    // 本轮订阅就绪信号:收到 GET /stream 响应即证明服务端已 subscribe()
    // (SSE 响应的 ReadableStream.start() 在响应构造/handler return 前同步执行 subscribe)。
    let signalSubscribed: () => void = () => {};
    this._subscribeReady = new Promise<void>((resolve) => {
      signalSubscribed = resolve;
    });
    let subscribeSignaled = false;
    const markSubscribed = (): void => {
      if (subscribeSignaled) return;
      subscribeSignaled = true;
      signalSubscribed();
    };

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
          markSubscribed(); // 降级:失败也放行 prompt,不挂起调用方
          this.safeClose(controller);
          return;
        }
        // 收到响应=服务端订阅已建立;放行 sendMessages 去 POST prompt。
        markSubscribed();
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
          markSubscribed(); // 中断降级:放行调用方
          this.safeClose(controller);
          return;
        }
        this.onError(err);
        markSubscribed();
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
            // 空闲控制流默认应用 ui-rpc(Tier3 回包)、session-status(就绪握手粘性帧)、
            // session-state(权威快照粘性帧,session-snapshot-authority)与 state(状态注入桥/
            // agent-authoritative-surface 的下行镜像粘性帧);applyAmbient 时额外应用 extension-ui。
            // 其余帧丢弃,避免与 per-prompt 流重复应用 ambient(extension-ui)帧。
            // session-state/state 安全可放:busy 转换与 state 变更主要经 per-prompt 流投递(handleEvent
            // 应用全部 control 帧),空闲流转发仅为让就绪前/空闲/重连客户端经粘性回放收敛。
            // state 尤其关键:surface 命令(agent-authoritative-surface / aigc-canvas)在**空闲期**
            // 触发,其权威快照回流帧(control:"state",key=surface:<domain>)只能由本空闲流承载——
            // 漏放会令 slot 组件收不到快照更新(增量停在初值 / 画廊种子不 hydrate)。
            if (
              frame.kind === "control" &&
              (frame.payload.control === "ui-rpc" ||
                frame.payload.control === "session-status" ||
                frame.payload.control === "session-state" ||
                frame.payload.control === "state" ||
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
