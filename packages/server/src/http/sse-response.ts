/**
 * http-api — SSE `Response` 构造 + 心跳 + 连接关闭清理(Req 5.1/5.3/5.4/5.5/5.6)。
 *
 * 用 Web `ReadableStream` 桥接 `PiSession.subscribe(onFrame, onEnd)`:`start` 时订阅,
 * `onFrame` 经 `encodeFrame` enqueue,`onEnd` 写 control 结束帧并 close;`node:timers`
 * 周期 enqueue 心跳注释帧;`cancel`(客户端断开)时清心跳并 unsubscribe(不影响他者)。
 *
 * 响应头:`Content-Type: text/event-stream`、`Cache-Control: no-cache`、
 * `Connection: keep-alive`、`X-Accel-Buffering: no`、`Content-Encoding: identity`(禁压缩)。
 *
 * 重连续流(Req 6.x):`Last-Event-ID` 仅用作续号起点;网关不缓存历史帧,重连即重新
 * `subscribe()` 续推后续帧。会话已结束在 router/stream-route 层判定并返回明确响应。
 */
import { makeControlFrame, protocolVersion, type SseFrame } from "@blksails/protocol";
import type { PiSession } from "../session/index.js";
import type { SessionEndReason } from "../session/index.js";
import { PROTOCOL_VERSION_HEADER } from "./error-map.js";
import { encodeFrame, encodeHeartbeat } from "./sse-encoder.js";

/** 默认心跳间隔。 */
export const DEFAULT_HEARTBEAT_MS = 15_000;

interface BuildSseOptions {
  readonly session: PiSession;
  /** 续号起点(来自 Last-Event-ID);新连接为 0。 */
  readonly startSeq: number;
  readonly heartbeatMs?: number;
}

/** 构造 SSE `Response`,把会话帧流编码为 event-stream 长连接。 */
export function buildSseResponse(opts: BuildSseOptions): Response {
  const { session } = opts;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const encoder = new TextEncoder();
  let seq = opts.startSeq;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // 控制器已关闭:忽略。
        }
      };

      const onFrame = (frame: SseFrame): void => {
        enqueue(encodeFrame(frame, seq));
        seq += 1;
      };

      const onEnd = (reason: SessionEndReason): void => {
        const endFrame = makeControlFrame({
          control: "error",
          message: `session ended: ${reason}`,
          code: reason,
        });
        enqueue(encodeFrame(endFrame, seq));
        seq += 1;
        cleanup();
        try {
          controller.close();
        } catch {
          // 已关闭:忽略。
        }
      };

      const cleanup = (): void => {
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        if (unsubscribe !== undefined) {
          unsubscribe();
          unsubscribe = undefined;
        }
      };

      const handle = session.subscribe(onFrame, onEnd);
      unsubscribe = () => handle.unsubscribe();

      if (heartbeatMs > 0 && Number.isFinite(heartbeatMs)) {
        const timer = setInterval(() => enqueue(encodeHeartbeat()), heartbeatMs);
        if (typeof timer.unref === "function") timer.unref();
        heartbeat = timer;
      }
    },
    cancel() {
      // 客户端断开:清心跳 + unsubscribe(不影响同会话其他订阅者,Req 5.6)。
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      if (unsubscribe !== undefined) {
        unsubscribe();
        unsubscribe = undefined;
      }
    },
  });

  const headers = new Headers();
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  headers.set("Content-Encoding", "identity");
  headers.set(PROTOCOL_VERSION_HEADER, protocolVersion);

  return new Response(stream, { status: 200, headers });
}

/** 解析 `Last-Event-ID` 为续号起点(无效/缺失→0,Req 6.1/6.2)。 */
export function parseLastEventId(req: Request): number {
  const raw = req.headers.get("Last-Event-ID");
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n + 1 : 0;
}
