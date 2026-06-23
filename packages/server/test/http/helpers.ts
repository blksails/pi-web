/**
 * http-api 测试共享 helper:mock manager/store/PiSession-like 与 stub channel 工厂。
 */
import type {
  RpcResponse,
  SpawnSpec,
  SseFrame,
} from "@pi-web/protocol";
import { fileURLToPath } from "node:url";
import { PiRpcProcess } from "../../src/rpc-channel/index.js";
import { PiSession } from "../../src/session/pi-session.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import type {
  ResolvedSource,
} from "../../src/agent-source/index.js";
import type {
  FrameListener,
  SessionEndListener,
  SessionChannel,
  SubscribeHandle,
} from "../../src/session/session.types.js";

/** stub agent 进程(复用 session fixtures)。 */
export const STUB_AGENT = fileURLToPath(
  new URL("../session/fixtures/session-stub-process.mjs", import.meta.url),
);

export function stubSpec(): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [STUB_AGENT],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

export function makeResolved(over: Partial<ResolvedSource> = {}): ResolvedSource {
  return {
    mode: "cli",
    trust: "ask",
    cwd: process.cwd(),
    spawnSpec: stubSpec(),
    ...over,
  };
}

/** 经真实通道 + stub agent 构造一个 manager/store/createChannel 三件套。 */
export function makeRealEngine(): {
  manager: SessionManager;
  store: InMemorySessionStore;
  createChannel: (resolved: ResolvedSource) => SessionChannel;
  resolver: { resolve: (source: string | undefined) => Promise<ResolvedSource> };
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const createChannel = (resolved: ResolvedSource): SessionChannel =>
    new PiRpcProcess(resolved.spawnSpec);
  const resolver = {
    resolve: (): Promise<ResolvedSource> => Promise.resolve(makeResolved()),
  };
  return { manager, store, createChannel, resolver };
}

/** 轻量 mock session:可断言命令调用、手工触发帧/结束、可配置抛错。 */
export class MockSession {
  readonly id: string;
  status: "active" | "stopping" | "stopped" = "active";
  readonly calls: Array<{ method: string; args: readonly unknown[] }> = [];
  throwOn = new Map<string, Error>();
  stopped = false;

  private listeners = new Set<{ frame: FrameListener; end?: SessionEndListener }>();
  private responseFor: (method: string) => RpcResponse = (method) =>
    ({ type: "response", id: "1", command: method, success: true }) as RpcResponse;

  constructor(id = "sess-1") {
    this.id = id;
  }

  setResponse(fn: (method: string) => RpcResponse): void {
    this.responseFor = fn;
  }

  private call(method: string, args: readonly unknown[]): Promise<RpcResponse> {
    this.calls.push({ method, args });
    const err = this.throwOn.get(method);
    if (err !== undefined) {
      return Promise.reject(err);
    }
    return Promise.resolve(this.responseFor(method));
  }

  prompt(message: string, options?: unknown): Promise<RpcResponse> {
    return this.call("prompt", [message, options]);
  }
  steer(message: string, options?: unknown): Promise<RpcResponse> {
    return this.call("steer", [message, options]);
  }
  followUp(message: string, options?: unknown): Promise<RpcResponse> {
    return this.call("followUp", [message, options]);
  }
  abort(): Promise<RpcResponse> {
    return this.call("abort", []);
  }
  setModel(provider: string, modelId: string): Promise<RpcResponse> {
    return this.call("setModel", [provider, modelId]);
  }
  setThinkingLevel(level: unknown): Promise<RpcResponse> {
    return this.call("setThinkingLevel", [level]);
  }
  getState(): Promise<RpcResponse> {
    return this.call("getState", []);
  }
  getSessionStats(): Promise<RpcResponse> {
    return this.call("getSessionStats", []);
  }
  getMessages(): Promise<RpcResponse> {
    return this.call("getMessages", []);
  }
  getCommands(): Promise<RpcResponse> {
    return this.call("getCommands", []);
  }
  getAvailableModels(): Promise<RpcResponse> {
    return this.call("getAvailableModels", []);
  }
  fork(entryId: string): Promise<RpcResponse> {
    return this.call("fork", [entryId]);
  }
  getForkMessages(): Promise<RpcResponse> {
    return this.call("getForkMessages", []);
  }
  getLogs(_query: { level?: string; limit?: number; since?: number }): unknown[] {
    return [];
  }
  respondExtensionUI(id: string, response: unknown): void {
    this.calls.push({ method: "respondExtensionUI", args: [id, response] });
    const err = this.throwOn.get("respondExtensionUI");
    if (err !== undefined) {
      throw err;
    }
  }
  stop(): Promise<void> {
    this.stopped = true;
    this.status = "stopped";
    return Promise.resolve();
  }
  subscribe(onFrame: FrameListener, onEnd?: SessionEndListener): SubscribeHandle {
    const entry = onEnd !== undefined ? { frame: onFrame, end: onEnd } : { frame: onFrame };
    this.listeners.add(entry);
    return { unsubscribe: () => this.listeners.delete(entry) };
  }
  subscriberCount(): number {
    return this.listeners.size;
  }
  emitFrame(frame: SseFrame): void {
    for (const l of this.listeners) l.frame(frame);
  }
  emitEnd(reason: "stopped" | "idle" | "crashed" | "shutdown"): void {
    for (const l of this.listeners) l.end?.(reason);
  }
}

/** 用 MockSession 充当 store 中的 PiSession(测试用结构子集)。 */
export function asPiSession(mock: MockSession): PiSession {
  return mock as unknown as PiSession;
}

/** 把 SSE 流文本完整读出(用于断言)。 */
export async function readStream(
  res: Response,
  opts: { until?: (text: string) => boolean; maxMs?: number } = {},
): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + (opts.maxMs ?? 5000);
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (value !== undefined) text += decoder.decode(value, { stream: true });
    if (done) break;
    if (opts.until !== undefined && opts.until(text)) {
      await reader.cancel();
      break;
    }
  }
  return text;
}
