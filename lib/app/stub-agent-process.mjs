#!/usr/bin/env node
/**
 * stub-agent-process — deterministic offline agent for app-shell e2e.
 *
 * Speaks the pi RPC JSONL protocol over stdio (same wire contract a real agent
 * uses), so the entire real chain — rpc-channel → session-engine → SSE encoder
 * → @pi-web/react transport → <PiChat> — runs unchanged, with NO API key and
 * fully deterministic streaming.
 *
 * On `prompt` it emits, in order:
 *   agent_start
 *   → reasoning (thinking_start / _delta×2 / _end)        → collapsible block
 *   → tool_execution_start / _end (echo tool)             → tool card
 *   → text (text_start / _delta×N / _end), markdown        → incremental text
 *   → extension_ui_request (confirm)                       → permission dialog
 *   → response(prompt, success)  ← the command ack returns promptly so the
 *      browser transport resolves and renders the already-streamed chunks.
 *   …then PAUSES the turn until it receives extension_ui_response, after which:
 *   → more text → turn_end → agent_end                     → resume + finish
 *
 * `get_session_stats` returns a SessionStats payload; other commands ack ok.
 */
import process from "node:process";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const PARTIAL = {
  role: "assistant",
  content: [],
  api: "stub",
  provider: "stub",
  model: "stub-model",
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

function ame(event) {
  return { type: "message_update", message: PARTIAL, assistantMessageEvent: event };
}

// True while a turn is awaiting the user's extension-UI answer.
let awaitingUiResponse = false;

function emitReasoning() {
  write(ame({ type: "thinking_start", contentIndex: 0, partial: PARTIAL }));
  for (const delta of ["Let me ", "think about this."]) {
    write(ame({ type: "thinking_delta", contentIndex: 0, delta, partial: PARTIAL }));
  }
  write(
    ame({
      type: "thinking_end",
      contentIndex: 0,
      content: "Let me think about this.",
      partial: PARTIAL,
    }),
  );
}

function emitToolCall() {
  write({
    type: "tool_execution_start",
    toolCallId: "tool-1",
    toolName: "echo",
    args: { text: "ping" },
  });
  write({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "echo",
    result: { content: [{ type: "text", text: "ping" }] },
    isError: false,
  });
}

function emitText(deltas, full) {
  write(ame({ type: "text_start", contentIndex: 1, partial: PARTIAL }));
  for (const delta of deltas) {
    write(ame({ type: "text_delta", contentIndex: 1, delta, partial: PARTIAL }));
  }
  write(ame({ type: "text_end", contentIndex: 1, content: full, partial: PARTIAL }));
}

function handlePrompt(cmd) {
  write({ type: "agent_start" });
  write({ type: "turn_start" });
  emitReasoning();
  emitToolCall();
  // Markdown reply, streamed character-group by character-group.
  emitText(["## Hello", " from ", "the ", "**stub** ", "agent."], "## Hello from the **stub** agent.");
  // Request user confirmation and pause the *turn* (not the command ack).
  awaitingUiResponse = true;
  write({
    type: "extension_ui_request",
    id: "ext-1",
    method: "confirm",
    title: "Proceed?",
    message: "Allow the stub agent to continue?",
  });
  // Ack the prompt command promptly so the browser transport resolves and the
  // already-streamed chunks render incrementally.
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

function finishTurn() {
  if (!awaitingUiResponse) return;
  awaitingUiResponse = false;
  emitText([" Continuing", " after", " approval."], " Continuing after approval.");
  write({ type: "turn_end", message: PARTIAL, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
}

function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      handlePrompt(cmd);
      break;
    case "extension_ui_response":
      // The user answered the permission dialog → resume and finish the turn.
      finishTurn();
      break;
    case "abort":
      // Wind the stream down deterministically.
      if (awaitingUiResponse) {
        awaitingUiResponse = false;
        write({ type: "agent_end", messages: [], willRetry: false });
      }
      write({ type: "response", id: cmd.id, command: "abort", success: true });
      break;
    case "set_model":
    case "setModel":
      write({ type: "response", id: cmd.id, command: cmd.type, success: true });
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
          toolCalls: 1,
          toolResults: 1,
          totalMessages: 2,
          tokens: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, total: 20 },
          cost: 0.0012,
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
