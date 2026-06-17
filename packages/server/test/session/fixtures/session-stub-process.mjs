#!/usr/bin/env node
/**
 * session-stub-process — 会话集成/e2e 用 stub agent(按 pi RPC JSONL 协议)。
 *
 * 行为:
 *  - prompt:吐 agent_start → message_update(text_start) → message_update(text_delta)×2
 *    → message_update(text_end) → turn_end → agent_end,再吐 prompt 的 response。
 *  - ext:吐一个 extension_ui_request(method confirm),不立即回 response;
 *    收到 extension_ui_response 后吐一个 ext 的 response(success:true)。
 *  - get_session_stats:吐带 SessionStats data 的 response。
 *  - 其余命令:通用 success response。
 * SIGTERM/stdin 关闭时干净退出。
 */
import process from "node:process";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const PARTIAL = {
  role: "assistant",
  content: [],
  api: "x",
  provider: "x",
  model: "m",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
};

function handlePrompt(cmd) {
  write({ type: "agent_start" });
  write({
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: PARTIAL },
  });
  for (const delta of ["hello ", "world"]) {
    write({
      type: "message_update",
      message: PARTIAL,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta,
        partial: PARTIAL,
      },
    });
  }
  write({
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: {
      type: "text_end",
      contentIndex: 0,
      content: "hello world",
      partial: PARTIAL,
    },
  });
  write({ type: "turn_end", message: PARTIAL, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

let lastExtCmdId = null;

function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      handlePrompt(cmd);
      break;
    case "ext":
      lastExtCmdId = cmd.id;
      write({
        type: "extension_ui_request",
        id: "ext-1",
        method: "confirm",
        title: "Proceed?",
        message: "Run it?",
      });
      break;
    case "extension_ui_response":
      // round-trip ack: complete the pending ext command.
      if (lastExtCmdId !== null) {
        write({ type: "response", id: lastExtCmdId, command: "ext", success: true });
        lastExtCmdId = null;
      }
      break;
    case "get_session_stats":
      write({
        type: "response",
        id: cmd.id,
        command: "get_session_stats",
        success: true,
        data: {
          sessionId: "stub-session",
          userMessages: 1,
          assistantMessages: 1,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 2,
          tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
          cost: 0.001,
        },
      });
      break;
    default:
      write({ type: "response", id: cmd.id, command: cmd.type, success: true });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const raw = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (raw.length === 0) continue;
    let cmd;
    try {
      cmd = JSON.parse(raw);
    } catch {
      continue;
    }
    handle(cmd);
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
