/**
 * pi-web 自定义传输层 — UIMessage data-part schema(pi 特有)。
 *
 * 背景:pi 的若干事件无法映射到 AI SDK v5 的标准 UIMessage part,需以自定义
 * `data-*` part 承载(见 PLAN.md §4 翻译表)。四类:
 *   - data-pi-queue        ← queue_update(steering / followUp 队列)
 *   - data-pi-compaction   ← compaction_start/end(顶部状态条)
 *   - data-pi-auto-retry   ← auto_retry_start/end(顶部状态条)
 *   - data-pi-ui           ← agent 声明的 server-driven UI(UiSpec,见 ui-spec.ts)
 *
 * 注:tool_execution_update 的累积 partialResult 不再走独立 data part,而是翻译为
 * `tool-output-available` + `preliminary: true` 喂进 PiToolPart 的 update 态
 * (避免在消息流里另起一堆裸 JSON 卡片;见 translate-event.ts)。
 *
 * 每类带可辨识 `type`,供前端按类型分发渲染器(registerDataPartRenderer)。
 * 这是 pi-web 自定义契约(非 pi 原生派生),与 rpc/* 分层。
 */
import { z } from "zod";
import { UiSpecSchema } from "./ui-spec.js";

export const QueueDataPartSchema = z.object({
  type: z.literal("data-pi-queue"),
  data: z.object({
    steering: z.array(z.string()),
    followUp: z.array(z.string()),
  }),
});
export type QueueDataPart = z.infer<typeof QueueDataPartSchema>;

export const CompactionDataPartSchema = z.object({
  type: z.literal("data-pi-compaction"),
  data: z.object({
    phase: z.enum(["start", "end"]),
    reason: z.enum(["manual", "threshold", "overflow"]),
    summary: z.string().optional(),
    aborted: z.boolean().optional(),
  }),
});
export type CompactionDataPart = z.infer<typeof CompactionDataPartSchema>;

export const AutoRetryDataPartSchema = z.object({
  type: z.literal("data-pi-auto-retry"),
  data: z.object({
    phase: z.enum(["start", "end"]),
    attempt: z.number(),
    maxAttempts: z.number().optional(),
    delayMs: z.number().optional(),
    success: z.boolean().optional(),
    errorMessage: z.string().optional(),
  }),
});
export type AutoRetryDataPart = z.infer<typeof AutoRetryDataPartSchema>;

/** agent 声明的 server-driven UI(承载 UiSpec:内置白名单组件 / 沙箱组件)。 */
export const UiDataPartSchema = z.object({
  type: z.literal("data-pi-ui"),
  data: UiSpecSchema,
});
export type UiDataPart = z.infer<typeof UiDataPartSchema>;

/**
 * ctx.ui.custom 的声明式渲染描述(注册名 + props)。
 * ← extension_ui_request{method:"custom"} 经 translateEvent 转译(见 spec ctx-ui-custom-bridge)。
 * 前端 CustomUiDataPart/CustomUiRenderer 按注册名查表渲染,未注册降级占位。
 * data 形状与 web-ext CustomUiPayloadSchema 对齐(内联以避免 transport→web-ext 反向依赖)。
 */
export const CustomUiDataPartSchema = z.object({
  type: z.literal("data-pi-custom-ui"),
  data: z.object({
    component: z.string().min(1),
    props: z.unknown().optional(),
  }),
});
export type CustomUiDataPart = z.infer<typeof CustomUiDataPartSchema>;

/** pi 特有 data-part 联合,以 `type`(data-pi-*)判别。 */
export const DataPartSchema = z.discriminatedUnion("type", [
  QueueDataPartSchema,
  CompactionDataPartSchema,
  AutoRetryDataPartSchema,
  UiDataPartSchema,
  CustomUiDataPartSchema,
]);
export type DataPart = z.infer<typeof DataPartSchema>;
