/**
 * MockChannel — PiRpcChannel/SessionChannel 的测试替身。
 *
 * 可手工触发 onEvent / onExtensionUIRequest / onExit;记录 send 与命令调用;
 * 命令返回可配置的 RpcResponse。不 spawn 真实子进程(Req 10.2)。
 */
import type {
  AgentEvent,
  ImageContent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  ThinkingLevel,
} from "@pi-web/protocol";
import type {
  ChannelHealth,
  ExitInfo,
  LineListener,
  Unsubscribe,
} from "../../src/rpc-channel/index.js";
import type { SessionChannel } from "../../src/session/session.types.js";

type EventCb = (event: AgentEvent) => void;
type ExtCb = (req: RpcExtensionUIRequest) => void;
type ExitCb = (info: ExitInfo) => void;

export interface CommandCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export class MockChannel implements SessionChannel {
  readonly calls: CommandCall[] = [];
  readonly responded: Array<{ id: string; response: RpcExtensionUIResponse }> = [];
  readonly sent: string[] = [];
  closed = false;

  private alive = true;
  private readonly eventCbs = new Set<EventCb>();
  private readonly extCbs = new Set<ExtCb>();
  private readonly exitCbs = new Set<ExitCb>();
  private readonly lineCbs = new Set<LineListener>();

  /** 每个命令方法返回的响应工厂(默认通用 success)。 */
  responseFor: (method: string, args: readonly unknown[]) => RpcResponse =
    (method) =>
      ({
        type: "response",
        id: "1",
        command: method,
        success: true,
      }) as RpcResponse;

  // ── PiRpcChannel 端口 ──
  send(line: string): void {
    this.sent.push(line);
  }
  onLine(cb: LineListener): Unsubscribe {
    this.lineCbs.add(cb);
    return () => this.lineCbs.delete(cb);
  }
  close(): Promise<void> {
    this.closed = true;
    this.alive = false;
    return Promise.resolve();
  }
  health(): ChannelHealth {
    return { alive: this.alive, exitCode: null, signal: null };
  }

  // ── 事件/扩展 UI/退出订阅 ──
  onEvent(cb: EventCb): Unsubscribe {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }
  onExtensionUIRequest(cb: ExtCb): Unsubscribe {
    this.extCbs.add(cb);
    return () => this.extCbs.delete(cb);
  }
  onExit(cb: ExitCb): Unsubscribe {
    this.exitCbs.add(cb);
    return () => this.exitCbs.delete(cb);
  }
  respondExtensionUI(id: string, response: RpcExtensionUIResponse): void {
    this.responded.push({ id, response });
  }

  // ── 命令方法 ──
  private record(method: string, args: readonly unknown[]): Promise<RpcResponse> {
    this.calls.push({ method, args });
    return Promise.resolve(this.responseFor(method, args));
  }
  prompt(
    message: string,
    options?: {
      images?: readonly ImageContent[];
      streamingBehavior?: "steer" | "followUp";
    },
  ): Promise<RpcResponse> {
    return this.record("prompt", [message, options]);
  }
  steer(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.record("steer", [message, options]);
  }
  followUp(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.record("follow_up", [message, options]);
  }
  abort(): Promise<RpcResponse> {
    return this.record("abort", []);
  }
  setModel(provider: string, modelId: string): Promise<RpcResponse> {
    return this.record("set_model", [provider, modelId]);
  }
  cycleModel(): Promise<RpcResponse> {
    return this.record("cycle_model", []);
  }
  getAvailableModels(): Promise<RpcResponse> {
    return this.record("get_available_models", []);
  }
  setThinkingLevel(level: ThinkingLevel): Promise<RpcResponse> {
    return this.record("set_thinking_level", [level]);
  }
  getState(): Promise<RpcResponse> {
    return this.record("get_state", []);
  }
  getMessages(): Promise<RpcResponse> {
    return this.record("get_messages", []);
  }
  getSessionStats(): Promise<RpcResponse> {
    return this.record("get_session_stats", []);
  }
  getCommands(): Promise<RpcResponse> {
    return this.record("get_commands", []);
  }

  // ── 测试触发器 ──
  emitEvent(event: AgentEvent): void {
    for (const cb of this.eventCbs) cb(event);
  }
  emitExtensionUIRequest(req: RpcExtensionUIRequest): void {
    for (const cb of this.extCbs) cb(req);
  }
  emitExit(info: ExitInfo): void {
    this.alive = false;
    for (const cb of this.exitCbs) cb(info);
  }
}
