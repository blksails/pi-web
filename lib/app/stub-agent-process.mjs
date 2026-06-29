#!/usr/bin/env node
/**
 * stub-agent-process — deterministic offline agent for app-shell e2e.
 *
 * Speaks the pi RPC JSONL protocol over stdio (same wire contract a real agent
 * uses), so the entire real chain — rpc-channel → session-engine → SSE encoder
 * → @blksails/pi-web-react transport → <PiChat> — runs unchanged, with NO API key and
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
 * `get_session_stats` returns a SessionStats payload.
 * `get_available_models` returns a small, deterministic set of fully-shaped pi
 *   `Model` objects spanning two providers (anthropic / openai) so the rich
 *   ModelSelector can group/search/select (Req 4). `set_model` acks with the
 *   selected `Model` payload (matches rpc/response.ts `ok("set_model", Model)`).
 * `get_commands` returns deterministic `RpcSlashCommand` entries so the rich
 *   Suggestions surface renders command bubbles (Req 10).
 * `fork` / `get_fork_messages` remain UNSUPPORTED (no special handling → default
 *   ack with no data); the branch controls then degrade/hide (Req 8.4).
 * Other commands ack ok.
 *
 * Sentinel gating (extension-ui ambient surfaces e2e, Task 4.4): ONLY when the
 *   prompt text (`cmd.message`) contains the case-insensitive substring `ext-ui`
 *   does `handlePrompt` additionally emit five push frames (notify / setStatus /
 *   setWidget / setTitle / set_editor_text) BEFORE the confirm frame. This gates
 *   the ambient-surface push behind a sentinel so it never perturbs the other
 *   e2e specs (e.g. set_editor_text overwriting their input) — non-sentinel
 *   prompts behave exactly as before.
 */
import process from "node:process";
import { randomBytes } from "node:crypto";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * Load @blksails/pi-web-server's store factory dynamically. Spawned with
 * `--import jiti/register` (cwd = server package dir, see pi-handler) so the
 * TS-source package compiles on the fly; jiti's CJS interop folds the `export *`
 * named exports under `.default`, so unwrap it (falling back to the namespace).
 */
async function loadServerStoreApi() {
  const mod = await import("@blksails/pi-web-server");
  return mod.default ?? mod;
}

// ── Persistence + resume ────────────────────────────────────────────────────
// The stub persists its conversation to the same SessionEntryStore the host
// reads from (selected by SESSION_STORE), so URL cold-resume works for both fs
// and sqlite backends — symmetrically and offline. Loaded via `--import
// jiti/register` so this .mjs can import the TS-source @blksails/pi-web-server.
// Session identity + metadata arrive via PI_WEB_STUB_* env (see pi-handler).
const SESSION_ID = process.env.PI_WEB_STUB_SESSION_ID;
const STUB_CWD = process.env.PI_WEB_STUB_CWD ?? process.cwd();
const STUB_SOURCE = process.env.PI_WEB_STUB_SOURCE;
const STUB_MODEL = process.env.PI_WEB_STUB_MODEL;
const PIWEB_SESSION_CUSTOM_TYPE = "piweb.session";
const STUB_ASSISTANT_TEXT =
  "## Hello from the **stub** agent. Continuing after approval.";

let store = null;
/** Conversation history (AgentMessage[]) — returned by get_messages and rebuilt on resume. */
let messages = [];
let lastEntryId = null;

function nextEntryId() {
  return randomBytes(4).toString("hex");
}

/** A user AgentMessage carrying the prompt text. */
function buildUserMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text: typeof text === "string" ? text : "" }],
    timestamp: Date.now(),
  };
}

/** The deterministic assistant AgentMessage (thinking + final markdown text). */
function buildAssistantMessage() {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Let me think about this." },
      { type: "text", text: STUB_ASSISTANT_TEXT },
    ],
    api: "stub",
    provider: "stub",
    model: STUB_MODEL ?? "stub-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function appendEntry(partial) {
  if (store === null || SESSION_ID === undefined) return;
  const entry = {
    id: nextEntryId(),
    parentId: lastEntryId,
    timestamp: new Date().toISOString(),
    ...partial,
  };
  try {
    await store.append(SESSION_ID, entry);
    lastEntryId = entry.id;
  } catch (err) {
    process.stderr.write(`stub: append failed: ${String(err)}\n`);
  }
}

/** Persist a message entry and keep the in-memory history in sync. */
async function persistMessage(message) {
  messages.push(message);
  await appendEntry({ type: "message", message });
}

/**
 * Initialize persistence: create header + piweb.session metadata for a NEW
 * session, or rebuild history for an EXISTING one (cold resume). No-op without
 * SESSION_ID (keeps legacy specs that don't pass session identity unchanged).
 */
async function initPersistence() {
  if (SESSION_ID === undefined) return;
  try {
    const { createSessionEntryStore, sessionStoreConfigFromEnv } =
      await loadServerStoreApi();
    store = await createSessionEntryStore(sessionStoreConfigFromEnv());
  } catch (err) {
    process.stderr.write(`stub: store init failed: ${String(err)}\n`);
    store = null;
    return;
  }
  let existing = false;
  try {
    await store.readHeader(SESSION_ID);
    existing = true;
  } catch {
    existing = false;
  }
  if (existing) {
    try {
      for await (const entry of store.read(SESSION_ID)) {
        if (entry.type === "message") messages.push(entry.message);
        lastEntryId = entry.id;
      }
    } catch (err) {
      process.stderr.write(`stub: resume read failed: ${String(err)}\n`);
    }
    return;
  }
  try {
    await store.create({
      type: "session",
      id: SESSION_ID,
      version: 3,
      cwd: STUB_CWD,
      timestamp: new Date().toISOString(),
    });
    await appendEntry({
      type: "custom",
      customType: PIWEB_SESSION_CUSTOM_TYPE,
      data: {
        source: STUB_SOURCE,
        cwd: STUB_CWD,
        ...(STUB_MODEL !== undefined ? { model: STUB_MODEL } : {}),
      },
    });
  } catch (err) {
    process.stderr.write(`stub: store create failed: ${String(err)}\n`);
  }
}

/** A fully-shaped pi `Model` (rpc/model.ts ModelSchema) for deterministic e2e. */
function makeModel(id, name, provider, api) {
  return {
    id,
    name,
    api,
    provider,
    baseUrl: "https://stub.local",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

/**
 * Deterministic models across two providers so the selector can group & search.
 * Order is stable; first id matches the default PI_WEB_DEFAULT_MODEL=stub-model.
 */
const AVAILABLE_MODELS = [
  makeModel("stub-model", "Stub Model", "anthropic", "anthropic-messages"),
  makeModel("stub-opus", "Stub Opus", "anthropic", "anthropic-messages"),
  makeModel("stub-gpt", "Stub GPT", "openai", "openai-responses"),
];

/** Deterministic slash commands (RpcSlashCommand) for the suggestions surface. */
const COMMANDS = [
  {
    name: "help",
    description: "Show help",
    source: "prompt",
    sourceInfo: {
      path: "/builtin/help",
      source: "builtin",
      scope: "user",
      origin: "top-level",
    },
  },
  {
    name: "clear",
    description: "Clear the conversation",
    source: "prompt",
    sourceInfo: {
      path: "/builtin/clear",
      source: "builtin",
      scope: "user",
      origin: "top-level",
    },
  },
  // 非 builtin 的 agent 命令:供 palette「导航+填充 /name 」测试(/clear 现为 host 内置命令,
  // 选中改为分派而非填充,故需另一个普通 agent 命令验证填充行为)。
  {
    name: "retry",
    description: "Retry the last turn",
    source: "prompt",
    sourceInfo: {
      path: "/builtin/retry",
      source: "builtin",
      scope: "user",
      origin: "top-level",
    },
  },
];

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
/** Which extension-UI step the turn is paused on: null | "select" | "confirm". */
let pendingUi = null;

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

function emitToolCall(streamPartials = false) {
  write({
    type: "tool_execution_start",
    toolCallId: "tool-1",
    toolName: "echo",
    args: { text: "ping" },
  });
  // Sentinel `tool-stream`(see handlePrompt):emit累积 partialResult 中间产出
  // (无 __piWebUi → 走 tool-output-available preliminary 路径)。验证这些中间帧被
  // 喂进 *同一* 工具卡(按 toolCallId 复用 part)而非另起裸 JSON data 卡。
  if (streamPartials) {
    write({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "echo",
      partialResult: { content: [{ type: "text", text: "pi" }] },
    });
    write({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "echo",
      partialResult: { content: [{ type: "text", text: "pin" }] },
    });
  }
  write({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "echo",
    result: { content: [{ type: "text", text: "ping" }] },
    isError: false,
  });
}

// Sentinel `code-review`(see handlePrompt):emit a `code_review` tool call whose
// result carries `details.findings` — drives the plugin-code-review-agent webext
// Tier2 renderer (CodeReviewCard, data-testid="code-review-card") for e2e of the
// unified plugin two-layer binding (spec plugin-system-unification, Req 3/8).
function emitCodeReviewToolCall() {
  write({
    type: "tool_execution_start",
    toolCallId: "tool-cr-1",
    toolName: "code_review",
    args: { code: "var x = 1; if (x == 1) {}", language: "js" },
  });
  write({
    type: "tool_execution_end",
    toolCallId: "tool-cr-1",
    toolName: "code_review",
    result: {
      content: [{ type: "text", text: "2 issues found." }],
      details: {
        findings: ["使用了 var,建议 let/const", "使用了 ==,建议 ==="],
        language: "js",
      },
    },
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

async function handlePrompt(cmd) {
  // Persist the user message first so a cold resume includes it (write-then-read).
  await persistMessage(buildUserMessage(cmd.message));
  write({ type: "agent_start" });
  write({ type: "turn_start" });
  emitReasoning();
  emitToolCall(
    typeof cmd.message === "string" &&
      cmd.message.toLowerCase().includes("tool-stream"),
  );
  // Sentinel `code-review`:additionally emit a code_review tool call to drive the
  // unified plugin's Tier2 renderer (CodeReviewCard).
  if (
    typeof cmd.message === "string" &&
    cmd.message.toLowerCase().includes("code-review")
  ) {
    emitCodeReviewToolCall();
  }
  // Markdown reply, streamed character-group by character-group.
  emitText(["## Hello", " from ", "the ", "**stub** ", "agent."], "## Hello from the **stub** agent.");
  // Sentinel-gated ambient push frames (Task 4.4). Only when the prompt text
  // contains `ext-ui` (case-insensitive) do we additionally push the five
  // extension-UI surfaces — emitted BEFORE the confirm frame to prove the
  // push surfaces render without blocking the interactive dialog (Req 6.2).
  if (typeof cmd.message === "string" && cmd.message.toLowerCase().includes("ext-ui")) {
    write({ type: "extension_ui_request", id: "notify-1", method: "notify", message: "Build complete", notifyType: "info" });
    write({ type: "extension_ui_request", id: "status-1", method: "setStatus", statusKey: "branch", statusText: "main-branch" });
    write({ type: "extension_ui_request", id: "widget-1", method: "setWidget", widgetKey: "ctx", widgetLines: ["Widget line alpha", "Widget line beta"], widgetPlacement: "aboveEditor" });
    write({ type: "extension_ui_request", id: "title-1", method: "setTitle", title: "Stub Extension Title" });
    write({ type: "extension_ui_request", id: "editor-1", method: "set_editor_text", text: "prefilled-by-extension" });
  }
  // Sentinel `ext-custom`:发 ctx.ui.custom 帧(extension_ui_request method:"custom")——这是
  // pi-web runner 覆盖的 custom 实现写到 stdout 的帧形状(见 spec ctx-ui-custom-bridge /
  // custom-ui-wiring)。server 翻译层(translate-event.ts)把它转译为 data-pi-custom-ui data part,
  // 前端经已注册的 CustomUiDataPart/CustomUiRenderer 渲染(命中 demo-metric-card,未注册名降级)。
  // 不暂停 turn(fire-and-forget)。
  if (typeof cmd.message === "string" && cmd.message.toLowerCase().includes("ext-custom")) {
    write({ type: "extension_ui_request", id: "custom-1", method: "custom", payload: { component: "demo-metric-card", props: { label: "Tokens", value: 42 } } });
    write({ type: "extension_ui_request", id: "custom-2", method: "custom", payload: { component: "demo-not-registered", props: { x: 1 } } });
  }
  // Sentinel `ext-server-ui`:发 server-driven UI 帧(data-pi-ui)——builtin 组件 + sandbox
  // 节点树——经 tool_execution_update 的 partialResult.details.__piWebUi 携带(见
  // translate-event.ts / protocol PI_UI_TOOL_DETAILS_KEY),供 Tier4 server-driven 渲染验收
  // (R23/R24)。不暂停 turn(纯 data 帧)。
  if (typeof cmd.message === "string" && cmd.message.toLowerCase().includes("ext-server-ui")) {
    const emitUi = (spec) =>
      write({
        type: "tool_execution_update",
        toolCallId: "tool-ui",
        toolName: "render_ui",
        partialResult: { details: { __piWebUi: spec } },
      });
    emitUi({ kind: "builtin", component: "metric", title: "Overview", props: { label: "Active users", value: "1,284", delta: "+12%", tone: "success" } });
    emitUi({ kind: "builtin", component: "table", title: "Services", props: { columns: ["svc", "status"], rows: [["api", "OK"], ["db", "degraded"]] } });
    emitUi({
      kind: "sandbox",
      title: "Release notes",
      root: {
        el: "box",
        direction: "col",
        style: { gap: "sm" },
        children: [
          { el: "heading", level: 2, text: "v1.4 released" },
          { el: "badge", text: "stable", style: { tone: "success" } },
          { el: "list", items: ["fix login redirect", "faster cold start"] },
        ],
      },
    });
  }
  // 暂停 *turn*(不阻塞命令 ack)等待用户的 extension-UI 应答。
  // Sentinel `ext-select`:先发一个 select,应答后再发 confirm(两步闭环);
  // 否则维持原单步 confirm。两者都不破坏现有非 sentinel 行为。
  awaitingUiResponse = true;
  const sentinel = typeof cmd.message === "string" ? cmd.message.toLowerCase() : "";
  if (sentinel.includes("ext-select")) {
    pendingUi = "select";
    write({
      type: "extension_ui_request",
      id: "sel-1",
      method: "select",
      title: "Pick environment",
      options: ["dev", "staging", "prod"],
    });
  } else if (sentinel.includes("ext-input")) {
    // R19:单步 input 交互(应答后 finishTurn)。
    pendingUi = "input";
    write({
      type: "extension_ui_request",
      id: "in-1",
      method: "input",
      title: "Enter a value",
      placeholder: "type here…",
    });
  } else if (sentinel.includes("ext-editor")) {
    // R19:单步 editor 交互(应答后 finishTurn)。
    pendingUi = "editor";
    write({
      type: "extension_ui_request",
      id: "ed-1",
      method: "editor",
      title: "Edit text",
      prefill: "draft content",
    });
  } else {
    writeConfirm();
  }
  // Ack the prompt command promptly so the browser transport resolves and the
  // already-streamed chunks render incrementally.
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

/** 发出 confirm 扩展 UI 请求并把暂停步标记为 confirm。 */
function writeConfirm() {
  pendingUi = "confirm";
  write({
    type: "extension_ui_request",
    id: "ext-1",
    method: "confirm",
    title: "Proceed?",
    message: "Allow the stub agent to continue?",
  });
}

async function finishTurn() {
  if (!awaitingUiResponse) return;
  awaitingUiResponse = false;
  pendingUi = null;
  emitText([" Continuing", " after", " approval."], " Continuing after approval.");
  write({ type: "turn_end", message: PARTIAL, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
  // Persist the completed assistant turn so cold resume returns the full reply.
  await persistMessage(buildAssistantMessage());
}

async function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      await handlePrompt(cmd);
      break;
    case "extension_ui_response":
      // select 应答 → 接着发 confirm(继续暂停);confirm 应答 → 结束本轮。
      if (pendingUi === "select") {
        writeConfirm();
      } else {
        await finishTurn();
      }
      break;
    case "ui_rpc": {
      // Tier3 UI↔agent RPC(agent-web-extension):按 point/action 返回确定性候选。
      const req = cmd.request ?? {};
      let result;
      if (req.point === "slash" && req.action === "list") {
        result = [
          { id: "deploy", title: "/deploy", description: "Deploy the app" },
          { id: "rollback", title: "/rollback", description: "Roll back" },
        ];
      } else if (req.point === "mention") {
        result = [
          { id: "u1", label: "alice" },
          { id: "u2", label: "bob" },
        ];
      } else if (req.point === "autocomplete") {
        result = [
          { label: "deploy-prod", insertText: "deploy-prod " },
          { label: "deploy-staging", insertText: "deploy-staging " },
        ];
      } else if (req.point === "inlineComplete") {
        result = " to production";
      } else {
        result = { echo: req.payload ?? null };
      }
      write({
        type: "ui_rpc_response",
        response: { correlationId: req.correlationId, ok: true, result },
      });
      break;
    }
    case "get_messages":
      // 返回会话历史(冷恢复后由前端渲染)。当前 default 仅 ack,缺历史。
      write({
        type: "response",
        id: cmd.id,
        command: "get_messages",
        success: true,
        data: { messages },
      });
      break;
    case "abort":
      // Wind the stream down deterministically.
      if (awaitingUiResponse) {
        awaitingUiResponse = false;
        pendingUi = null;
        write({ type: "agent_end", messages: [], willRetry: false });
      }
      write({ type: "response", id: cmd.id, command: "abort", success: true });
      break;
    case "set_model":
    case "setModel": {
      // Echo the selected model as the success payload (rpc/response.ts:
      // ok("set_model", ModelSchema)). Fall back to a synthesized model when
      // the requested provider/modelId is not in the deterministic set.
      const selected =
        AVAILABLE_MODELS.find(
          (m) => m.provider === cmd.provider && m.id === cmd.modelId,
        ) ??
        makeModel(
          cmd.modelId ?? "stub-model",
          cmd.modelId ?? "Stub Model",
          cmd.provider ?? "anthropic",
          "anthropic-messages",
        );
      write({
        type: "response",
        id: cmd.id,
        command: "set_model",
        success: true,
        data: selected,
      });
      break;
    }
    case "get_available_models":
      write({
        type: "response",
        id: cmd.id,
        command: "get_available_models",
        success: true,
        data: { models: AVAILABLE_MODELS },
      });
      break;
    case "get_commands":
      write({
        type: "response",
        id: cmd.id,
        command: "get_commands",
        success: true,
        data: { commands: COMMANDS },
      });
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

// Serial command chain: starts after persistence init, and orders every command
// (including its awaited persistence) so writes complete before a later read
// (e.g. get_messages) observes them.
let chain = initPersistence();

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
    chain = chain.then(() => handle(cmd)).catch((err) => {
      process.stderr.write(`stub: handle error: ${String(err)}\n`);
    });
  }
});

process.stdin.on("end", () => {
  // Drain the in-flight command/persistence chain before exiting so a final
  // command's writes are not truncated (long-lived in production; stdin only
  // ends when the channel closes).
  void chain.finally(() => process.exit(0));
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
