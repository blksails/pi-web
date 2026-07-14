/**
 * attachment-tool-bridge · runner 装配接线 `wireAttachmentBridge`
 * (task 5.1;Req 2.3, 5.1, 6.3, 3.3)。
 *
 * 在 runner 子进程装配运行时(`createAgentSessionRuntime` 返回后)把 attachment-bridge 的
 * 横切件接到 pi `Agent` 的实际 hook 与会话生命周期上:
 *
 *  1. **子进程 store 实例化**:`createChildAttachmentStore(env)` 按 spawn env 实例化指向与主进程
 *     同一后端的 store 客户端(env 缺失 → `undefined` 优雅降级,Req 3.3/3.4)。
 *  2. **执行前闸门**(属主校验):`makeBeforeToolCall(store, sessionId)` 适配到
 *     `agent.beforeToolCall`,越权/不存在 `attachmentId` → `{ block:true }`(Req 5.1)。
 *  3. **结果出口闸门**(base64 剥离 + 调用级临时文件回收):`makeAfterToolCall(tracker)` 适配到
 *     `agent.afterToolCall`,含内联 base64 的 tool result 被剥离为文本引用(Req 6.3)。
 *  4. **tool 接入上下文透给 customTools**:`createAttachmentToolContext(store, sessionId)` 经
 *     约定 globalThis seam(`__piWebAttachmentToolContext__`)透给运行在子进程的示例工具
 *     (Implementation Notes ①:jiti 装载期闭包不可达,故用 globalThis seam)。
 *  5. **会话结束回收**:返回 `cleanup()`,在会话生命周期结束触发
 *     `tracker.cleanupForSession(sessionId)` 并清理 globalThis seam(Req 2.3)。
 *
 * ## 闸门 narrowing 适配(Implementation Notes ②)
 *
 * pi 内层 `Agent.beforeToolCall`/`afterToolCall` 的 `BeforeToolCallContext`/`AfterToolCallContext`
 * 类型属 `@earendil-works/pi-agent-core`(本仓库刻意不直接依赖的内层包)。闸门是纯函数 + 与 pi 公开
 * 面**同形**的本地接口(`ToolCallGuardEvent`/`AfterToolCallGuardEvent`)。本模块在接 runner 实际
 * hook 时做一次零阻抗 narrowing:从 pi context(`{ toolCall: { name, id }, args, result }`)取字段
 * 映射到闸门入参,字段同形、无语义转换。
 *
 * ## hook 组合(不覆盖既有)
 *
 * `AgentSession._installAgentToolHooks()` 已在 session 构造时把 `agent.beforeToolCall`/
 * `afterToolCall` 装为「路由到扩展 tool_call/tool_result 处理器」。本模块**组合**(compose)而非
 * 覆盖:先保存既有 hook,装入的新 hook 先跑 attachment 闸门,再委托既有 hook(before:闸门 block
 * 优先、否则委托;after:既有 hook 先改写、再叠加 base64 剥离),保留扩展链行为。
 */
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import {
  createChildAttachmentStore,
  type ChildAttachmentStore,
} from "../attachment-bridge/child-store.js";
import {
  createTempFileTracker,
  type TempFileTracker,
} from "../attachment-bridge/temp-files.js";
import {
  makeBeforeToolCall,
  type ToolCallGuardEvent,
} from "../attachment-bridge/ownership-guard.js";
import {
  makeAfterToolCall,
  type AfterToolCallGuardEvent,
  type ToolResultContent,
} from "../attachment-bridge/base64-gate.js";
import { createAttachmentToolContext } from "../attachment-bridge/tool-context.js";

/**
 * 约定 globalThis seam key:runner 装配把闭包绑定的 `AttachmentToolContext` 挂到此 key,
 * 供运行在子进程、经 jiti 装载的示例工具(`examples/attachment-tool-agent/tools/edit-image-tool.ts`)
 * 在 `execute` 内取得。与示例工具端的 `ATTACHMENT_CTX_KEY` 保持单一约定一致。
 * 常量单一来源在 `frame-channel/seam-keys`(Req 7.2),此处再导出以兼容既有引用。
 */
import { ATTACHMENT_TOOL_CONTEXT_KEY } from "./frame-channel/index.js";
export { ATTACHMENT_TOOL_CONTEXT_KEY };

/**
 * pi `Agent` 上 tool hook 的最小形状(narrowing 目标)。
 *
 * `BeforeToolCallContext`/`AfterToolCallContext` 属 pi 内层包(不可达),此处以**同形**本地接口
 * 描述本模块实际消费的字段(`toolCall.name`/`toolCall.id`/`args`/`result.content`/`result.details`)。
 */
interface PiBeforeToolCallContext {
  readonly toolCall: { readonly name: string; readonly id: string };
  readonly args: unknown;
}
interface PiAfterToolCallContext {
  readonly toolCall: { readonly name: string; readonly id: string };
  readonly args: unknown;
  readonly result: { readonly content: unknown; readonly details?: unknown };
  readonly isError: boolean;
}
interface PiBeforeToolCallResult {
  block?: boolean;
  reason?: string;
}
interface PiAfterToolCallResult {
  content?: ToolResultContent[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
type PiBeforeToolCall = (
  context: PiBeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<PiBeforeToolCallResult | undefined>;
type PiAfterToolCall = (
  context: PiAfterToolCallContext,
  signal?: AbortSignal,
) => Promise<PiAfterToolCallResult | undefined>;

/** pi `Agent` 上本模块组合的两个 hook 属性的最小可写视图。 */
interface HookableAgent {
  beforeToolCall?: PiBeforeToolCall;
  afterToolCall?: PiAfterToolCall;
}

/** {@link wireAttachmentBridge} 入参。 */
export interface WireAttachmentBridgeInput {
  /** 子进程 env(通常 `process.env`),由 attachment-store 经 spawn env 下发存储配置。 */
  readonly env: NodeJS.ProcessEnv;
  /** 当前会话 id(属主校验依据 + 会话级回收维度)。 */
  readonly sessionId: string;
  /** 可选:globalThis seam 宿主(默认 `globalThis`),便于测试隔离。 */
  readonly globalScope?: Record<string, unknown>;
  /** 可选:注入的临时文件登记器(默认新建),便于测试断言会话级回收。 */
  readonly tracker?: TempFileTracker;
}

/** {@link wireAttachmentBridge} 返回:接线产物 + 会话结束清理入口。 */
export interface AttachmentBridgeWiring {
  /** 子进程 store 客户端(env 缺失为 `undefined`,能力不可用)。 */
  readonly store: ChildAttachmentStore | undefined;
  /** 临时文件登记器(会话级回收持有同一实例)。 */
  readonly tracker: TempFileTracker;
  /** 存储能力是否可用(`store !== undefined`)。 */
  readonly available: boolean;
  /**
   * 会话生命周期结束时调用:触发会话级临时文件回收(Req 2.3)并清理 globalThis seam。
   * 幂等、吞错不抛(tracker 内部吞错)。
   */
  cleanup(): Promise<void>;
}

/**
 * 把 attachment-bridge 闸门 + 子进程 store + tool 接入上下文接到 runner 运行时(Req 2.3/5.1/6.3/3.3)。
 *
 * @param runtime 由 `createAgentSessionRuntime` 创建的运行时(持有 `session.agent` 与 `sessionId`)。
 * @param input   env + 当前 sessionId(+ 可选 seam 宿主 / tracker)。
 * @returns 接线产物与会话结束 `cleanup()`。
 */
export function wireAttachmentBridge(
  runtime: AgentSessionRuntime,
  input: WireAttachmentBridgeInput,
): AttachmentBridgeWiring {
  const { env, sessionId } = input;
  const globalScope = input.globalScope ?? (globalThis as Record<string, unknown>);
  const tracker = input.tracker ?? createTempFileTracker();

  // 1) 子进程 store 实例化(env 缺失 → undefined,优雅降级,Req 3.3/3.4)。
  const store = createChildAttachmentStore(env);

  // 4) tool 接入上下文经 globalThis seam 透给运行在子进程、经 jiti 装载的示例工具
  //    (Implementation Notes ①:装载期闭包不可达)。store 缺失时 ctx.available=false。
  const ctx = createAttachmentToolContext(store, sessionId);
  globalScope[ATTACHMENT_TOOL_CONTEXT_KEY] = ctx;

  // session.agent 持有可组合的 hook 属性(narrowing:pi 内层类型不可达,以同形本地视图操作)。
  const agent = runtime.session.agent as unknown as HookableAgent;

  // 2) 执行前闸门(属主校验)→ agent.beforeToolCall,组合既有 hook(扩展 tool_call 路由)。
  const beforeGuard = makeBeforeToolCall(store, sessionId);
  const priorBefore = agent.beforeToolCall;
  agent.beforeToolCall = async (context, signal) => {
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
      return { block: true, ...(blocked.reason !== undefined ? { reason: blocked.reason } : {}) };
    }
    // 放行 → 委托既有 hook(保留扩展 tool_call 链)。
    return priorBefore ? priorBefore(context, signal) : undefined;
  };

  // 3) 结果出口闸门(base64 剥离 + 调用级临时文件回收)→ agent.afterToolCall,组合既有 hook。
  const afterGate = makeAfterToolCall(tracker);
  const priorAfter = agent.afterToolCall;
  agent.afterToolCall = async (context, signal) => {
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

  let cleanedUp = false;
  return {
    store,
    tracker,
    available: store !== undefined,
    async cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      // 会话级临时文件回收(Req 2.3);tracker 内部吞错不抛。
      await tracker.cleanupForSession(sessionId);
      // 清理 globalThis seam(避免跨会话泄漏/陈旧上下文)。
      if (globalScope[ATTACHMENT_TOOL_CONTEXT_KEY] === ctx) {
        delete globalScope[ATTACHMENT_TOOL_CONTEXT_KEY];
      }
    },
  };
}

/** unknown → 非空 `Record` 判定(narrowing 守卫)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * pi tool result `content`(`(TextContent|ImageContent)[]`,同形)→ 闸门 `ToolResultContent[]`。
 * content 来自 pi 内层不可达类型,以同形结构断言(字段一致:`type`/`text`/`data`/`mimeType`)。
 */
function toToolResultContent(content: unknown): readonly ToolResultContent[] {
  return Array.isArray(content) ? (content as ToolResultContent[]) : [];
}
