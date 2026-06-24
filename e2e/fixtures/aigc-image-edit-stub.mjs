#!/usr/bin/env node
/**
 * aigc-image-edit-stub — deterministic, LLM-free e2e stub that drives the REAL
 * compiled `image_edit` AIGC tool (gpt-image-2 via NewAPI) end-to-end.
 *
 * 为何要专用 stub:生产 stub(lib/app/stub-agent-process.mjs)只发预置 echo 帧,不跑
 * customTools / 附件链;真实 image_edit 只在 runner 子进程里由 LLM 决策触发,而
 * AgentDefinition 纯声明、无 LLM 无法确定性发出工具调用。故照 attachment-tool-bridge-stub
 * 的既定回退:本 stub **自己确定性驱动真实工具链**(无 LLM):
 *
 *   1. 从 prompt 文本解析输入附件公开 id(att_…);
 *   2. 用与主进程同一后端实例化子进程附件 store(createChildAttachmentStore(env)
 *      读取下发的 PI_WEB_ATTACHMENT_DIR/SECRET);
 *   3. 跑真实 compileTool 编译的 `image_edit`(deps.getCtx 注入子进程 ctx),显式
 *      model=gpt-image-2 → 真实链路:resolve(att→dataURI)→ normalizeImageDataUri
 *      (剥 iPhone MPF/APP2 + 尾部 gain map)→ NewAPI /v1/images/edits → 产物落库
 *      (putOutput,同 id 空间)→ 回引用;
 *   4. 把产出 att id + 分发 URL 写进工具卡片文本,前端渲染、spec 可探测 /raw。
 *
 * "调用"由确定性脚手架触发,但 resolve+规范化+真打网关+落库+回流全是 REAL,且在真实
 * 子进程/后端里跑。讲 pi RPC JSONL 协议(同生产 stub),经 --import jiti/register 加载
 * (cwd = @blksails/server 包目录)以 import TS 源。
 *
 * 需 NEWAPI_API_KEY(经 spawn env 下发);缺失则工具降级 ok:false,spec 应 skip。
 */
import process from "node:process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(FIXTURE_DIR, "..", "..");
const TOOLKIT_RUNTIME = path.join(REPO_ROOT, "packages", "tool-kit", "src", "runtime.ts");

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function loadServerApi() {
  const mod = await import("@blksails/server");
  return mod.default ?? mod;
}
async function loadToolkit() {
  const mod = await import(TOOLKIT_RUNTIME);
  return mod.default ?? mod;
}

// ── Session identity / persistence(镜像 attachment-tool-bridge-stub)──────────
const SESSION_ID = process.env.PI_WEB_STUB_SESSION_ID;
const STUB_CWD = process.env.PI_WEB_STUB_CWD ?? process.cwd();
const STUB_SOURCE = process.env.PI_WEB_STUB_SOURCE;
const STUB_MODEL = process.env.PI_WEB_STUB_MODEL;
const PIWEB_SESSION_CUSTOM_TYPE = "piweb.session";
const EDIT_PROMPT = "将衣服改成粉红色，保持其他部分不变";

let store = null;
let messages = [];
let lastEntryId = null;

function nextEntryId() {
  return randomBytes(4).toString("hex");
}
function buildUserMessage(text) {
  return { role: "user", content: [{ type: "text", text: typeof text === "string" ? text : "" }], timestamp: Date.now() };
}
function buildAssistantMessage(text) {
  return {
    role: "assistant", content: [{ type: "text", text }], api: "stub", provider: "stub",
    model: STUB_MODEL ?? "stub-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
}
async function appendEntry(partial) {
  if (store === null || SESSION_ID === undefined) return;
  const entry = { id: nextEntryId(), parentId: lastEntryId, timestamp: new Date().toISOString(), ...partial };
  try { await store.append(SESSION_ID, entry); lastEntryId = entry.id; }
  catch (err) { process.stderr.write(`aigc-stub: append failed: ${String(err)}\n`); }
}
async function persistMessage(message) { messages.push(message); await appendEntry({ type: "message", message }); }

async function initPersistence() {
  if (SESSION_ID === undefined) return;
  try {
    const { createSessionEntryStore, sessionStoreConfigFromEnv } = await loadServerApi();
    store = await createSessionEntryStore(sessionStoreConfigFromEnv());
  } catch (err) { process.stderr.write(`aigc-stub: store init failed: ${String(err)}\n`); store = null; return; }
  let existing = false;
  try { await store.readHeader(SESSION_ID); existing = true; } catch { existing = false; }
  if (existing) {
    try { for await (const entry of store.read(SESSION_ID)) { if (entry.type === "message") messages.push(entry.message); lastEntryId = entry.id; } }
    catch (err) { process.stderr.write(`aigc-stub: resume read failed: ${String(err)}\n`); }
    return;
  }
  try {
    await store.create({ type: "session", id: SESSION_ID, version: 3, cwd: STUB_CWD, timestamp: new Date().toISOString() });
    await appendEntry({ type: "custom", customType: PIWEB_SESSION_CUSTOM_TYPE, data: { source: STUB_SOURCE, cwd: STUB_CWD, ...(STUB_MODEL !== undefined ? { model: STUB_MODEL } : {}) } });
  } catch (err) { process.stderr.write(`aigc-stub: store create failed: ${String(err)}\n`); }
}

// ── 真实 image_edit 工具(懒接一次)──────────────────────────────────────────
let bridge = null; // { tool, available }
async function getBridge() {
  if (bridge !== null) return bridge;
  const api = await loadServerApi();
  const toolkit = await loadToolkit();
  const childStore = api.createChildAttachmentStore(process.env);
  const ctx = api.createAttachmentToolContext(childStore, SESSION_ID ?? "stub");
  const tools = toolkit.buildAigcTools({ include: ["image_edit"], deps: { getCtx: () => ctx } });
  const tool = tools.find((t) => t.name === "image_edit");
  bridge = { tool, available: childStore !== undefined && tool !== undefined };
  return bridge;
}

function parseAttachmentId(text) {
  if (typeof text !== "string") return undefined;
  const injected = text.match(/\[attachment\s+id=(att_[A-Za-z0-9_-]+)/);
  if (injected) return injected[1];
  const bare = text.match(/\b(att_[A-Za-z0-9_-]+)/);
  return bare ? bare[1] : undefined;
}

const PARTIAL = {
  role: "assistant", content: [], api: "stub", provider: "stub", model: "stub-model",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: 0,
};
function ame(event) { return { type: "message_update", message: PARTIAL, assistantMessageEvent: event }; }
function emitText(full) {
  write(ame({ type: "text_start", contentIndex: 0, partial: PARTIAL }));
  write(ame({ type: "text_delta", contentIndex: 0, delta: full, partial: PARTIAL }));
  write(ame({ type: "text_end", contentIndex: 0, content: full, partial: PARTIAL }));
}

const AVAILABLE_MODELS = [{
  id: "stub-model", name: "Stub Model", api: "anthropic-messages", provider: "anthropic",
  baseUrl: "https://stub.local", reasoning: false, input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192,
}];

/** 确定性跑真实 image_edit(gpt-image-2)并发出工具卡片帧。 */
async function runImageEdit(attachmentId) {
  const { tool, available } = await getBridge();
  const args = { image: attachmentId, prompt: EDIT_PROMPT, model: "gpt-image-2" };
  write({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "image_edit", args });

  if (!available) {
    const result = { content: [{ type: "text", text: "image_edit 能力不可用。" }], details: { ok: false, error: "image_edit unavailable" } };
    write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "image_edit", result, isError: true });
    return { ok: false };
  }

  let raw;
  try {
    raw = await tool.execute("edit-1", args, undefined, undefined, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result = { content: [{ type: "text", text: `image_edit failed: ${message}` }], details: { ok: false, error: message } };
    write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "image_edit", result, isError: true });
    return { ok: false };
  }

  const details = raw.details ?? {};
  const asset = details.ok && Array.isArray(details.assets) ? details.assets[0] : undefined;
  const outId = asset?.attachmentId;
  const displayUrl = asset?.displayUrl;
  const summaryText = details.ok && outId ? `Produced attachment id=${outId} url=${displayUrl}` : `image_edit 未产出(${details.error ?? "unknown"})`;

  const result = { content: [...(Array.isArray(raw.content) ? raw.content : []), { type: "text", text: summaryText }], details };
  write({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "image_edit", result, isError: details.ok !== true });
  return { ok: details.ok === true, outId, displayUrl };
}

async function handlePrompt(cmd) {
  await persistMessage(buildUserMessage(cmd.message));
  write({ type: "agent_start" });
  write({ type: "turn_start" });

  const attachmentId = parseAttachmentId(cmd.message);
  let reply;
  if (attachmentId === undefined) {
    reply = "消息中未找到附件引用。";
    emitText(reply);
  } else {
    const outcome = await runImageEdit(attachmentId);
    reply = outcome.ok ? `已编辑图像。产出附件 id=${outcome.outId}。` : "无法编辑引用的图像。";
    emitText(reply);
  }

  write({ type: "turn_end", message: PARTIAL, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
  await persistMessage(buildAssistantMessage(reply));
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

async function handle(cmd) {
  switch (cmd.type) {
    case "prompt": await handlePrompt(cmd); break;
    case "get_messages": write({ type: "response", id: cmd.id, command: "get_messages", success: true, data: { messages } }); break;
    case "abort": write({ type: "response", id: cmd.id, command: "abort", success: true }); break;
    case "set_model":
    case "setModel": write({ type: "response", id: cmd.id, command: "set_model", success: true, data: AVAILABLE_MODELS[0] }); break;
    case "get_available_models": write({ type: "response", id: cmd.id, command: "get_available_models", success: true, data: { models: AVAILABLE_MODELS } }); break;
    case "get_commands": write({ type: "response", id: cmd.id, command: "get_commands", success: true, data: { commands: [] } }); break;
    case "get_session_stats":
      write({ type: "response", id: cmd.id, command: "get_session_stats", success: true,
        data: { sessionId: "stub-session", userMessages: 1, assistantMessages: 1, toolCalls: 1, toolResults: 1, totalMessages: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 } });
      break;
    default: write({ type: "response", id: cmd.id, command: cmd.type, success: true });
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
    try { cmd = JSON.parse(raw); } catch { continue; }
    chain = chain.then(() => handle(cmd)).catch((err) => { process.stderr.write(`aigc-stub: handle error: ${String(err)}\n`); });
  }
});
process.stdin.on("end", () => { void chain.finally(() => process.exit(0)); });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
