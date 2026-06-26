/**
 * pi 原生派生 — RpcExtensionUIRequest / RpcExtensionUIResponse schema。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   @earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts
 *     · RpcExtensionUIRequest(扩展需要用户输入时发出,以 `method` 区分)
 *     · RpcExtensionUIResponse(对扩展 UI 请求的回复)
 *
 * 注意:RpcExtensionUIResponse 三个分支共用 `type:"extension_ui_response"`,
 * 以负载字段区分(value / confirmed / cancelled),故用 z.union。
 */
import { z } from "zod";

/** pi: RpcExtensionUIRequest(以 `method` 判别) */
export const RpcExtensionUIRequestSchema = z.discriminatedUnion("method", [
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("select"),
    title: z.string(),
    options: z.array(z.string()),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("confirm"),
    title: z.string(),
    message: z.string(),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("input"),
    title: z.string(),
    placeholder: z.string().optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("editor"),
    title: z.string(),
    prefill: z.string().optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("notify"),
    message: z.string(),
    notifyType: z.enum(["info", "warning", "error"]).optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("setStatus"),
    statusKey: z.string(),
    statusText: z.union([z.string(), z.undefined()]),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("setWidget"),
    widgetKey: z.string(),
    widgetLines: z.union([z.array(z.string()), z.undefined()]),
    widgetPlacement: z.enum(["aboveEditor", "belowEditor"]).optional(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("setTitle"),
    title: z.string(),
  }),
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("set_editor_text"),
    text: z.string(),
  }),
  // pi-web 扩展(非 pi d.ts 派生):ctx.ui.custom 在 RPC 模式下是 pi 空操作,由
  // pi-web runner 覆盖为发帧实现(见 spec ctx-ui-custom-bridge)。承载可序列化的
  // 声明式组件描述(注册名 + props),替代不可跨进程序列化的 TUI 工厂。payload 形状
  // 与 web-ext CustomUiPayloadSchema 对齐(此处内联以保持 rpc 层自包含,不反向依赖 web-ext)。
  z.object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.literal("custom"),
    payload: z.object({
      component: z.string().min(1),
      props: z.unknown().optional(),
    }),
  }),
]);
export type RpcExtensionUIRequest = z.infer<typeof RpcExtensionUIRequestSchema>;

/** pi: RpcExtensionUIResponse(共享 type,以负载字段区分) */
export const RpcExtensionUIResponseSchema = z.union([
  z.object({
    type: z.literal("extension_ui_response"),
    id: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("extension_ui_response"),
    id: z.string(),
    confirmed: z.boolean(),
  }),
  z.object({
    type: z.literal("extension_ui_response"),
    id: z.string(),
    cancelled: z.literal(true),
  }),
]);
export type RpcExtensionUIResponse = z.infer<
  typeof RpcExtensionUIResponseSchema
>;
