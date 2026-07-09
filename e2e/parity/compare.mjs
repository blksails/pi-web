/**
 * P1 出口判据 — Next 与 Hono 两套宿主的 `/api` 行为等价性对比。
 *
 * 两个 server 跑同一 `createPiWebHandler` 单例装配、同一 stub agent(确定性、离线)、
 * 各自独立的 SESSION_STORE 目录,逐项对比:
 *
 *   1. POST /api/sessions            → 状态码 + 规范化 body
 *   2. GET  /api/sessions/:id/stream → **完整 SSE 帧序列**,规范化后逐字节对比
 *   3. POST /api/sessions/:id/messages
 *   4. GET  /api/config/settings     → 配置读路径
 *   5. DELETE /api/sessions/:id      → 含 forgetSessionSource 副作用
 *
 * 规范化:抹去会话 id / 时间戳 / 路径等天然不同的值,其余必须逐字节一致。
 * 任何一项不一致 → 退出码 1 并打印 diff。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const JITI = join(
  ROOT,
  "node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs",
);
const NEXT_PORT = 3200;
const HONO_PORT = 3201;
const SOURCE = "builtin:default-agent";

const stores = [];
function freshStore(tag) {
  const d = mkdtempSync(join(tmpdir(), `p1-${tag}-`));
  stores.push(d);
  return d;
}

function baseEnv(port, storeRoot) {
  return {
    ...process.env,
    PORT: String(port),
    PI_WEB_STUB_AGENT: "1",
    SESSION_STORE: "fs",
    SESSION_STORE_ROOT: storeRoot,
    PI_WEB_DEFAULT_SOURCE: SOURCE,
    // 关掉自动标题:它经 LLM/启发式异步写库,会给两侧引入非确定性。
    PI_WEB_AUTO_TITLE: "0",
  };
}

const procs = [];
function launch(name, cmd, args, env) {
  const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  p.stdout.on("data", (b) => process.env.P1_VERBOSE && console.log(`[${name}]`, b.toString().trim()));
  p.stderr.on("data", (b) => process.env.P1_VERBOSE && console.error(`[${name}!]`, b.toString().trim()));
  return p;
}

async function waitReady(port, timeoutMs = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 200 || r.status === 404) return; // Next 无 bootstrap → 404 也算起来了
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${port} 未就绪`);
}

// ── 规范化 ───────────────────────────────────────────────────────────────
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalize(text, sessionId) {
  let s = text;
  if (sessionId) s = s.split(sessionId).join("<SID>");
  return s
    .replace(UUID, "<UUID>")
    .replace(/"(createdAt|updatedAt|timestamp|startedAt|ts)":\s*\d+/g, '"$1":<TS>')
    .replace(/"(createdAt|updatedAt|timestamp)":\s*"[^"]+"/g, '"$1":"<TS>"')
    .replace(/\d{13,}/g, "<EPOCH>")
    .replace(new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<ROOT>")
    .replace(/\/tmp\/p1-[a-z]+-[A-Za-z0-9]+/g, "<STORE>")
    .replace(new RegExp(`127\\.0\\.0\\.1:(${NEXT_PORT}|${HONO_PORT})`, "g"), "127.0.0.1:<PORT>");
}

/**
 * 读 SSE 并驱动一个完整回合。
 *
 * stub agent 的真实帧只有 `control` 与 `uiMessageChunk` 两类(没有 `agent_end` 这种
 * 事件名 —— 那是内部概念)。回合中途 stub 会发 `control:extension-ui` 的 confirm 请求
 * 并**阻塞等待应答**;不答就永远收不到收尾帧。故此处检测到该请求即 POST
 * `/ui-response`,再继续读到 `lifecycle:"idle"` 的收尾 `session-state` 或超时。
 */
async function readStreamDrivingTurn(port, sessionId, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(
    `http://127.0.0.1:${port}/api/sessions/${sessionId}/stream`,
    { signal: ctrl.signal },
  );
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let answered = false;
  let uiRequestId;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      // stub 的 confirm 请求 → 应答,否则回合永不收尾。
      if (!answered) {
        const m = buf.match(/"type":"extension_ui_request","id":"([^"]+)","method":"confirm"/);
        if (m) {
          answered = true;
          uiRequestId = m[1];
          await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/ui-response`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "extension_ui_response",
              id: uiRequestId,
              confirmed: true,
            }),
          });
        }
      }

      // 收尾:应答之后、extension-ui 请求之后再出现 busy:false 即认为回合结束。
      // (回合中的 snapshot 带 turn 字段,故只匹配 `"busy":false` 而非整个 snapshot 形状。)
      if (answered) {
        const tail = buf.slice(buf.lastIndexOf('"control":"extension-ui"'));
        if (tail.includes('"busy":false')) break;
      }
    }
  } catch {
    /* abort/超时 → 用已收到的 */
  } finally {
    clearTimeout(to);
    ctrl.abort();
  }
  return {
    headers: Object.fromEntries(res.headers),
    body: buf,
    status: res.status,
    answeredUi: answered,
  };
}

// ── 单侧完整流程 ─────────────────────────────────────────────────────────
async function runFlow(port) {
  const out = {};
  const base = `http://127.0.0.1:${port}/api`;

  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: SOURCE }),
  });
  const createdBody = await created.text();
  out.create = { status: created.status, body: createdBody };
  const sessionId = JSON.parse(createdBody).sessionId;
  out.sessionId = sessionId;

  // 先开流,再发 prompt(否则会漏掉早期帧)。
  const streamP = readStreamDrivingTurn(port, sessionId);
  await new Promise((r) => setTimeout(r, 800));

  const msg = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hello parity" }),
  });
  out.message = { status: msg.status, body: await msg.text() };

  const stream = await streamP;
  out.stream = stream;

  const settings = await fetch(`${base}/config/settings`);
  out.settings = { status: settings.status, body: await settings.text() };

  const del = await fetch(`${base}/sessions/${sessionId}`, { method: "DELETE" });
  out.delete = { status: del.status, body: await del.text() };

  return out;
}

// ── 对比 ─────────────────────────────────────────────────────────────────
function diffField(name, a, b, sidA, sidB) {
  const na = normalize(typeof a === "string" ? a : JSON.stringify(a), sidA);
  const nb = normalize(typeof b === "string" ? b : JSON.stringify(b), sidB);
  if (na === nb) return { name, ok: true };
  return { name, ok: false, next: na, hono: nb };
}

function sseEvents(body) {
  return body
    .split("\n")
    .filter((l) => l.startsWith("event:") || l.startsWith("data:"))
    .map((l) => (l.startsWith("event:") ? l.trim() : "data:<...>"))
    .filter((l) => l.startsWith("event:"));
}

async function main() {
  const nextStore = freshStore("next");
  const honoStore = freshStore("hono");

  console.log("启动 Next dev (3200) 与 Hono (3201) …");
  launch("next", "npx", ["next", "dev", "-p", String(NEXT_PORT)], baseEnv(NEXT_PORT, nextStore));
  launch("hono", "node", ["--import", JITI, "server/index.ts"], baseEnv(HONO_PORT, honoStore));

  await Promise.all([waitReady(NEXT_PORT), waitReady(HONO_PORT)]);
  console.log("两侧就绪,跑流程 …\n");

  const a = await runFlow(NEXT_PORT);
  const b = await runFlow(HONO_PORT);

  const checks = [
    diffField("POST /sessions status", String(a.create.status), String(b.create.status)),
    diffField("POST /sessions body", a.create.body, b.create.body, a.sessionId, b.sessionId),
    diffField("POST /messages status", String(a.message.status), String(b.message.status)),
    diffField("POST /messages body", a.message.body, b.message.body, a.sessionId, b.sessionId),
    diffField("GET /stream status", String(a.stream.status), String(b.stream.status)),
    diffField(
      "GET /stream content-type",
      a.stream.headers["content-type"],
      b.stream.headers["content-type"],
    ),
    diffField(
      "GET /stream 事件序列",
      sseEvents(a.stream.body).join("\n"),
      sseEvents(b.stream.body).join("\n"),
    ),
    diffField("GET /stream 全文(规范化)", a.stream.body, b.stream.body, a.sessionId, b.sessionId),
    diffField("GET /config/settings status", String(a.settings.status), String(b.settings.status)),
    diffField("GET /config/settings body", a.settings.body, b.settings.body, a.sessionId, b.sessionId),
    diffField("DELETE /sessions/:id status", String(a.delete.status), String(b.delete.status)),
  ];

  // ── 有效性前置断言 ────────────────────────────────────────────────────
  // 没有这一段,「两侧都没发生任何事」也会被判成 PARITY(实测踩过:messages 的 body 字段
  // 写错成 `text` → 两侧都 400 → SSE 只有握手 control 帧 → 全项一致 → 假绿)。
  const liveness = [];
  for (const [label, r] of [["next", a], ["hono", b]]) {
    if (r.create.status !== 201 && r.create.status !== 200)
      liveness.push(`${label}: POST /sessions 返回 ${r.create.status}`);
    if (r.message.status !== 200 && r.message.status !== 202)
      liveness.push(`${label}: POST /messages 返回 ${r.message.status}`);
    const chunks = (r.stream.body.match(/event:\s*uiMessageChunk/g) ?? []).length;
    if (chunks < 5)
      liveness.push(`${label}: uiMessageChunk 帧仅 ${chunks} 个(内容流未跑起来)`);
    if (!r.stream.body.includes('"type":"text-end"'))
      liveness.push(`${label}: SSE 未见 text-end(助手回复未收尾)`);
    if (!r.stream.answeredUi)
      liveness.push(`${label}: 未收到 stub 的 extension-ui confirm 请求`);
    if (!r.stream.body.includes('"busy":true'))
      liveness.push(`${label}: SSE 未见 busy:true(agent 从未进入回合)`);
    if (!r.stream.body.includes('"busy":false') || !r.stream.answeredUi)
      liveness.push(`${label}: 回合未收尾(应答 confirm 后未见 busy:false)`);
  }
  if (liveness.length > 0) {
    console.log("──────── P1 parity:INCONCLUSIVE ────────");
    console.log("流程未真正跑通,等价性结论无意义:");
    for (const l of liveness) console.log("  ✗", l);
    console.log("\nVERDICT: INCONCLUSIVE ⚠️");
    return 1;
  }

  console.log("──────── P1 parity 结果 ────────");
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}`);
    if (!c.ok) {
      failed++;
      console.log("   next:", JSON.stringify(c.next).slice(0, 400));
      console.log("   hono:", JSON.stringify(c.hono).slice(0, 400));
    }
  }
  console.log(`\n帧数: next=${sseEvents(a.stream.body).length} hono=${sseEvents(b.stream.body).length}`);
  console.log(`\nVERDICT: ${failed === 0 ? "PARITY ✅" : `MISMATCH ❌ (${failed})`}`);
  return failed === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error("harness 失败:", err.message);
} finally {
  for (const p of procs) p.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  for (const p of procs) p.kill("SIGKILL");
  for (const d of stores) rmSync(d, { recursive: true, force: true });
}
process.exit(code);
