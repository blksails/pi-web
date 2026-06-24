/**
 * Storybook 本地 mock 夹具 — 与 `test/fixtures/mock-session.ts` 等价,但不依赖 vitest
 * (`vi`),以便在 Storybook 运行时(浏览器)使用。消费 @blksails/pi-web-react 接口形状,不触达后端。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type {
  UsePiSessionResult,
  UsePiControlsResult,
  UseExtensionUIResult,
  OperationState,
  ControlOperation,
} from "@blksails/pi-web-react";
import type {
  RpcSlashCommand,
  SessionStats,
  RpcExtensionUIRequest,
} from "@blksails/pi-web-protocol";

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
  const transport = new MockTransport(streamWithToolAndReasoning());
  return {
    sessionId: "sess-1",
    status: "open",
    transport: transport as unknown as UsePiSessionResult["transport"],
    connection: undefined,
    client: undefined,
    error: undefined,
    start: () => undefined,
    close: () => undefined,
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
    setModel: async () => undefined,
    setThinking: async () => undefined,
    abort: async () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    getStats: async () => ({ stats: sampleStats() }),
    getCommands: async () => ({ commands: sampleCommands() }),
    stats: sampleStats(),
    commands: sampleCommands(),
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
    respond: async () => undefined,
    error: undefined,
    pending: false,
    notifications: [],
    statuses: {},
    widgets: {},
    title: undefined,
    editorText: undefined,
    dismissNotification: () => undefined,
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

export function selectRequest(): Extract<
  RpcExtensionUIRequest,
  { method: "select" }
> {
  return {
    type: "extension_ui_request",
    id: "req-select",
    method: "select",
    title: "Pick one",
    options: ["alpha", "beta"],
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

/** 流式文本 + 工具三态 + 思考块的 chunk 序列,供 mock transport 推送。 */
export function streamWithToolAndReasoning(): UIMessageChunk[] {
  return [
    { type: "start", messageId: "a1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Hello" },
    { type: "text-delta", id: "t1", delta: " world" },
    { type: "text-end", id: "t1" },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", delta: "Let me think…" },
    { type: "reasoning-end", id: "r1" },
    {
      type: "tool-input-available",
      toolCallId: "tc1",
      toolName: "search",
      input: { q: "pi" },
    },
    { type: "tool-output-available", toolCallId: "tc1", output: { hits: 3 } },
    { type: "finish" },
  ];
}
