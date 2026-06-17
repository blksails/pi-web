/**
 * mock 会话夹具 — mock usePiSession / usePiControls / useExtensionUI 结果与
 * 可脚本化推送 chunk 的 mock ChatTransport(实现 AI SDK ChatTransport 接口)。
 *
 * 本层只消费 @pi-web/react 的接口形状;mock 不触达真实后端/SSE。
 */
import { vi } from "vitest";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type {
  UsePiSessionResult,
  UsePiControlsResult,
  UseExtensionUIResult,
  OperationState,
  ControlOperation,
} from "@pi-web/react";
import type {
  RpcSlashCommand,
  SessionStats,
  RpcExtensionUIRequest,
} from "@pi-web/protocol";

const IDLE: OperationState = { pending: false, error: undefined };

/** 可脚本化的 mock transport:每次 sendMessages 返回脚本化 chunk 流。 */
export class MockTransport implements ChatTransport<UIMessage> {
  private script: UIMessageChunk[];

  constructor(script: UIMessageChunk[] = []) {
    this.script = script;
  }

  setScript(script: UIMessageChunk[]): void {
    this.script = script;
  }

  sendMessages = async (): Promise<ReadableStream<UIMessageChunk>> => {
    const chunks = this.script;
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  };

  reconnectToStream = async (): Promise<ReadableStream<UIMessageChunk> | null> => {
    return null;
  };
}

export function mockSession(
  overrides: Partial<UsePiSessionResult> = {},
): UsePiSessionResult {
  const transport = new MockTransport();
  return {
    sessionId: "sess-1",
    status: "open",
    // MockTransport 满足 ChatTransport<UIMessage>;PiTransport 在运行时由 react 层提供。
    transport: transport as unknown as UsePiSessionResult["transport"],
    connection: undefined,
    client: undefined,
    error: undefined,
    start: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

export function mockControls(
  overrides: Partial<UsePiControlsResult> = {},
): UsePiControlsResult {
  const state: Record<ControlOperation, OperationState> = {
    setModel: IDLE,
    setThinking: IDLE,
    abort: IDLE,
    steer: IDLE,
    followUp: IDLE,
    getStats: IDLE,
    getCommands: IDLE,
  };
  return {
    setModel: vi.fn(async () => undefined),
    setThinking: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    getStats: vi.fn(async () => ({ stats: sampleStats() })),
    getCommands: vi.fn(async () => ({ commands: sampleCommands() })),
    stats: undefined,
    commands: undefined,
    state,
    ...overrides,
  };
}

export function mockExtensionUI(
  overrides: Partial<UseExtensionUIResult> = {},
): UseExtensionUIResult {
  return {
    queue: [],
    current: undefined,
    respond: vi.fn(async () => undefined),
    error: undefined,
    pending: false,
    ...overrides,
  };
}

export function sampleStats(): SessionStats {
  return {
    sessionId: "sess-1",
    userMessages: 2,
    assistantMessages: 2,
    toolCalls: 1,
    toolResults: 1,
    totalMessages: 4,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
    cost: 0.0123,
  };
}

export function sampleCommands(): RpcSlashCommand[] {
  const sourceInfo = {
    path: "/tmp",
    source: "builtin",
    scope: "project" as const,
    origin: "top-level" as const,
  };
  return [
    { name: "help", description: "Show help", source: "prompt", sourceInfo },
    { name: "model", description: "Switch model", source: "prompt", sourceInfo },
    { name: "clear", description: "Clear session", source: "prompt", sourceInfo },
  ];
}

export function selectRequest(
  overrides: Partial<Extract<RpcExtensionUIRequest, { method: "select" }>> = {},
): Extract<RpcExtensionUIRequest, { method: "select" }> {
  return {
    type: "extension_ui_request",
    id: "req-select",
    method: "select",
    title: "Pick one",
    options: ["alpha", "beta"],
    ...overrides,
  };
}

export function confirmRequest(): Extract<
  RpcExtensionUIRequest,
  { method: "confirm" }
> {
  return {
    type: "extension_ui_request",
    id: "req-confirm",
    method: "confirm",
    title: "Are you sure?",
    message: "Proceed with action?",
  };
}

export function inputRequest(): Extract<
  RpcExtensionUIRequest,
  { method: "input" }
> {
  return {
    type: "extension_ui_request",
    id: "req-input",
    method: "input",
    title: "Enter name",
    placeholder: "name",
  };
}

export function editorRequest(): Extract<
  RpcExtensionUIRequest,
  { method: "editor" }
> {
  return {
    type: "extension_ui_request",
    id: "req-editor",
    method: "editor",
    title: "Edit text",
    prefill: "initial",
  };
}
