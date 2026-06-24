#!/usr/bin/env node
/**
 * attachment-tool-bridge-stub — deterministic, LLM-free e2e stub that drives the
 * REAL attachment tool-execution chain (attachment-tool-bridge task 6.2).
 *
 * ## Why a dedicated stub (CONCERNS — chosen approach + rationale)
 *
 * The production e2e stub (`lib/app/stub-agent-process.mjs`) is a *wire emitter*:
 * on `prompt` it writes pre-canned RPC frames (a hard-coded `echo` tool) and
 * NEVER runs `customTools`, the runner's `beforeToolCall`/`afterToolCall` gates,
 * nor the subprocess attachment store. The real `edit_image` tool only executes
 * inside the REAL runner subprocess, whose `Agent` loop decides tool calls via an
 * LLM — there is no SDK seam for a custom agent to deterministically emit a tool
 * call without a model (AgentDefinition is purely declarative: model + tools +
 * systemPrompt; see packages/server/src/runner/agent-definition.ts).
 *
 * So per task 6.2's documented fallback ("在隔离 stub 模式下直接驱动 tool 执行链路
 * (子进程 resolve→处理→落库→回流)并经前端断言展示"), this stub *deterministically
 * drives the genuine chain itself*, WITHOUT an LLM:
 *
 *   1. parses the injected `[attachment id=att_… …]` reference out of the prompt
 *      text — proving prompt reference injection (task 5.2) reached the agent;
 *   2. instantiates the SUBPROCESS store via the SAME backend the main process
 *      uses (`createChildAttachmentStore(process.env)`, reading the spawn-env
 *      `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` downstreamed by
 *      attachment-store) — proving Req 3.x subprocess store points at one backend;
 *   3. runs the REAL `createEditImageTool(ctx)` (server-side factory, closure-
 *      injected ctx — the design path) with `returnImage: true`, exercising the
 *      genuine resolve(localPath/url/bytes) → transform → putOutput (tool-output,
 *      same id space) → reference reflow chain (Req 1/4/7);
 *   4. runs the raw tool result through the REAL `makeAfterToolCall` base64 gate
 *      (Req 6) so the inline base64 image is stripped to a text reference;
 *   5. emits `tool_execution_start`/`tool_execution_end` carrying the STRIPPED
 *      result (no base64) + the produced `att_out` id and its `/raw` display URL,
 *      so the browser renders a tool card and the spec can probe the URL.
 *
 * This means the "call" is triggered by deterministic scaffolding rather than a
 * real LLM decision, but the resolve+process+persist+reflow+gate work is REAL and
 * runs in the SAME subprocess/backend a real agent would, and the frontend still
 * displays the produced attachment via the distribution URL with NO base64 in the
 * tool result, and the produced id is re-referenceable in the next turn (回环 B).
 *
 * Speaks the pi RPC JSONL protocol over stdio exactly like the production stub
 * (so the whole rpc-channel → session-engine → SSE → @blksails/react → <PiChat>
 * chain runs unchanged), and persists to the same SessionEntryStore for resume.
 * Loaded via `--import jiti/register` (cwd = @blksails/server pkg dir) so it can
 * import the TS-source `@blksails/server` attachment-bridge.
 */
import process from "node:process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// This fixture lives at <repo>/e2e/fixtures/attachment-tool-bridge-stub.mjs.
// Resolve the repo root from its own location so subpath imports into
// @blksails/server source are cwd-independent (the stub runs with cwd = the
// @blksails/server package dir, so a bare relative path would be ambiguous).
const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(FIXTURE_DIR, "..", "..");
const EXAMPLE_TOOL_PATH = path.join(
  REPO_ROOT,
  "packages",
  "server",
  "src",
  "attachment-bridge",
  "example-tool.ts",
);

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/** Unwrap jiti's CJS-interop `.default` fold of `export *` named exports. */
async function loadServerApi() {
  const mod = await import("@blksails/server");
  return mod.default ?? mod;
}

// ── Session identity / persistence (mirrors the production stub) ──────────────
const SESSION_ID = process.env.PI_WEB_STUB_SESSION_ID;
const STUB_CWD = process.env.PI_WEB_STUB_CWD ?? process.cwd();
const STUB_SOURCE = process.env.PI_WEB_STUB_SOURCE;
const STUB_MODEL = process.env.PI_WEB_STUB_MODEL;
const PIWEB_SESSION_CUSTOM_TYPE = "piweb.session";

let store = null; // session entry store (persistence)
let messages = [];
let lastEntryId = null;

function nextEntryId() {
  return randomBytes(4).toString("hex");
}

function buildUserMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text: typeof text === "string" ? text : "" }],
    timestamp: Date.now(),
  };
}

function buildAssistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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
    process.stderr.write(`att-stub: append failed: ${String(err)}\n`);
  }
}

async function persistMessage(message) {
  messages.push(message);
  await appendEntry({ type: "message", message });
}

async function initPersistence() {
  if (SESSION_ID === undefined) return;
  try {
    const { createSessionEntryStore, sessionStoreConfigFromEnv } =
      await loadServerApi();
    store = await createSessionEntryStore(sessionStoreConfigFromEnv());
  } catch (err) {
    process.stderr.write(`att-stub: store init failed: ${String(err)}\n`);
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
      process.stderr.write(`att-stub: resume read failed: ${String(err)}\n`);
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
    process.stderr.write(`att-stub: store create failed: ${String(err)}\n`);
  }
}

// ── Attachment tool chain (the REAL bridge, lazily wired once) ────────────────
let bridge = null; // { ctx, tool, afterGate, available }

/**
 * Lazily wire the REAL subprocess attachment store + tool context + edit_image
 * tool + base64 gate from the spawn-env backend config (DIR + SECRET). Mirrors
 * runner attachment-wiring (task 5.1) but for the deterministic stub path.
 */
async function getBridge() {
  if (bridge !== null) return bridge;
  const api = await loadServerApi();
  // The example-tool factory is intentionally NOT in the @blksails/server barrel
  // (it value-imports the pi SDK; kept out to protect the app's webpack
  // externals). The stub runs under jiti, so import the TS source by absolute
  // path (resolved from this fixture's own location, see EXAMPLE_TOOL_PATH).
  const exampleToolMod = await import(EXAMPLE_TOOL_PATH);
  const createEditImageTool =
    exampleToolMod.createEditImageTool ??
    (exampleToolMod.default && exampleToolMod.default.createEditImageTool);

  const childStore = api.createChildAttachmentStore(process.env);
  const ctx = api.createAttachmentToolContext(childStore, SESSION_ID ?? "stub");
  const tracker = api.createTempFileTracker();
  const afterGate = api.makeAfterToolCall(tracker);
  const tool = createEditImageTool(ctx);
  bridge = { ctx, tool, afterGate, available: childStore !== undefined };
  return bridge;
}

/**
 * Extract the input attachment public id from a prompt text.
 *
 * Prefers the server-injected structured marker `[attachment id=att_… …]`
 * (proves prompt reference injection, task 5.2 — Req 8.1) when present; falls
 * back to a bare `att_…` token in the user text. The fallback exists because the
 * UI-driven send path renders the streamed tool card live, but the current
 * client transport (attachment-store's `PiTransport.sendMessages`) forwards only
 * message+images to `client.prompt` and does NOT forward `body.attachmentIds`,
 * so the server-side `injectAttachmentRefs` receives no ids on a pure UI send.
 * The spec therefore carries the id in the message TEXT (which the UI delivers
 * verbatim) so the deterministic fixture can run the real chain end-to-end while
 * the browser still renders the produced attachment via its distribution URL.
 * See CONCERNS in the spec for the client-transport gap.
 */
function parseAttachmentId(text) {
  if (typeof text !== "string") return undefined;
  const injected = text.match(/\[attachment\s+id=(att_[A-Za-z0-9_-]+)/);
  if (injected) return injected[1];
  const bare = text.match(/\b(att_[A-Za-z0-9_-]+)/);
  return bare ? bare[1] : undefined;
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
  return {
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: event,
  };
}

function emitText(deltas, full) {
  write(ame({ type: "text_start", contentIndex: 0, partial: PARTIAL }));
  for (const delta of deltas) {
    write(ame({ type: "text_delta", contentIndex: 0, delta, partial: PARTIAL }));
  }
  write(ame({ type: "text_end", contentIndex: 0, content: full, partial: PARTIAL }));
}

const AVAILABLE_MODELS = [
  {
    id: "stub-model",
    name: "Stub Model",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://stub.local",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
];

/**
 * Deterministically run the REAL edit_image chain for the referenced attachment,
 * strip base64 via the REAL gate, and emit the resulting tool card frames.
 */
async function runEditImage(attachmentId) {
  const { tool, afterGate, available } = await getBridge();

  write({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit_image", args: { attachmentId, returnImage: true } });

  if (!available) {
    const result = {
      content: [{ type: "text", text: "Attachment capability is not available." }],
      details: { ok: false, error: "attachment capability unavailable" },
    };
    write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit_image", result, isError: true });
    return { ok: false };
  }

  // returnImage:true → the RAW result carries an inline base64 ImageContent;
  // the gate must strip it (Req 6) so the frame that reaches the model/UI has none.
  let raw;
  try {
    raw = await tool.execute("edit-1", { attachmentId, returnImage: true }, undefined, undefined, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result = { content: [{ type: "text", text: `edit_image failed: ${message}` }], details: { ok: false, error: message } };
    write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit_image", result, isError: true });
    return { ok: false };
  }

  // REAL base64 gate (afterToolCall). Strips inline image → text reference unless
  // marked keepInline. Returns `{ content }` when it rewrote, else undefined.
  const stripped = await afterGate({
    toolCallId: "edit-1",
    content: raw.content,
    ...(raw.details && typeof raw.details === "object" ? { details: raw.details } : {}),
  });
  const finalContent = stripped && stripped.content !== undefined ? stripped.content : raw.content;

  const details = raw.details ?? {};
  const outId = details.ok ? details.outputAttachmentId : undefined;
  const displayUrl = details.ok ? details.displayUrl : undefined;

  // Surface the produced id + display URL in the tool card text so the browser
  // spec can extract and probe them (the stripped content already has no base64).
  const summaryText =
    details.ok && outId
      ? `Produced attachment id=${outId} url=${displayUrl}`
      : "edit_image produced no output.";

  const result = {
    content: [...finalContent, { type: "text", text: summaryText }],
    details,
  };
  write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit_image", result, isError: false });
  return { ok: details.ok === true, outId, displayUrl };
}

async function handlePrompt(cmd) {
  await persistMessage(buildUserMessage(cmd.message));
  write({ type: "agent_start" });
  write({ type: "turn_start" });

  const attachmentId = parseAttachmentId(cmd.message);
  let reply;
  if (attachmentId === undefined) {
    reply = "No attachment reference found in the message.";
    emitText([reply], reply);
  } else {
    const outcome = await runEditImage(attachmentId);
    reply = outcome.ok
      ? `Edited the image. Produced attachment id=${outcome.outId}.`
      : "Could not edit the referenced image.";
    emitText([reply], reply);
  }

  write({ type: "turn_end", message: PARTIAL, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
  await persistMessage(buildAssistantMessage(reply));
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

async function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      await handlePrompt(cmd);
      break;
    case "get_messages":
      write({ type: "response", id: cmd.id, command: "get_messages", success: true, data: { messages } });
      break;
    case "abort":
      write({ type: "response", id: cmd.id, command: "abort", success: true });
      break;
    case "set_model":
    case "setModel":
      write({ type: "response", id: cmd.id, command: "set_model", success: true, data: AVAILABLE_MODELS[0] });
      break;
    case "get_available_models":
      write({ type: "response", id: cmd.id, command: "get_available_models", success: true, data: { models: AVAILABLE_MODELS } });
      break;
    case "get_commands":
      write({ type: "response", id: cmd.id, command: "get_commands", success: true, data: { commands: [] } });
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
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
        },
      });
      break;
    default:
      write({ type: "response", id: cmd.id, command: cmd.type, success: true });
  }
}

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
      process.stderr.write(`att-stub: handle error: ${String(err)}\n`);
    });
  }
});

process.stdin.on("end", () => {
  void chain.finally(() => process.exit(0));
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
