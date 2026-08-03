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
]);
export type RpcExtensionUIRequest = z.infer<typeof RpcExtensionUIRequestSchema>;

/** 全部 extension-ui 请求 method(自 schema 判别键推导,新增分支自动纳入)。 */
export type ExtensionUIMethod = RpcExtensionUIRequest["method"];

/**
 * **需用户回包**的交互类 method —— 单一权威(spec session-meta-index, Req 7.2)。
 *
 * 为何需要这份清单:服务端 `PiSession.handleExtensionUIRequest` 把**所有** extension-ui 请求
 * 无条件登记进挂起表,其中推送类(见下)永不回包、永久滞留。故「挂起表非空」**不等于**
 * 「会话在等用户」——判定会话活跃态必须先按本集合过滤,否则任何发过 `notify` 的会话会永久
 * 显示「等待用户交互」。
 *
 * 前端 `control-store.routeExtensionUi` 用同一套二分(交互类入 FIFO 对话框队列、推送类写
 * ambient 切片)。两处清单必须一致,由 `test/rpc/extension-ui-methods.test.ts` 的差集守卫锁住:
 * 新增一个 method 而不归类,守卫即红。
 */
export const INTERACTIVE_EXTENSION_UI_METHODS = [
  "select",
  "confirm",
  "input",
  "editor",
] as const satisfies readonly ExtensionUIMethod[];

/** **无需回包**的推送类 method(与交互类互补,合起来穷尽 method 全集)。 */
export const PUSH_EXTENSION_UI_METHODS = [
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
] as const satisfies readonly ExtensionUIMethod[];

export type InteractiveExtensionUIMethod =
  (typeof INTERACTIVE_EXTENSION_UI_METHODS)[number];

/** 某 method 是否属交互类(需用户回包)。未知 method 归为非交互(失败安全:不误报等待)。 */
export function isInteractiveExtensionUIMethod(
  method: string,
): method is InteractiveExtensionUIMethod {
  return (INTERACTIVE_EXTENSION_UI_METHODS as readonly string[]).includes(method);
}

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
