/**
 * pi-web 自定义传输层 — SSE 顶层帧 schema(两类 + 版本承载)。
 *
 * 两类帧(以 `kind` 判别):
 *   - kind: "uiMessageChunk" → 内嵌 UiMessageChunk(text/reasoning/tool/data-part),直接喂 AI SDK。
 *   - kind: "control"        → 旁路控制事件,覆盖 extension-ui / queue / stats / error(内层以 `control` 再判别)。
 *
 * 每帧含 `protocolVersion` 字段(引用 version.ts 的 protocolVersion),供前后端握手与流式协商。
 * 依赖方向:transport 仅可依赖 version、zod 与 web-ext 的 ui-rpc 控制载荷(Tier3 下行响应)。
 */
import { z } from "zod";
import { protocolVersion } from "../version.js";
import { UiMessageChunkSchema } from "./ui-message-chunk.js";
import { UiRpcControlPayloadSchema } from "../web-ext/ui-rpc.js";

/** control 帧负载:旁路控制事件,以 `control` 判别(含 web-ext 的 ui-rpc 下行响应)。 */
export const ControlPayloadSchema = z.discriminatedUnion("control", [
  // extension UI 请求走旁路(非 UIMessage),前端弹 dialog 后回 /ui-response。
  z.object({
    control: z.literal("extension-ui"),
    request: z.object({}).passthrough(),
  }),
  z.object({
    control: z.literal("queue"),
    steering: z.array(z.string()),
    followUp: z.array(z.string()),
  }),
  z.object({
    control: z.literal("stats"),
    stats: z.object({}).passthrough(),
  }),
  z.object({
    control: z.literal("error"),
    message: z.string(),
    code: z.string().optional(),
  }),
  // Tier3 UI↔agent RPC 下行响应(按 correlationId 配对上行 REST 请求)。
  UiRpcControlPayloadSchema,
]);
export type ControlPayload = z.infer<typeof ControlPayloadSchema>;

const UiMessageChunkFrameSchema = z.object({
  kind: z.literal("uiMessageChunk"),
  protocolVersion: z.string(),
  chunk: UiMessageChunkSchema,
});

const ControlFrameSchema = z.object({
  kind: z.literal("control"),
  protocolVersion: z.string(),
  payload: ControlPayloadSchema,
});

/** SSE 顶层帧:以 `kind` 判别 uiMessageChunk 与 control 两类。 */
export const SseFrameSchema = z.discriminatedUnion("kind", [
  UiMessageChunkFrameSchema,
  ControlFrameSchema,
]);
export type SseFrame = z.infer<typeof SseFrameSchema>;

/**
 * 用当前 protocolVersion 包装一个 uiMessageChunk 帧的便捷构造器(纯函数、无副作用)。
 * 仅作形状辅助;实际编码/传输归 http-api。
 */
export function makeUiMessageChunkFrame(
  chunk: z.infer<typeof UiMessageChunkSchema>,
): SseFrame {
  return { kind: "uiMessageChunk", protocolVersion, chunk };
}

/** 同上,control 帧便捷构造器。 */
export function makeControlFrame(payload: ControlPayload): SseFrame {
  return { kind: "control", protocolVersion, payload };
}
