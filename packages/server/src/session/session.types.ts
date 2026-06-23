/**
 * session-engine — 会话层共享类型(不重定义上游契约)。
 *
 * 帧/事件/响应类型一律取自 `@pi-web/protocol`(单一事实来源);`PiRpcChannel` 与
 * 通道命令/事件/扩展 UI 能力来自 `../rpc-channel/`;`ResolvedSource` 来自
 * `../agent-source/`。本文件仅定义会话层自有的标识、状态、句柄与构造入参形状。
 */
import type {
  AgentEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SseFrame,
} from "@pi-web/protocol";
import type {
  ExitInfo,
  PiRpcChannel,
  Unsubscribe,
} from "../rpc-channel/index.js";
import type { ResolvedSource } from "../agent-source/index.js";

/** 会话唯一标识(manager 生成,实现自由,如 UUID)。 */
export type SessionId = string;

/** 会话生命周期状态机的三态(去重保证幂等)。 */
export type SessionStatus = "active" | "stopping" | "stopped";

/** 会话结束原因:显式停止 / 空闲回收 / 子进程崩溃 / 优雅停机。 */
export type SessionEndReason = "stopped" | "idle" | "crashed" | "shutdown";

/** 订阅者收帧回调。 */
export type FrameListener = (frame: SseFrame) => void;

/** 会话结束回调(对订阅者)。 */
export type SessionEndListener = (reason: SessionEndReason) => void;

/** 可独立取消的订阅句柄。 */
export interface SubscribeHandle {
  unsubscribe(): void;
}

/**
 * 会话所需的通道能力。`rpc-channel` 的本地实现 `PiRpcProcess` 在 `PiRpcChannel`
 * 端口之上还暴露 `onEvent`/`onExtensionUIRequest`/`onExit`/`respondExtensionUI`
 * 与 18 个命令方法。会话以结构子集消费这些成员(不重定义其签名)。
 */
export interface SessionChannel extends PiRpcChannel {
  onEvent(cb: (event: AgentEvent) => void): Unsubscribe;
  onExtensionUIRequest(cb: (req: RpcExtensionUIRequest) => void): Unsubscribe;
  onExit(cb: (info: ExitInfo) => void): Unsubscribe;
  /** 订阅子进程 stderr 原始文本块(Req 2.5 / 3.1)。 */
  onStderr(cb: (chunk: string) => void): Unsubscribe;
  respondExtensionUI(id: string, response: RpcExtensionUIResponse): void;

  prompt(
    message: string,
    options?: {
      images?: readonly import("@pi-web/protocol").ImageContent[];
      streamingBehavior?: "steer" | "followUp";
    },
  ): Promise<import("@pi-web/protocol").RpcResponse>;
  steer(
    message: string,
    options?: { images?: readonly import("@pi-web/protocol").ImageContent[] },
  ): Promise<import("@pi-web/protocol").RpcResponse>;
  followUp(
    message: string,
    options?: { images?: readonly import("@pi-web/protocol").ImageContent[] },
  ): Promise<import("@pi-web/protocol").RpcResponse>;
  abort(): Promise<import("@pi-web/protocol").RpcResponse>;
  setModel(
    provider: string,
    modelId: string,
  ): Promise<import("@pi-web/protocol").RpcResponse>;
  cycleModel(): Promise<import("@pi-web/protocol").RpcResponse>;
  getAvailableModels(): Promise<import("@pi-web/protocol").RpcResponse>;
  setThinkingLevel(
    level: import("@pi-web/protocol").ThinkingLevel,
  ): Promise<import("@pi-web/protocol").RpcResponse>;
  getState(): Promise<import("@pi-web/protocol").RpcResponse>;
  getMessages(): Promise<import("@pi-web/protocol").RpcResponse>;
  getSessionStats(): Promise<import("@pi-web/protocol").RpcResponse>;
  getCommands(): Promise<import("@pi-web/protocol").RpcResponse>;
  fork(entryId: string): Promise<import("@pi-web/protocol").RpcResponse>;
  getForkMessages(): Promise<import("@pi-web/protocol").RpcResponse>;
}

/**
 * 最近状态缓存:不打扰子进程即可读取的最近已知值(Req 6.x)。无任何观察时为
 * `undefined`(明确"暂无缓存",而非编造默认)。
 */
export interface CachedState {
  readonly model?: unknown;
  readonly thinkingLevel?: unknown;
  readonly stats?: unknown;
  readonly state?: unknown;
  readonly updatedAt: number;
}

/** 会话描述(供检索/审计,Req 1.3)。 */
export interface SessionDescriptor {
  readonly id: SessionId;
  readonly mode: ResolvedSource["mode"];
  readonly trust: ResolvedSource["trust"];
  readonly status: SessionStatus;
}

/** PiSession 构造选项;`onClosed` 由 SessionManager 注入,进入 stopped 时回调一次。 */
export interface PiSessionOptions {
  readonly id: SessionId;
  readonly resolved: ResolvedSource;
  readonly channel: SessionChannel;
  readonly idleMs?: number;
  readonly onClosed?: (id: SessionId, reason: SessionEndReason) => void;
}

/** SessionManager.createSession 入参(注入已建立通道与已解析结果)。 */
export interface CreateSessionInput {
  readonly resolved: ResolvedSource;
  readonly channel: SessionChannel;
  readonly idleMs?: number;
  /** 显式会话标识;提供时优先于 idFactory(用于主进程 id 与持久化文件 id 对齐 / 恢复)。 */
  readonly id?: SessionId;
}

/** 默认空闲回收阈值(毫秒)。 */
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
