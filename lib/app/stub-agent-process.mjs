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
 *   Suggestions surface renders command bubbles (Req 10). It also piggybacks the
 *   agent-declared-routes declaration frame (`agent_routes`, demo routes
 *   `gallery-stats`/`echo`); `piweb_agent_route_request` frames are answered
 *   with deterministic `piweb_agent_route_result` JSON (spec
 *   agent-declared-routes, Task 4.1).
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
import { execSync } from "node:child_process";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── 状态注入桥 stub 支持(state-injection-bridge) ───────────────────────────
// 本 stub 代替「真实 agent + wireStateBridge」模拟权威 KV 的下行/写回,使整条真实 server 链
// (handleRawLine → control:"state" 帧 → SSE → useExtensionState)可在离线 e2e 下跑通。
const stubState = new Map(); // key -> value
const stubStateRev = new Map(); // key -> next rev
/**
 * aigc-canvas:stub 展示图 —— 512×512 SVG data URI,按 id 定色相 + 中央标 id。
 * 此前用 1×1 透明 PNG,naturalWidth=1 令掩码 overlay 退化(一笔全屏)且视觉验证全靠
 * CSS 插值失真;像样的自然尺寸让缩放/笔刷/对比在 stub 环境下真实可验。
 */
function stubCanvasImage(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hash},60%,35%)'/>` +
    `<stop offset='1' stop-color='hsl(${(hash + 60) % 360},60%,70%)'/>` +
    `</linearGradient></defs>` +
    `<rect width='512' height='512' fill='url(#g)'/>` +
    `<text x='256' y='268' text-anchor='middle' font-family='monospace' font-size='28' fill='white' opacity='0.85'>${id}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** aigc-canvas:构造一张 stub 画廊资产(仅 att_ 引用 + stub 展示 URL,无二进制)。 */
function stubCanvasAsset(id, over = {}) {
  return {
    attachmentId: id,
    // stub 展示 URL(512 SVG data URI);真实态走 att_ 签名 URL。
    displayUrl: stubCanvasImage(id),
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: new Date().toISOString(),
    origin: over.origin ?? "tool-output",
    ...(over.derivedFrom !== undefined ? { derivedFrom: over.derivedFrom } : {}),
    ...(over.genParams !== undefined ? { genParams: over.genParams } : {}),
  };
}

/** 写一条 piweb_state 下行行(server handleRawLine 据此合成 control:"state" 帧)。 */
function emitState(key, value, deleted) {
  const rev = stubStateRev.get(key) ?? 0;
  stubStateRev.set(key, rev + 1);
  if (deleted) stubState.delete(key);
  else stubState.set(key, value);
  write({
    type: "piweb_state",
    key,
    value: deleted ? undefined : value,
    rev,
    ...(deleted ? { deleted: true } : {}),
  });
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
  // registerCommand 扩展命令(source:"extension"):供 R15 验收——前端对其 fire-and-forget(无气泡、
  // 不进历史),反馈仅靠 ctx.ui。stub handlePrompt 的 `/review` 分支只发 notify、不持久、不发 turn。
  {
    name: "review",
    description: "Run a local code review (ctx.ui only)",
    source: "extension",
    webVisible: true,
    sourceInfo: {
      path: "/stub/.pi/extensions/code-review.ts",
      source: "extension",
      scope: "project",
      origin: "top-level",
    },
  },
];

// ── agent-declared-routes stub 支持(Task 4.1,Req 6.1/7.3) ────────────────
// 演示 routes 声明(纯数据投影,与 protocol AgentRouteDeclDto 同形)。声明帧搭车
// get_commands(readiness 探针)发出——slash_completions 同位先例,PiSession.handleRawLine
// 在 active-gate 前缓存为会话路由表;重复发射幂等(表内容不变)。
const DEMO_AGENT_ROUTES = [
  {
    name: "gallery-stats",
    methods: ["GET"],
    description: "Deterministic stub gallery statistics",
  },
  {
    name: "echo",
    methods: ["POST"],
    description: "Echo the request body and query back (stub)",
  },
];

/**
 * 应答一条 `piweb_agent_route_request` 请求帧:id 原样回带,已知 name 回定值 JSON,
 * 未知 name 回 `route_not_registered`(与真桥 wireAgentRoutesBridge 语义一致——正常
 * 不发生,主进程已按路由表 404,此为防御路径对齐)。stub 是自主 .mjs 进程,无
 * runRpcMode takeOverStdout 劫持,直接 write(process.stdout)即可。
 */
function handleAgentRouteRequest(cmd) {
  if (cmd.name === "gallery-stats") {
    write({
      type: "piweb_agent_route_result",
      id: cmd.id,
      ok: true,
      result: { count: 3, source: "stub" },
    });
    return;
  }
  if (cmd.name === "echo") {
    write({
      type: "piweb_agent_route_result",
      id: cmd.id,
      ok: true,
      result: { echoed: cmd.body ?? null, query: cmd.query ?? {} },
    });
    return;
  }
  write({
    type: "piweb_agent_route_result",
    id: cmd.id,
    ok: false,
    error: {
      code: "route_not_registered",
      message: `route not registered in this agent process: ${cmd.name}`,
    },
  });
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
/** Which extension-UI step the turn is paused on: null | "select" | "confirm". */
let pendingUi = null;
// aigc-canvas「生图后轮末 auto-sync」e2e:`canvas-gen` 哨兵轮把一张 tool-output 图落入此池,
// **不 emit surface state**(模拟 image_generation 只落 att、不写 canvas 快照);轮末前端 idle 边沿
// bump syncSignal → run("canvas","sync"),sync 处理器才把池并入画廊。验证宿主 syncSignal 接线。
let pendingCanvasGen = [];

/**
 * 轮末自主收敛(镜像真实 `canvasSurfaceExtension` 的 agent_end 行为,AAS 扳机③):
 * 把 pending 生图并入画廊快照并 emit——权威侧收敛不依赖 UI 画廊挂载着发 sync(修 pre-existing:
 * 工作台打开期间轮末边沿被画廊重挂「首见不触发」吞掉 → 画廊停旧)。仅生成类哨兵(image_edit)
 * 调用;`canvas-gen` 哨兵仍走 pending 池 + UI sync,继续守卫宿主 syncSignal 接线(扳机②)。
 */
function convergeCanvasGallery() {
  if (pendingCanvasGen.length === 0) return;
  const key = "surface:canvas";
  const gallery = stubState.get(key) ?? { assets: [] };
  const merged = { assets: [...pendingCanvasGen, ...gallery.assets] };
  pendingCanvasGen = [];
  stubState.set(key, merged);
  emitState(key, merged);
}

// message-queue-ui e2e:模拟 pi 的排队 —— steer/follow_up 命令累积到队列并回发 queue_update
// (server 双帧 → control:"queue" → control-store → usePiControls().queue → 队列面板)。
// piweb_clear_queue 请求行(clearQueue 取回)回发 piweb_clear_queue_result 并清空 + 广播空 queue_update。
const stubSteeringQ = [];
const stubFollowUpQ = [];
/** `queue-hold` 哨兵:开一个不结束的 busy 轮次(agent_start 未配 agent_end),供忙时排队 e2e。 */
let holdingBusy = false;
function emitQueueUpdate() {
  write({
    type: "queue_update",
    steering: [...stubSteeringQ],
    followUp: [...stubFollowUpQ],
  });
}

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
  const msg = typeof cmd.message === "string" ? cmd.message : "";
  // Sentinel `queue-hold`(message-queue-ui e2e):开一个**不结束**的 busy 轮次(agent_start 无
  // 配套 agent_end)使 UI 权威 busy=true 而无阻塞对话框,供忙时 steer/follow_up 排队验收。
  // 由 abort 收尾。
  if (msg.toLowerCase().includes("queue-hold")) {
    await persistMessage(buildUserMessage(msg));
    holdingBusy = true;
    write({ type: "agent_start" });
    write({ type: "turn_start" });
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    return;
  }
  // registerCommand 扩展命令 `/review`(R15:命令是动作)。前端 fire-and-forget 投递,无气泡、不进历史。
  // stub 镜像真实 registerCommand:只发 ctx.ui notify(经控制流渲染)+ ack,**不持久任何 message、不发 turn**。
  // 冷恢复后 get_messages 无此命令痕迹(动作不留历史)。
  if (msg.startsWith("/review")) {
    write({
      type: "extension_ui_request",
      id: "review-notify-1",
      method: "notify",
      message: "代码检视完成:发现 2 个问题",
      notifyType: "warning",
    });
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    return;
  }
  // Sentinel `/skill:<name>`:模拟 SDK 的 skill 命令**展开**(plugin-system-unification R14)。真实模式下
  // `/skill:foo` 非扩展命令 → AgentSession._expandSkillCommand 把它展开成 `<skill name="…">…</skill>` 块
  // **当 prompt** 触发 turn,持久化的 user 消息即该展开块(送 LLM 的内容)。stub 镜像:持久化展开块为
  // user 消息(而非原始 `/skill:foo`),再跑一轮干净 turn。冷恢复时前端 agent-message-to-ui 的
  // collapseSkillExpansion 把展开块折叠回 `/skill:<name>`,与实时乐观气泡一致(R14 验收点)。
  if (msg.startsWith("/skill:")) {
    const sp = msg.indexOf(" ");
    const name = sp === -1 ? msg.slice("/skill:".length) : msg.slice("/skill:".length, sp);
    const args = sp === -1 ? "" : msg.slice(sp + 1).trim();
    const block =
      `<skill name="${name}" location="/stub/.pi/skills/${name}/SKILL.md">\n` +
      `References are relative to /stub/.pi/skills/${name}.\n\n` +
      `Stub Skill ${name}\n这是 stub 展开的 skill 正文。\n</skill>`;
    const expanded = args.length > 0 ? `${block}\n\n${args}` : block;
    await persistMessage(buildUserMessage(expanded));
    write({ type: "agent_start" });
    write({ type: "turn_start" });
    emitText(["## Skill ", "expanded ", "and ", "answered."], "## Skill expanded and answered.");
    write({ type: "turn_end", message: PARTIAL, toolResults: [] });
    write({ type: "agent_end", messages: [], willRetry: false });
    // 持久化与 emit 一致的助手文本(buildAssistantMessage 是固定默认文案,会与实时不符)。
    await persistMessage({
      ...buildAssistantMessage(),
      content: [{ type: "text", text: "## Skill expanded and answered." }],
    });
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    return;
  }
  // Sentinel `canvas-gen`(aigc-canvas 轮末 auto-sync e2e):模拟 LLM `image_generation` 生图落
  // tool-output 图,但**只入 pending 池、不 emit surface state**(生图工具不写 canvas 快照)。跑一轮
  // 干净 turn;agent_end → 前端 isBusy idle 边沿 → 宿主 bump syncSignal → CanvasGallery run("sync") →
  // stub sync 处理器把 pending 并入画廊。若宿主漏接 syncSignal,画廊不会更新(回归守卫)。
  // canvas 生成走对话流(A 方案):工作台组装的 image_edit 指令经 prompt 到达。stub 模拟
  // 「LLM 调 image_edit 工具生图」:解析 image: att_x 作血缘,落 tool-output 图入 pending 池
  // (不写 canvas 快照),轮末 auto-sync 收编 —— 与 canvas-gen 同管线,但带 derivedFrom。
  if (msg.includes("image_edit")) {
    const srcMatch = /image:\s*(att_\S+)/.exec(msg);
    pendingCanvasGen.push(
      stubCanvasAsset(`att_edit_${pendingCanvasGen.length + 1}`, {
        origin: "tool-output",
        ...(srcMatch ? { derivedFrom: srcMatch[1] } : {}),
        genParams: { op: "image_edit-via-chat" },
      }),
    );
    await persistMessage(buildUserMessage(msg));
    write({ type: "agent_start" });
    write({ type: "turn_start" });
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    await new Promise((r) => setTimeout(r, 500));
    emitText(["已调用 image_edit ", "完成图像编辑(stub)。"], "已调用 image_edit 完成图像编辑(stub)。");
    write({ type: "turn_end", message: PARTIAL, toolResults: [] });
    // 轮末自主收敛(扳机③,镜像真实 agent_end 行为)——见 convergeCanvasGallery 注释。
    convergeCanvasGallery();
    write({ type: "agent_end", messages: [], willRetry: false });
    return;
  }
  // Sentinel `set-aigc-pref <model>`(aigc-prompt-toolbar e2e):模拟「图像工具交互追问写回
  // 偏好」—— 真实链路是 runImageTool 的追问选择后 getSessionState().set("aigc.model", v) →
  // 下行 piweb_state → control:"state" → 工具排 AigcQuickSettings 订阅回显(Req 5.2)。stub 直接
  // emitState 同键,跑一轮干净 turn。回归守卫:宿主漏透传 state 或组件漏订阅时,回显不变化。
  if (msg.toLowerCase().includes("set-aigc-pref")) {
    const prefMatch = /set-aigc-pref\s+(\S+)/i.exec(msg);
    const prefValue = prefMatch ? prefMatch[1] : "wan2.7-image-pro";
    await persistMessage(buildUserMessage(msg));
    write({ type: "agent_start" });
    write({ type: "turn_start" });
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    emitState("aigc.model", prefValue);
    await new Promise((r) => setTimeout(r, 200));
    emitText(["偏好已写回 ", "(set-aigc-pref stub)。"], "偏好已写回 (set-aigc-pref stub)。");
    write({ type: "turn_end", message: PARTIAL, toolResults: [] });
    write({ type: "agent_end", messages: [], willRetry: false });
    return;
  }
  if (msg.toLowerCase().includes("canvas-gen")) {
    pendingCanvasGen.push(
      stubCanvasAsset(`att_gen_${pendingCanvasGen.length + 1}`, { origin: "tool-output" }),
    );
    await persistMessage(buildUserMessage(msg));
    write({ type: "agent_start" });
    write({ type: "turn_start" });
    // 早发 prompt ack + 制造可观测 busy 期(模拟真实 image_generation 耗时):agent_start 与 agent_end
    // 之间隔开一段,使前端先渲染 isBusy=true、再 false → idle 边沿被 pi-chat 捕获 → bump syncSignal →
    // CanvasGallery run("sync")。瞬时 turn(同一 SSE flush)前端观测不到边沿,故须此 delay。
    write({ type: "response", id: cmd.id, command: "prompt", success: true });
    await new Promise((r) => setTimeout(r, 500));
    emitText(["图已生成 ", "(canvas-gen stub)。"], "图已生成 (canvas-gen stub)。");
    write({ type: "turn_end", message: PARTIAL, toolResults: [] });
    write({ type: "agent_end", messages: [], willRetry: false });
    return;
  }
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
  // Sentinel `state-bridge`:模拟 agent 工具写共享状态 —— 把 `count` +1 并发下行帧
  // (state-injection-bridge e2e:验证 agent→UI 下行镜像)。不暂停 turn。
  if (typeof cmd.message === "string" && cmd.message.toLowerCase().includes("state-bridge")) {
    const prev = stubState.get("count");
    emitState("count", (typeof prev === "number" ? prev : 0) + 1, false);
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
      // agent-authoritative-surface:surface 命令(point=command/action=execute,payload 有
      // domain/action 且**无顶层 name** → 逃逸 host 拦截)。stub 代替真实 wireSurfaceBridge +
      // createSurface 模拟派发:改权威快照(surface:<domain>)→ 发 piweb_state 下行帧 → 回流
      // ui_rpc_response(result 为 SurfaceCommandResult)。real fd1 直写路径由集成测试覆盖。
      const p = req.payload;
      if (
        req.point === "command" &&
        req.action === "execute" &&
        p != null &&
        typeof p === "object" &&
        typeof p.domain === "string" &&
        typeof p.action === "string" &&
        p.name === undefined
      ) {
        const key = `surface:${p.domain}`;
        // aigc-canvas:画廊 = 物化视图。stub 代替真实 canvas 命令处理器(runImageTool / register /
        // sync / delete)维护 { assets } 快照,回流 { ids }。二进制永不进帧(仅 att_ 引用 + stub URL)。
        if (p.domain === "canvas") {
          const gallery = stubState.get(key) ?? { assets: [] };
          let data;
          // 能力清单在写点间显式继承(照真实 commands.ts 写点⑤⑥:`capabilities: s.capabilities ?? …`);
          // aigc-canvas 无 capabilities → withCaps 产字节等价 `{ assets }`(6 条既有 e2e 快照不变)。
          const withCaps = (assets) =>
            gallery.capabilities !== undefined ? { assets, capabilities: gallery.capabilities } : { assets };
          // A 档结果回流(prepend 派生资产)。canvas-plugins-m3:插件 command 动作 style_transfer 复用同一
          // 回流手法(照 edit/reference:落一张 derivedFrom=源图 的 tool-output 图入画廊)。
          const A_TIER = [
            "edit", "inpaint", "reference", "variants", "outpaint", "reframe", "style_transfer",
          ];
          if (A_TIER.includes(p.action)) {
            const src = String(p.args?.image ?? "");
            const newId = `att_${p.action}_${(gallery.assets.length + 1)}`;
            const fresh = stubCanvasAsset(newId, {
              origin: "tool-output",
              derivedFrom: src,
              genParams: p.args ?? {},
            });
            const next = withCaps([fresh, ...gallery.assets]);
            stubState.set(key, next);
            emitState(key, next);
            data = { ids: [newId] };
          } else if (p.action === "register") {
            const id = String(p.args?.attachmentId ?? "");
            const fresh = stubCanvasAsset(id, {
              origin: "tool-output",
              derivedFrom: p.args?.derivedFrom,
              genParams: p.args?.genParams,
            });
            const next = withCaps([fresh, ...gallery.assets.filter((a) => a.attachmentId !== id)]);
            stubState.set(key, next);
            emitState(key, next);
            data = { ids: [id] };
          } else if (p.action === "sync") {
            // reconcile:把 `canvas-gen` 轮落的 pending 图并入画廊(newest-first),再 emit。
            // 模拟真实 rebuildGalleryFromAttachments 经 listBySession 枚举纳入生图产物。
            const merged =
              pendingCanvasGen.length > 0
                ? withCaps([...pendingCanvasGen, ...gallery.assets])
                : gallery;
            pendingCanvasGen = [];
            stubState.set(key, merged);
            emitState(key, merged);
            data = { count: merged.assets.length };
          } else if (p.action === "delete") {
            const id = String(p.args?.attachmentId ?? "");
            const next = withCaps(gallery.assets.filter((a) => a.attachmentId !== id));
            stubState.set(key, next);
            emitState(key, next);
            data = { deleted: id };
          } else {
            write({
              type: "ui_rpc_response",
              response: {
                correlationId: req.correlationId,
                ok: false,
                result: {
                  domain: p.domain,
                  action: p.action,
                  ok: false,
                  error: { code: "unknown_action", message: `unknown action: ${p.action}` },
                },
              },
            });
            break;
          }
          write({
            type: "ui_rpc_response",
            response: {
              correlationId: req.correlationId,
              ok: true,
              result: { domain: p.domain, action: p.action, ok: true, data },
            },
          });
          break;
        }
        const prev = stubState.get(key) ?? { count: 0, log: [] };
        let data;
        if (p.action === "increment") {
          const next = { ...prev, count: (prev.count ?? 0) + 1 };
          emitState(key, next);
          data = { count: next.count };
        } else if (p.action === "echo") {
          const text = String(p.args?.text ?? "");
          const next = { ...prev, log: [...(prev.log ?? []), text] };
          emitState(key, next);
          data = { echoed: text, size: next.log.length };
        } else {
          write({
            type: "ui_rpc_response",
            response: {
              correlationId: req.correlationId,
              ok: false,
              result: {
                domain: p.domain,
                action: p.action,
                ok: false,
                error: { code: "unknown_action", message: `unknown action: ${p.action}` },
              },
            },
          });
          break;
        }
        write({
          type: "ui_rpc_response",
          response: {
            correlationId: req.correlationId,
            ok: true,
            result: { domain: p.domain, action: p.action, ok: true, data },
          },
        });
        break;
      }
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
    case "steer":
      // message-queue-ui:忙时插话 → 累积到 steering 队列并广播 queue_update。
      if (typeof cmd.message === "string" && cmd.message.length > 0) {
        stubSteeringQ.push(cmd.message);
      }
      emitQueueUpdate();
      write({ type: "response", id: cmd.id, command: "steer", success: true });
      break;
    case "follow_up":
      if (typeof cmd.message === "string" && cmd.message.length > 0) {
        stubFollowUpQ.push(cmd.message);
      }
      emitQueueUpdate();
      write({ type: "response", id: cmd.id, command: "follow_up", success: true });
      break;
    case "piweb_clear_queue": {
      // message-queue-ui「取回」:回发结果行(server handleRawLine 按 id 配对 resolve)+ 清空并广播空队列。
      const steering = [...stubSteeringQ];
      const followUp = [...stubFollowUpQ];
      stubSteeringQ.length = 0;
      stubFollowUpQ.length = 0;
      write({ type: "piweb_clear_queue_result", id: cmd.id, steering, followUp });
      emitQueueUpdate();
      break;
    }
    case "piweb_agent_route_request":
      // agent-declared-routes:HTTP 调用端点经 PiSession.invokeAgentRoute 下发的请求帧,
      // 回 piweb_agent_route_result(id 配对;handleRawLine 按 id resolve)。
      handleAgentRouteRequest(cmd);
      break;
    case "piweb_state_set":
      // 写回(UI→agent):更新权威态并回发下行帧(state-injection-bridge e2e 写回闭环)。
      emitState(cmd.key, cmd.value, false);
      break;
    case "piweb_state_delete":
      emitState(cmd.key, undefined, true);
      break;
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
      // message-queue-ui:结束 `queue-hold` 的挂起 busy 轮次。
      if (holdingBusy) {
        holdingBusy = false;
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
      // agent-slash-completion:模拟 runner 装配期声明 slash 候选(供伪命令补全 e2e)。
      // 搭车 get_commands(readiness 探针,主进程此时必在监听 onLine)发出装配帧。
      write({
        type: "slash_completions",
        items: [
          { name: "img-gen", description: "生成图像", insertText: "/img-gen " },
          { name: "img-edit", description: "编辑图像", insertText: "/img-edit " },
        ],
      });
      // agent-declared-routes:装配期声明帧(同上搭车 get_commands 的先例;
      // PiSession active-gate 前缓存,重复发射幂等)。
      write({ type: "agent_routes", routes: DEMO_AGENT_ROUTES });
      // agent-authoritative-surface:仅当 source 为 surface-demo-agent 时,探针命令 surface:demo
      // 可见(前端 useSurface / WebExtSurfaceAccess.hasCommand 据此判 available);其它 source 无此
      // 探针 → available=false → 面板退化只读(能力协商)。
      {
        const isSurfaceDemo =
          typeof STUB_SOURCE === "string" && STUB_SOURCE.includes("surface-demo-agent");
        // aigc-canvas:仅当 source 为 aigc-canvas-agent 时,探针命令 surface:canvas 可见(available)。
        // canvas-plugins-m3:贴纸范例 source(canvas-plugin-stickers)同样是 domain=canvas 的权威 surface
        // (复用 CanvasLauncher/CanvasPanel),故一并放行探针 + hydrate;能力清单额外含插件命令 style_transfer。
        const isStickers =
          typeof STUB_SOURCE === "string" && STUB_SOURCE.includes("canvas-plugin-stickers");
        const isCanvas =
          (typeof STUB_SOURCE === "string" && STUB_SOURCE.includes("aigc-canvas-agent")) ||
          isStickers;
        const commands = isSurfaceDemo
          ? [...COMMANDS, { name: "surface:demo", description: "surface probe", source: "extension" }]
          : isCanvas
            ? [...COMMANDS, { name: "surface:canvas", description: "surface probe", source: "extension" }]
            : COMMANDS;
        write({
          type: "response",
          id: cmd.id,
          command: "get_commands",
          success: true,
          data: { commands },
        });
        // aigc-canvas hydrate 模拟:装配期推一张种子图(物化视图重建),使画廊有格子可点。
        if (isCanvas && stubState.get("surface:canvas") === undefined) {
          const seed = stubCanvasAsset("att_seed", { origin: "tool-output" });
          // 贴纸 source:装配期把能力清单并入快照(agent 权威),使 command 通道插件动作 style_transfer
          // 落在 capability.actions 白名单内(前端 resolveAction 4.5 门控据此放行)。aigc-canvas 无 command
          // 动作 → 沿用无 capabilities 的种子(6 条既有 e2e 快照字节等价)。
          const state = isStickers
            ? { assets: [seed], capabilities: { models: [], sizes: [], actions: ["style_transfer"] } }
            : { assets: [seed] };
          stubState.set("surface:canvas", state);
          emitState("surface:canvas", state);
        }
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
          toolCalls: 1,
          toolResults: 1,
          totalMessages: 2,
          tokens: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, total: 20 },
          cost: 0.0012,
        },
      });
      break;
    case "bash": {
      // bang shell 命令(spec bang-shell-command):真实执行 shell 返回 BashResult 形状,
      // 用于离线确定性验证 pi-web 全链路(HTTP→pi-session 转发→门控)。`excludeFromContext`
      // 由上游透传;stub 不维护 LLM 上下文,故仅回结果。
      let output = "";
      let exitCode = 0;
      try {
        output = execSync(cmd.command, { encoding: "utf8", timeout: 10000 });
      } catch (err) {
        output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
        exitCode = typeof err.status === "number" ? err.status : 1;
      }
      write({
        type: "response",
        id: cmd.id,
        command: "bash",
        success: true,
        data: { output, exitCode, cancelled: false, truncated: false },
      });
      break;
    }
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
