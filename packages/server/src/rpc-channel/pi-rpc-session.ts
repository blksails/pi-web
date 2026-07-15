/**
 * PiRpcSession — 传输无关的会话核心。
 *
 * 消费一个 `RpcTransport`(纯传输),在其上实现完整的会话通道能力:JSONL 分帧、
 * 三类消息(response/event/extension_ui_request)分发、命令封装(生成 id → send →
 * 等匹配 response)、事件/扩展 UI/退出/stderr 监听。对外结构满足 `SessionChannel`
 * (不显式 `implements SessionChannel` 以避免 rpc-channel ↔ session 循环依赖;装配层
 * 以 `satisfies SessionChannel` 做结构校验,与既有 `PiRpcProcess` 同风格)。
 *
 * 一期定位:e2b 传输经 `PiRpcSession(new E2bTransport(...))` 复用本核心;local 仍走
 * 既有 `PiRpcProcess`(保持不变)。二期把 local 收敛为 `PiRpcSession(new LocalTransport)`
 * 以消除重复。分帧分发逻辑与 `PiRpcProcess.#dispatchLine` 等价。
 */
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ImageContent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  ThinkingLevel,
} from "@blksails/pi-web-protocol";
import type { ChannelHealth, PiRpcChannel, Unsubscribe } from "./pi-rpc-channel.js";
import type { ExitInfo } from "./pi-rpc-process.js";
import type { RpcTransport } from "./transport.js";
import { ChannelClosedError } from "./pi-rpc-process.errors.js";

interface PendingCommand {
  readonly type: string;
  resolve(response: RpcResponse): void;
  reject(error: Error): void;
}

export class PiRpcSession implements PiRpcChannel {
  readonly #transport: RpcTransport;
  #pendingCommands = new Map<string, PendingCommand>();
  #lineListeners = new Set<(line: string) => void>();
  #eventListeners = new Set<(event: AgentEvent) => void>();
  #extUIListeners = new Set<(req: RpcExtensionUIRequest) => void>();
  #exitListeners = new Set<(info: ExitInfo) => void>();
  #stderrListeners = new Set<(chunk: string) => void>();
  #restartListeners = new Set<() => void>();
  #closed = false;

  constructor(transport: RpcTransport) {
    this.#transport = transport;
    transport.onLine((line) => {
      this.#dispatchLine(line);
      for (const cb of this.#lineListeners) cb(line);
    });
    transport.onStderr((chunk) => {
      for (const cb of this.#stderrListeners) cb(chunk);
    });
    transport.onExit((info) => {
      for (const cb of this.#exitListeners) this.#safe(() => cb(info));
      this.#rejectAllPending(
        new ChannelClosedError("传输已退出,命令未完成。"),
      );
    });
    transport.onSpawn(() => {
      for (const cb of this.#restartListeners) this.#safe(cb);
    });
  }

  // ── 分帧分发(等价 PiRpcProcess.#dispatchLine)─────────────
  #dispatchLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略(健壮性)
    }
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    const type = m["type"];
    if (type === "response" && typeof m["id"] === "string") {
      const pending = this.#pendingCommands.get(m["id"]);
      if (pending) {
        this.#pendingCommands.delete(m["id"]);
        pending.resolve(msg as RpcResponse);
      }
      return;
    }
    if (type === "event") {
      for (const cb of this.#eventListeners) {
        this.#safe(() => cb(msg as AgentEvent));
      }
      return;
    }
    for (const cb of this.#extUIListeners) {
      this.#safe(() => cb(msg as RpcExtensionUIRequest));
    }
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* 监听器抛错隔离 */
    }
  }

  #rejectAllPending(err: Error): void {
    for (const pending of this.#pendingCommands.values()) pending.reject(err);
    this.#pendingCommands.clear();
  }

  // ── 命令封装 ──────────────────────────────────────────
  #sendCommand(
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<RpcResponse> {
    if (this.#closed) {
      return Promise.reject(new ChannelClosedError("通道已关闭,拒绝新命令。"));
    }
    const id = randomUUID();
    return new Promise<RpcResponse>((resolve, reject) => {
      this.#pendingCommands.set(id, { type, resolve, reject });
      try {
        this.#transport.send(JSON.stringify({ id, type, ...payload }));
      } catch (err) {
        this.#pendingCommands.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ── PiRpcChannel 端口 ─────────────────────────────────
  send(line: string): void {
    this.#transport.send(line);
  }

  onLine(cb: (line: string) => void): Unsubscribe {
    this.#lineListeners.add(cb);
    return () => this.#lineListeners.delete(cb);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#transport.close();
    this.#rejectAllPending(new ChannelClosedError("通道已关闭。"));
  }

  health(): ChannelHealth {
    return this.#transport.health();
  }

  // ── SessionChannel 扩展:监听器 ───────────────────────
  onEvent(cb: (event: AgentEvent) => void): Unsubscribe {
    this.#eventListeners.add(cb);
    return () => this.#eventListeners.delete(cb);
  }

  onExtensionUIRequest(cb: (req: RpcExtensionUIRequest) => void): Unsubscribe {
    this.#extUIListeners.add(cb);
    return () => this.#extUIListeners.delete(cb);
  }

  onExit(cb: (info: ExitInfo) => void): Unsubscribe {
    this.#exitListeners.add(cb);
    return () => this.#exitListeners.delete(cb);
  }

  onStderr(cb: (chunk: string) => void): Unsubscribe {
    this.#stderrListeners.add(cb);
    return () => this.#stderrListeners.delete(cb);
  }

  onRestart(cb: () => void): Unsubscribe {
    this.#restartListeners.add(cb);
    return () => this.#restartListeners.delete(cb);
  }

  respondExtensionUI(id: string, response: RpcExtensionUIResponse): void {
    // fire-and-forget:不等 response(与命令方法不同,无 pending 登记)。
    if (this.#closed) return;
    this.#transport.send(
      JSON.stringify({
        id: randomUUID(),
        type: "respond_extension_ui",
        requestId: id,
        response,
      }),
    );
  }

  // ── SessionChannel 扩展:命令方法(type 为 snake_case)───
  prompt(
    message: string,
    options?: {
      images?: readonly ImageContent[];
      streamingBehavior?: "steer" | "followUp";
    },
  ): Promise<RpcResponse> {
    return this.#sendCommand("prompt", {
      message,
      ...(options?.images ? { images: options.images } : {}),
      ...(options?.streamingBehavior
        ? { streamingBehavior: options.streamingBehavior }
        : {}),
    });
  }

  steer(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.#sendCommand("steer", {
      message,
      ...(options?.images ? { images: options.images } : {}),
    });
  }

  followUp(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.#sendCommand("follow_up", {
      message,
      ...(options?.images ? { images: options.images } : {}),
    });
  }

  abort(): Promise<RpcResponse> {
    return this.#sendCommand("abort");
  }

  setModel(provider: string, modelId: string): Promise<RpcResponse> {
    return this.#sendCommand("set_model", { provider, modelId });
  }

  cycleModel(): Promise<RpcResponse> {
    return this.#sendCommand("cycle_model");
  }

  getAvailableModels(): Promise<RpcResponse> {
    return this.#sendCommand("get_available_models");
  }

  setThinkingLevel(level: ThinkingLevel): Promise<RpcResponse> {
    return this.#sendCommand("set_thinking_level", { level });
  }

  getState(): Promise<RpcResponse> {
    return this.#sendCommand("get_state");
  }

  getMessages(): Promise<RpcResponse> {
    return this.#sendCommand("get_messages");
  }

  getSessionStats(): Promise<RpcResponse> {
    return this.#sendCommand("get_session_stats");
  }

  getCommands(): Promise<RpcResponse> {
    return this.#sendCommand("get_commands");
  }

  fork(entryId: string): Promise<RpcResponse> {
    return this.#sendCommand("fork", { entryId });
  }

  getForkMessages(): Promise<RpcResponse> {
    return this.#sendCommand("get_fork_messages");
  }

  bash(
    command: string,
    options?: { excludeFromContext?: boolean },
  ): Promise<RpcResponse> {
    return this.#sendCommand("bash", {
      command,
      ...(options?.excludeFromContext !== undefined
        ? { excludeFromContext: options.excludeFromContext }
        : {}),
    });
  }

  abortBash(): Promise<RpcResponse> {
    return this.#sendCommand("abort_bash");
  }

  newSession(parentSession?: string): Promise<RpcResponse> {
    return this.#sendCommand("new_session", {
      ...(parentSession !== undefined ? { parentSession } : {}),
    });
  }
}
