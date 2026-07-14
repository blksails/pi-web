/**
 * attachment-tool-bridge · pi `Agent` tool hook 的 narrowing + 组合纯逻辑
 * (`composeBeforeToolCall` / `composeAfterToolCall`)。
 *
 * SRP/DIP 收口:把「pi hook context → 闸门入参的 narrowing」与「与既有 hook 的组合语义」
 * 从 runner 接线(`wireAttachmentBridge`)剥离为纯函数。本模块**不触碰** runtime / agent 实例,
 * 只把闸门(`beforeGuard`/`afterGate`)与既有 hook 组合成新 hook,故可脱离真实 pi Agent 独立单测。
 *
 * ## narrowing 适配
 *
 * pi 内层 `BeforeToolCallContext`/`AfterToolCallContext`(属 `@earendil-works/pi-agent-core`,
 * 本仓库刻意不直接依赖)以**同形**本地接口描述本模块实际消费的字段
 * (`toolCall.name`/`toolCall.id`/`args`/`result.content`/`result.details`)。字段同形、无语义转换。
 *
 * ## 组合语义(不覆盖既有)
 *
 * `AgentSession._installAgentToolHooks()` 已把 `beforeToolCall`/`afterToolCall` 装为「路由到扩展
 * tool_call/tool_result 处理器」。本模块**组合**(compose)而非覆盖:
 *  - before:闸门 `block` 优先(不进既有 hook / execute);否则委托既有 hook。
 *  - after:既有 hook 先改写 → 以改写后的 content/details 为剥离输入 → 叠加 base64 剥离;
 *    闸门无改写则透传既有 hook 结果。
 */
import type { ToolCallGuardEvent } from "../attachment-bridge/ownership-guard.js";
import type {
  AfterToolCallGuardEvent,
  ToolResultContent,
} from "../attachment-bridge/base64-gate.js";

/** pi `Agent.beforeToolCall` context 的最小同形视图。 */
export interface PiBeforeToolCallContext {
  readonly toolCall: { readonly name: string; readonly id: string };
  readonly args: unknown;
}
/** pi `Agent.afterToolCall` context 的最小同形视图。 */
export interface PiAfterToolCallContext {
  readonly toolCall: { readonly name: string; readonly id: string };
  readonly args: unknown;
  readonly result: { readonly content: unknown; readonly details?: unknown };
  readonly isError: boolean;
}
export interface PiBeforeToolCallResult {
  block?: boolean;
  reason?: string;
}
export interface PiAfterToolCallResult {
  content?: ToolResultContent[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
export type PiBeforeToolCall = (
  context: PiBeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<PiBeforeToolCallResult | undefined>;
export type PiAfterToolCall = (
  context: PiAfterToolCallContext,
  signal?: AbortSignal,
) => Promise<PiAfterToolCallResult | undefined>;

/** pi `Agent` 上本模块组合的两个 hook 属性的最小可写视图。 */
export interface HookableAgent {
  beforeToolCall?: PiBeforeToolCall;
  afterToolCall?: PiAfterToolCall;
}

/** 属主校验闸门(`makeBeforeToolCall` 返回)的结构型签名。 */
export type BeforeGuardFn = (
  event: ToolCallGuardEvent,
) => Promise<{ block?: boolean; reason?: string } | undefined>;
/** base64 剥离出口(`makeAfterToolCall` 返回)的结构型签名。 */
export type AfterGateFn = (
  event: AfterToolCallGuardEvent,
) => Promise<{ content?: ToolResultContent[] } | undefined>;

/** unknown → 非空 `Record` 判定(narrowing 守卫)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * pi tool result `content`(`(TextContent|ImageContent)[]`,同形)→ 闸门 `ToolResultContent[]`。
 * content 来自 pi 内层不可达类型,以同形结构断言(字段一致:`type`/`text`/`data`/`mimeType`)。
 */
export function toToolResultContent(
  content: unknown,
): readonly ToolResultContent[] {
  return Array.isArray(content) ? (content as ToolResultContent[]) : [];
}

/**
 * 组合执行前闸门(属主校验)与既有 `beforeToolCall`。闸门阻断优先,否则委托既有 hook。
 */
export function composeBeforeToolCall(
  beforeGuard: BeforeGuardFn,
  priorBefore: PiBeforeToolCall | undefined,
): PiBeforeToolCall {
  return async (context, signal) => {
    // narrowing:pi BeforeToolCallContext → 闸门 ToolCallGuardEvent(字段同形,零转换)。
    const guardEvent: ToolCallGuardEvent = {
      toolName: context.toolCall.name,
      toolCallId: context.toolCall.id,
      // args 为已校验工具参数对象;非对象(理论不至)退化为空对象使闸门放行无附件引用调用。
      input: isRecord(context.args) ? context.args : {},
    };
    const blocked = await beforeGuard(guardEvent);
    // 闸门阻断优先:不进入既有 hook / execute(Req 5.1)。
    if (blocked?.block === true) {
      return {
        block: true,
        ...(blocked.reason !== undefined ? { reason: blocked.reason } : {}),
      };
    }
    // 放行 → 委托既有 hook(保留扩展 tool_call 链)。
    return priorBefore ? priorBefore(context, signal) : undefined;
  };
}

/**
 * 组合结果出口闸门(base64 剥离)与既有 `afterToolCall`。既有 hook 先改写,再叠加剥离。
 */
export function composeAfterToolCall(
  afterGate: AfterGateFn,
  priorAfter: PiAfterToolCall | undefined,
): PiAfterToolCall {
  return async (context, signal) => {
    // 先跑既有 hook(扩展 tool_result 链)拿其可能的改写;以改写后的 content/details 为剥离输入。
    const prior = priorAfter ? await priorAfter(context, signal) : undefined;

    const effectiveContent =
      prior?.content !== undefined
        ? prior.content
        : toToolResultContent(context.result.content);
    const effectiveDetails =
      prior?.details !== undefined ? prior.details : context.result.details;

    // narrowing:pi AfterToolCallContext(+既有 hook 改写)→ 闸门 AfterToolCallGuardEvent。
    const gateEvent: AfterToolCallGuardEvent = {
      toolCallId: context.toolCall.id,
      content: effectiveContent,
      ...(isRecord(effectiveDetails) ? { details: effectiveDetails } : {}),
    };
    const stripped = await afterGate(gateEvent);

    // 闸门无改写(无图像/标记复看)→ 透传既有 hook 结果(可能为 undefined 原样)。
    if (stripped?.content === undefined) {
      return prior;
    }
    // 闸门剥离:整段替换 content,保留既有 hook 的 details/isError/terminate 改写(若有)。
    return {
      ...(prior ?? {}),
      content: stripped.content,
    };
  };
}
