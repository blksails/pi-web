/**
 * session-engine / translate — translateEvent 纯函数(Functional Core)。
 *
 * 把单个 pi `AgentEvent` 翻译为零或多个 protocol 定义的 `SseFrame`,并返回推进后的
 * 不可变 `TranslationContext`。无 I/O、无进程、无计时器、无可变全局(Req 4.1)。
 * 产出帧一律经 `makeUiMessageChunkFrame`/`makeControlFrame` 携带 `protocolVersion`
 * 且符合 `SseFrameSchema`,不引入额外帧类型(Req 4.11)。未知/不可翻译事件走确定
 * 分支(空 frames),绝不抛出未捕获异常(Req 4.12)。
 *
 * 帧映射(权威 PLAN §4,受 protocol schema 约束):
 *   - agent_start                                 → start(创建 assistant message)
 *   - turn_start                                  → start-step(开 step 边界)
 *   - turn_end                                    → finish-step(闭 step 边界)
 *   - agent_end                                   → finish(终结 assistant message)
 *   - message_update.text_start|delta|end       → text-start | text-delta | text-end
 *   - message_update.thinking_start|delta|end    → reasoning-start | reasoning-delta | reasoning-end
 *   - message_update.error                        → abort(reason=aborted)| error(否则,带 errorText)
 *   - tool_execution_start                        → tool-input-available
 *   - tool_execution_update                       → data-pi-tool-partial(累积替换)
 *   - tool_execution_end                          → tool-output-available
 *   - queue_update                                → data-pi-queue
 *   - compaction_start|end                        → data-pi-compaction
 *   - auto_retry_start|end                        → data-pi-auto-retry
 *   - extension_ui_request                        → control:extension-ui(旁路,非 UIMessage)
 *   - message_start/message_update(其他)/message_end → 仅推进上下文(开/闭 message 与
 *     悬挂的 text/reasoning part),产出空 frames(确定处理)。
 *
 * UiMessageChunkSchema 已对齐 AI SDK v5 的生命周期块(start/start-step/finish-step/
 * finish/error/abort),`useChat` 由 start 创建、由 finish 终结 assistant message。
 * 一次完整流为 start → start-step → text-start → text-delta… → text-end → finish-step
 * → finish(turn 边界以 start-step/finish-step 包裹)。
 */
import type { AgentEvent } from "@pi-web/protocol";
import { makeControlFrame, makeUiMessageChunkFrame } from "@pi-web/protocol";
import type { TranslateResult } from "./translate.types.js";
import {
  closeReasoningPart,
  closeTextPart,
  openMessage,
  openReasoningPart,
  openTextPart,
  type TranslationContext,
} from "./translation-context.js";

/** 无帧产出的确定结果(仅可能推进 ctx)。 */
function none(ctx: TranslationContext): TranslateResult {
  return { frames: [], ctx };
}

/** 翻译 message_update 携带的 assistantMessageEvent 子事件。 */
function translateAssistantMessageEvent(
  ame: Extract<AgentEvent, { type: "message_update" }>["assistantMessageEvent"],
  ctxIn: TranslationContext,
): TranslateResult {
  switch (ame.type) {
    case "text_start": {
      // 若已有悬挂 text part 先关闭(乱序容错),再开新(Req 4.12)。
      const { id, ctx } = openTextPart(closeTextPart(ctxIn));
      return {
        frames: [makeUiMessageChunkFrame({ type: "text-start", id })],
        ctx,
      };
    }
    case "text_delta": {
      // 容错:未见 text_start 即收到 delta → 自动开启一个 text part。
      let ctx = ctxIn;
      const frames = [];
      let id = ctx.openTextPartId;
      if (id === undefined) {
        const opened = openTextPart(ctx);
        id = opened.id;
        ctx = opened.ctx;
        frames.push(makeUiMessageChunkFrame({ type: "text-start", id }));
      }
      frames.push(
        makeUiMessageChunkFrame({ type: "text-delta", id, delta: ame.delta }),
      );
      return { frames, ctx };
    }
    case "text_end": {
      const id = ctxIn.openTextPartId;
      if (id === undefined) return none(ctxIn); // 乱序容错:无开启项则丢弃。
      return {
        frames: [makeUiMessageChunkFrame({ type: "text-end", id })],
        ctx: closeTextPart(ctxIn),
      };
    }
    case "thinking_start": {
      const { id, ctx } = openReasoningPart(closeReasoningPart(ctxIn));
      return {
        frames: [makeUiMessageChunkFrame({ type: "reasoning-start", id })],
        ctx,
      };
    }
    case "thinking_delta": {
      let ctx = ctxIn;
      const frames = [];
      let id = ctx.openReasoningPartId;
      if (id === undefined) {
        const opened = openReasoningPart(ctx);
        id = opened.id;
        ctx = opened.ctx;
        frames.push(makeUiMessageChunkFrame({ type: "reasoning-start", id }));
      }
      frames.push(
        makeUiMessageChunkFrame({
          type: "reasoning-delta",
          id,
          delta: ame.delta,
        }),
      );
      return { frames, ctx };
    }
    case "thinking_end": {
      const id = ctxIn.openReasoningPartId;
      if (id === undefined) return none(ctxIn);
      return {
        frames: [makeUiMessageChunkFrame({ type: "reasoning-end", id })],
        ctx: closeReasoningPart(ctxIn),
      };
    }
    case "error": {
      // 助手消息流错误:reason=aborted → abort 块;否则 → error 块(带 errorText)。
      // 先关闭悬挂的 text/reasoning part 收尾(容错)。
      const ctx = closeReasoningPart(closeTextPart(ctxIn));
      if (ame.reason === "aborted") {
        return {
          frames: [makeUiMessageChunkFrame({ type: "abort" })],
          ctx,
        };
      }
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "error",
            errorText: "assistant message stream error",
          }),
        ],
        ctx,
      };
    }
    // toolcall_*/done/start 子事件无独立 UIMessage chunk(工具走顶层
    // tool_execution_* 事件);确定处理为空 frames。
    default:
      return none(ctxIn);
  }
}

/**
 * 把单个 pi `AgentEvent` 翻译为 protocol 定义的 SSE 帧序列(纯、确定)。
 */
export function translateEvent(
  event: AgentEvent,
  ctx: TranslationContext,
): TranslateResult {
  switch (event.type) {
    case "agent_start":
      // start 块创建 assistant message(useChat 据此建消息)。
      return {
        frames: [makeUiMessageChunkFrame({ type: "start" })],
        ctx: openMessage(ctx),
      };

    case "message_update":
      return translateAssistantMessageEvent(event.assistantMessageEvent, ctx);

    case "tool_execution_start":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "tool-input-available",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.args,
          }),
        ],
        ctx,
      };

    case "tool_execution_update":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-tool-partial",
            data: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              partialResult: event.partialResult,
            },
          }),
        ],
        ctx,
      };

    case "tool_execution_end":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "tool-output-available",
            toolCallId: event.toolCallId,
            output: event.result,
            isError: event.isError,
          }),
        ],
        ctx,
      };

    case "queue_update":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-queue",
            data: { steering: event.steering, followUp: event.followUp },
          }),
        ],
        ctx,
      };

    case "compaction_start":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-compaction",
            data: { phase: "start", reason: event.reason },
          }),
        ],
        ctx,
      };

    case "compaction_end":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-compaction",
            data: {
              phase: "end",
              reason: event.reason,
              ...(event.result?.summary !== undefined
                ? { summary: event.result.summary }
                : {}),
              aborted: event.aborted,
            },
          }),
        ],
        ctx,
      };

    case "auto_retry_start":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-auto-retry",
            data: {
              phase: "start",
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
              errorMessage: event.errorMessage,
            },
          }),
        ],
        ctx,
      };

    case "auto_retry_end":
      return {
        frames: [
          makeUiMessageChunkFrame({
            type: "data-pi-auto-retry",
            data: {
              phase: "end",
              attempt: event.attempt,
              success: event.success,
              ...(event.finalError !== undefined
                ? { errorMessage: event.finalError }
                : {}),
            },
          }),
        ],
        ctx,
      };

    case "extension_ui_request":
      // 旁路 control 帧(非 UIMessage chunk),供前端弹 dialog(Req 4.10)。
      return {
        frames: [
          makeControlFrame({ control: "extension-ui", request: event }),
        ],
        ctx,
      };

    case "turn_start":
      // step 开始边界。
      return {
        frames: [makeUiMessageChunkFrame({ type: "start-step" })],
        ctx,
      };

    case "turn_end":
      // step 结束边界;关闭悬挂的 text/reasoning part 以收尾(容错)。
      return {
        frames: [makeUiMessageChunkFrame({ type: "finish-step" })],
        ctx: closeReasoningPart(closeTextPart(ctx)),
      };

    case "agent_end":
      // finish 块终结 assistant message;关闭悬挂 part 以收尾(容错)。
      return {
        frames: [makeUiMessageChunkFrame({ type: "finish" })],
        ctx: closeReasoningPart(closeTextPart(ctx)),
      };

    case "message_start":
    case "message_end":
    case "session_info_changed":
    case "thinking_level_changed":
      return none(ctx);

    default:
      // 未知/不可翻译事件:确定丢弃,不抛(Req 4.12)。
      return none(ctx);
  }
}
