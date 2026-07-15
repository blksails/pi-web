#!/usr/bin/env node
/**
 * 本地 kind 门控 e2e —— 沙盒会话「装配面一致性」最终验收
 * (spec sandbox-baked-agent-image,任务 6.1;Req 1.1-1.5 / 4.1 / 4.3-4.5 / 6.2 / 7.2 / 3.4)。
 *
 * 被测资产 = examples/aigc-canvas-agent(声明工具 + webext 贡献 + 布局三面俱全):
 *   烘焙(build:agent-image --kind-load --register,经 dev-e2b-local 的
 *   PI_WEB_E2B_BAKE_SOURCE 一条龙)→ e2b/ws-runner dev 建沙盒会话,再起同源
 *   非沙盒 dev(local 模式)建基线会话——对两者调用**同一组** REST/SSE 观测端点,
 *   规范化后逐项 diff:
 *
 *   | 观测项 | 端点 | 证明的装配面 |
 *   | commands | GET /sessions/:id/commands | 扩展命令注册(img_vision / surface:canvas 探针 → 工具承载扩展已装配) |
 *   | slash 补全 | GET /sessions/:id/completion?trigger=/ | slash_completions 装配期声明帧(/img-gen、/img-edit) |
 *   | 触发符 | GET /sessions/:id/completion/triggers | completion 框架接线 |
 *   | agent routes | GET /sessions/:id/agent-routes | agent_routes 装配期声明帧(gallery-stats) |
 *   | route 调用 | GET /sessions/:id/agent-routes/gallery-stats | handler 在 agent 进程内真实执行(数据面往返,零 LLM) |
 *   | surface 快照 | SSE 粘性 control:state key=surface:canvas | state/surface 双向桥(canvas AAS 权威快照下行) |
 *   | webext/布局 | GET /api/webext/resolve?source=… | webext 解析面(构建期车道的 web.config 由前端按 source 匹配,两模式同源恒一致) |
 *   | 就绪握手 | SSE 粘性 control:session-status → ready | Req 4.4(getCommands 探针成功 = 沙箱内 runner 真起来了) |
 *   | prompt 流式 | POST /messages + SSE | Req 1.1/6.2(沙盒面无 provider 凭据时降级为「接受 prompt 且返回流」,报告注明) |
 *
 * 规范化规则(剔除**按设计**必然易变的字段,其余全量 deep-diff;规则集中在 normalize* 函数):
 *   - commands 先按 sourceInfo 分区:
 *       · agent 声明面 = sourceInfo.source === "inline"(agent extensions 数组进程内装配,
 *         即本 spec Req 1.2-1.4 承诺一致的「该 agent 声明的」装配面)→ **硬断言逐项一致**;
 *       · 宿主环境面 = 其余(scope=user 的 ~/.pi/agent 个人包如 pi-sandbox/pi-web-access,
 *         及 local 分支强注入的平台扩展如 reload-runtime)——按设计不进不可变镜像
 *         (docs/sandbox-baked-agent-image.md §6),因宿主而异,不属 agent 声明面。
 *         断言方向性:**沙盒侧宿主面必须为空**(沙盒不得凭空多出命令);local 侧多出的
 *         宿主面命令原样打印 + 记 CONCERN(沙盒会话缺宿主级能力,交人裁定),不静默吞。
 *   - commands[].sourceInfo 在比对物中剔除(inline 面的 path 为 "<inline:N>" 序号,其余含
 *     宿主绝对路径);完整 provenance 进证据 JSON。
 *   - control:state 帧的 rev(单调计数,与订阅时序相关)剔除;value 全量比对。
 *   - 响应体中的 protocolVersion 保留(两侧同仓同版本,天然应一致)。
 *   - 会话 id / URL 中的 :id 不进入比对物。
 *
 * 负路径(Req 3.4;口径钉在 tasks.md Implementation Notes 4.1 条目):
 *   沙盒 dev 以 PI_WEB_E2B_TEMPLATE=""(全局模板置空)起,map 仅含被测 source——
 *   对未接线 source(examples/hello-agent)POST /sessions ⇒ 三级解析全空 ⇒ HTTP 500,
 *   响应体不泄露(仅 INTERNAL / Internal server error),修复指引(三条路径:
 *   TEMPLATE_MAP / TEMPLATE_DERIVE / TEMPLATE)打在 dev 进程 stderr。
 *
 * 门控(仿 packages/server/test/rpc-channel/sandbox-ws-transport.local.test.ts 语义):
 *   kubectl 不可达 / agent-sandbox 未就绪 / docker 不可用 / kind 集群缺失 / 基座镜像
 *   缺失 / 端口被占 → 打印 SKIP 原因后 exit 0(CI 无 kind 不红)。
 *
 * 跑法:`pnpm e2e:sandbox-baked`(或 node e2e/sandbox-baked-image.local.mjs)。
 * 端口:沙盒 dev API :3021 / vite :5184;非沙盒 dev API :3022 / vite :5185
 * (避开 dev:e2b:local 缺省 3020/5183 与主 dev 3000/5173)。
 * 可调 env:AGENT_SANDBOX_NS / AGENT_SANDBOX_SVC / PI_WEB_E2B_BASE_IMAGE / KIND_CLUSTER。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANVAS_DIR = path.join(ROOT, "examples", "aigc-canvas-agent");
const NEG_DIR = path.join(ROOT, "examples", "hello-agent");
const NS = process.env.AGENT_SANDBOX_NS ?? "agent-sandbox";
const DEPLOY = process.env.AGENT_SANDBOX_SVC ?? "agent-sandbox";
const KIND_CLUSTER = process.env.KIND_CLUSTER ?? "pi-clouds";
const BASE_IMAGE = process.env.PI_WEB_E2B_BASE_IMAGE ?? "pi-clouds/agent-runner:pi";

const SANDBOX_API = 3021;
const SANDBOX_VITE = 5184;
const LOCAL_API = 3022;
const LOCAL_VITE = 5185;
const PROXY_PORT = 13000; // dev-e2b-local 反代缺省口(被占说明另一套 dev 在跑,让位)
const EVIDENCE_DIR = path.join(
  ROOT,
  ".kiro",
  "specs",
  "sandbox-baked-agent-image",
  "evidence",
);

// ---------------------------------------------------------------------------
// 输出 / 断言记账
// ---------------------------------------------------------------------------

const failures = [];
const concerns = [];
function check(name, ok, detail) {
  // eslint-disable-next-line no-console
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}
function note(msg) {
  // eslint-disable-next-line no-console
  console.log(`\x1b[36m[e2e:sandbox-baked]\x1b[0m ${msg}`);
}
function skip(reason) {
  // eslint-disable-next-line no-console
  console.log(`SKIP: ${reason}`);
  // eslint-disable-next-line no-console
  console.log(
    "(本 e2e 依赖本地 kind + agent-sandbox + docker;不满足即整套跳过,CI 不红)",
  );
  process.exit(0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 门控探测(任一不满足 → SKIP exit 0)
// ---------------------------------------------------------------------------

function tryCmd(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    return { ok: false, err: String(res.error?.message ?? res.stderr ?? "").trim() };
  }
  return { ok: true, stdout: res.stdout };
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function gate() {
  const kubectlCtx = tryCmd("kubectl", ["config", "current-context"]);
  if (!kubectlCtx.ok) skip(`kubectl 不可用/无当前 context:${kubectlCtx.err}`);

  const dep = tryCmd("kubectl", ["-n", NS, "get", "deploy", DEPLOY, "-o", "json"]);
  if (!dep.ok) skip(`集群不可达或 ${NS}/${DEPLOY} 未部署:${dep.err}`);
  let depJson;
  try {
    depJson = JSON.parse(dep.stdout);
  } catch {
    skip(`kubectl get deploy 输出非 JSON(集群异常)`);
  }
  if ((depJson?.status?.readyReplicas ?? 0) < 1) {
    skip(`${NS}/${DEPLOY} 无就绪副本(readyReplicas=0)`);
  }

  const docker = tryCmd("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (!docker.ok) skip(`docker daemon 不可用:${docker.err}`);

  const kind = tryCmd("kind", ["get", "clusters"]);
  if (!kind.ok) skip(`kind CLI 不可用:${kind.err}`);
  if (!kind.stdout.split("\n").map((s) => s.trim()).includes(KIND_CLUSTER)) {
    skip(`kind 集群 ${KIND_CLUSTER} 不存在(现有:${kind.stdout.trim() || "无"})`);
  }

  const img = tryCmd("docker", ["image", "inspect", BASE_IMAGE]);
  if (!img.ok) skip(`基座镜像 ${BASE_IMAGE} 本地不存在(docker image inspect 失败)`);

  for (const port of [SANDBOX_API, SANDBOX_VITE, LOCAL_API, LOCAL_VITE, PROXY_PORT]) {
    if (!(await portFree(port))) {
      skip(`端口 :${port} 被占用(疑似另一套 dev 在跑,不抢占)`);
    }
  }
  note(
    `门控通过:context=${kubectlCtx.stdout.trim()} / ${NS}/${DEPLOY} 就绪 / docker ${docker.stdout.trim()} / kind ${KIND_CLUSTER} / 基座 ${BASE_IMAGE}`,
  );
}

// ---------------------------------------------------------------------------
// dev 进程管理(输出捕获 + 级联收尾)
// ---------------------------------------------------------------------------

const running = [];

function spawnDev(label, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 独立进程组:兜底能对整组补刀,不留孤儿
  });
  const buf = { out: "" };
  const tee = (chunk) => {
    const text = chunk.toString();
    buf.out += text;
    for (const line of text.split("\n")) {
      if (line.trim() !== "") process.stdout.write(`  [${label}] ${line}\n`);
    }
  };
  child.stdout.on("data", tee);
  child.stderr.on("data", tee);
  const entry = { label, child, buf };
  running.push(entry);
  return entry;
}

async function stopDev(entry) {
  const { child, label } = entry;
  if (child.exitCode !== null || child.signalCode !== null) return;
  note(`收尾 ${label}(SIGINT 级联)…`);
  child.kill("SIGINT");
  const deadline = Date.now() + 15_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await sleep(300);
  }
  // 兜底:整组补刀(detached 起的独立进程组)
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* 组已不存在 = 干净退出 */
  }
}

async function stopAll() {
  for (const entry of [...running].reverse()) {
    await stopDev(entry);
  }
}

async function waitHttpReady(base, timeoutMs, entry) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (entry.child.exitCode !== null) {
      throw new Error(
        `${entry.label} 提前退出(exit ${entry.child.exitCode});末段输出:\n${entry.buf.out.slice(-2000)}`,
      );
    }
    try {
      const res = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* 未就绪,重试 */
    }
    await sleep(500);
  }
  throw new Error(`${entry.label} ${base} 在 ${timeoutMs}ms 内未就绪`);
}

// ---------------------------------------------------------------------------
// SSE 客户端(收集帧;heartbeat 注释忽略)
// ---------------------------------------------------------------------------

function openSse(url) {
  const frames = [];
  const controller = new AbortController();
  let buffer = "";
  const done = (async () => {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!res.ok || res.body === null) {
      throw new Error(`SSE ${url} → HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue; // 心跳注释等
          try {
            frames.push({ at: Date.now(), frame: JSON.parse(dataLines.join("\n")) });
          } catch {
            /* 非 JSON data 忽略 */
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    }
  })();
  return {
    frames,
    close: () => controller.abort(),
    done: done.catch(() => {}),
  };
}

async function waitFrame(sse, predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  for (;;) {
    for (; seen < sse.frames.length; seen += 1) {
      const f = sse.frames[seen].frame;
      if (predicate(f)) return f;
    }
    if (Date.now() > deadline) {
      const tail = sse.frames
        .slice(-8)
        .map((x) => JSON.stringify(x.frame).slice(0, 200))
        .join("\n  ");
      throw new Error(`等待帧超时(${what},${timeoutMs}ms);末段帧:\n  ${tail}`);
    }
    await sleep(250);
  }
}

// ---------------------------------------------------------------------------
// REST 捕获 + 规范化
// ---------------------------------------------------------------------------

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { __nonJson: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

/** commands 规范化:剔除 sourceInfo(路径/序号载体),按 name 排序。 */
function normalizeCommands(commands) {
  return [...(commands ?? [])]
    .map((c) => {
      const { sourceInfo: _drop, ...rest } = c;
      return rest;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * commands 按来源分区(见文件头「规范化规则」):
 *   agentDeclared = sourceInfo.source === "inline"(agent extensions 进程内装配面);
 *   hostEnv       = 其余(宿主 user-scope 个人包 + local 分支强注入的平台扩展)。
 */
function partitionCommands(commands) {
  const agentDeclared = [];
  const hostEnv = [];
  for (const c of commands ?? []) {
    if (c?.sourceInfo?.source === "inline") agentDeclared.push(c);
    else hostEnv.push(c);
  }
  return { agentDeclared, hostEnv };
}

function normalizeCompletionItems(items) {
  return [...(items ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalizeRoutes(routes) {
  return [...(routes ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** 通用 deep-diff:返回不一致路径列表 [{path, a, b}](全量,供逐项证据打印)。 */
function deepDiff(a, b, prefix = "", out = []) {
  if (Object.is(a, b)) return out;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb || (ta !== "object" && ta !== "array")) {
    out.push({ path: prefix || "(root)", a, b });
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    deepDiff(a?.[key], b?.[key], prefix === "" ? String(key) : `${prefix}.${key}`, out);
  }
  return out;
}

function parityCheck(name, a, b, extra) {
  const diffs = deepDiff(a, b);
  const ok = diffs.length === 0;
  check(`装配面一致[${name}]${extra ? ` ${extra}` : ""}`, ok);
  if (!ok) {
    for (const d of diffs.slice(0, 20)) {
      // eslint-disable-next-line no-console
      console.log(
        `    Δ ${d.path}: 沙盒=${JSON.stringify(d.a)?.slice(0, 160)} 非沙盒=${JSON.stringify(d.b)?.slice(0, 160)}`,
      );
    }
    if (diffs.length > 20) {
      // eslint-disable-next-line no-console
      console.log(`    …共 ${diffs.length} 处不一致`);
    }
  }
  return ok;
}

/**
 * 对一个 dev 面(base = http://127.0.0.1:<port>)完成:建会话 → 等就绪握手 →
 * 抓装配面(REST + SSE 粘性帧)→ prompt 流式 → 删会话。返回捕获物。
 */
async function captureSurface(base, label, promptMarker) {
  const capture = { label };

  // 1) 建会话
  const create = await getJson(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: CANVAS_DIR, trust: true }),
  });
  if (create.status !== 201) {
    throw new Error(
      `[${label}] POST /sessions → ${create.status} ${JSON.stringify(create.json).slice(0, 300)}`,
    );
  }
  const sid = create.json.sessionId;
  note(`[${label}] 会话 ${sid} 已创建,等待就绪握手…`);
  capture.sessionId = sid;

  const sse = openSse(`${base}/api/sessions/${sid}/stream`);
  try {
    // 2) 就绪握手(Req 4.4):粘性 session-status → ready(冷启动期呈 initializing/connecting)
    const status = await waitFrame(
      sse,
      (f) =>
        f.kind === "control" &&
        f.payload?.control === "session-status" &&
        (f.payload.state === "ready" || f.payload.state === "error"),
      180_000,
      `${label} session-status ready`,
    );
    if (status.payload.state !== "ready") {
      // 已知失败签名(2026-07-15 定位):probe-timeout + 沙箱 Pod 正常 = WS 路由名派生
      // 未镜像 agent-sandbox 的 63 字符截断(sandbox-ws-transport.ts #endpointFor),
      // 长模板名(如烘焙模板)全部命中;短模板 piweb-demo 不受影响。
      const hint =
        label === "sandbox" && status.payload.code === "probe-timeout"
          ? "\n  提示:若沙箱 Pod Running 而 WS 连不上 runner,检查 SandboxWsTransport 的路由名" +
            "派生是否截断到 63 字符(K8s 名字上限;manager 实际 sandbox 名被截断," +
            "全长派生名会 502 pod not found)。"
          : "";
      throw new Error(
        `[${label}] 就绪握手失败:session-status=${JSON.stringify(status.payload)}${hint}`,
      );
    }
    capture.ready = true;

    // 3) surface 快照(state/surface 桥,Req 1.4):粘性 control:state key=surface:canvas
    const stateFrame = await waitFrame(
      sse,
      (f) =>
        f.kind === "control" &&
        f.payload?.control === "state" &&
        f.payload.key === "surface:canvas",
      30_000,
      `${label} control:state surface:canvas`,
    );
    const { rev: _rev, ...surfacePayload } = stateFrame.payload;
    capture.surfaceState = surfacePayload;

    // 4) REST 装配面
    const commands = await getJson(`${base}/api/sessions/${sid}/commands`);
    capture.commandsStatus = commands.status;
    capture.commandsRaw = commands.json.commands ?? [];
    const parts = partitionCommands(capture.commandsRaw);
    capture.commandsAgent = normalizeCommands(parts.agentDeclared);
    capture.commandsHostEnv = normalizeCommands(parts.hostEnv);

    const completion = await getJson(
      `${base}/api/sessions/${sid}/completion?trigger=${encodeURIComponent("/")}&q=`,
    );
    capture.completionStatus = completion.status;
    capture.slashItems = normalizeCompletionItems(completion.json.items);
    capture.slashGroups = completion.json.groups ?? [];

    const triggers = await getJson(`${base}/api/sessions/${sid}/completion/triggers`);
    capture.triggers = triggers.json.triggers ?? [];

    const routes = await getJson(`${base}/api/sessions/${sid}/agent-routes`);
    capture.routesStatus = routes.status;
    capture.routes = normalizeRoutes(routes.json.routes);

    const galleryStats = await getJson(
      `${base}/api/sessions/${sid}/agent-routes/gallery-stats`,
    );
    capture.galleryStats = { status: galleryStats.status, body: galleryStats.json };

    const webext = await getJson(
      `${base}/api/webext/resolve?source=${encodeURIComponent(CANVAS_DIR)}`,
    );
    capture.webextResolve = { status: webext.status, body: webext.json };

    // 5) prompt 流式(装配面是硬断言,prompt 完整回复是尽力断言——沙盒面可能缺
    //    provider 凭据/模型配置,则「会话接受 prompt 且返回流」即证数据面往返)
    const framesBefore = sse.frames.length;
    const prompt = await getJson(`${base}/api/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Reply with exactly: ${promptMarker}` }),
    });
    capture.promptAccepted = prompt.status >= 200 && prompt.status < 300;
    const promptDeadline = Date.now() + 60_000;
    let sawChunk = false;
    let sawText = false;
    while (Date.now() < promptDeadline) {
      const fresh = sse.frames.slice(framesBefore);
      sawChunk = fresh.length > 0;
      sawText = fresh.some(
        (x) =>
          x.frame.kind === "uiMessageChunk" &&
          JSON.stringify(x.frame).includes(promptMarker),
      );
      if (sawText) break;
      // agent_end / error 等任何回帧即满足「返回流」;marker 出现即满足完整回复
      if (
        sawChunk &&
        sse.frames
          .slice(framesBefore)
          .some(
            (x) =>
              JSON.stringify(x.frame).includes('"finish"') ||
              (x.frame.kind === "control" && x.frame.payload?.control === "error"),
          )
      ) {
        break;
      }
      await sleep(500);
    }
    const fresh = sse.frames.slice(framesBefore);
    capture.promptStreamed = sawChunk;
    capture.promptFullReply = sawText;
    capture.promptFrameKinds = [...new Set(fresh.map((x) => x.frame.kind))];
    capture.promptSample = fresh
      .slice(0, 6)
      .map((x) => JSON.stringify(x.frame).slice(0, 160));
  } finally {
    sse.close();
    await sse.done;
    await getJson(`${base}/api/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
  }
  return capture;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  await gate();

  // 模板名与 dev-e2b-local / 构建脚本同一套纯函数派生(两侧命名恒一致)
  const { loadBakePlanModule, createNodeBakeFs } = await import(
    "../scripts/build-agent-image.mjs"
  );
  const { computeBakePlan } = await loadBakePlanModule();
  const planRes = computeBakePlan(
    { sourceDir: CANVAS_DIR, baseImage: BASE_IMAGE, bundle: true },
    createNodeBakeFs(),
  );
  if (!planRes.ok) {
    throw new Error(`烘焙计划失败 [${planRes.error.code}] ${planRes.error.detail}`);
  }
  const plan = planRes.value;
  note(`被测镜像:${plan.imageName} / 模板:${plan.templateName}`);

  let sandboxCap;
  let localCap;
  let negative = {};
  let sandboxEntry;
  try {
    // ── Phase A:烘焙 + 沙盒 dev(e2b/ws-runner)────────────────────────────
    // PI_WEB_E2B_BAKE_SOURCE 一条龙:build → kind load → register → 注入 TEMPLATE_MAP → dev。
    // PI_WEB_E2B_TEMPLATE=""(trim 后视为未设)刻意置空全局模板:
    //   ① 正路径证明 source 命中的是 map 里的烘焙模板(不可能静默落全局);
    //   ② 负路径(未接线 source)三级解析全空 → 会话创建 500 + stderr 修复指引(Req 3.4)。
    sandboxEntry = spawnDev("sandbox-dev", path.join(ROOT, "scripts", "dev-e2b-local.mjs"), {
      PI_WEB_E2B_BAKE_SOURCE: CANVAS_DIR,
      PI_WEB_E2B_TEMPLATE: "",
      PORT: String(SANDBOX_API),
      PI_WEB_DEV_CLIENT_PORT: String(SANDBOX_VITE),
    });
    note("沙盒 dev 启动中(bake → kind load → register → port-forward → dev)…");
    await waitHttpReady(`http://127.0.0.1:${SANDBOX_API}`, 420_000, sandboxEntry);
    check("沙盒 dev(e2b/ws-runner+烘焙)就绪", true);

    sandboxCap = await captureSurface(
      `http://127.0.0.1:${SANDBOX_API}`,
      "sandbox",
      "SANDBOX_PARITY_OK",
    );
    check("沙盒会话就绪握手完成(Req 4.4:冷启动→ready,非错误)", sandboxCap.ready === true);

    // ── 负路径(Req 3.4):未接线 source → 三级解析全空 → 500 + stderr 三路径指引 ──
    const stderrMark = sandboxEntry.buf.out.length;
    const neg = await getJson(`http://127.0.0.1:${SANDBOX_API}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: NEG_DIR, trust: true }),
    });
    await sleep(1000); // stderr flush
    const negOut = sandboxEntry.buf.out.slice(stderrMark);
    negative = {
      status: neg.status,
      body: neg.json,
      stderrHasResolveError: negOut.includes("解析沙箱模板"),
      stderrHasMapPath: negOut.includes("PI_WEB_E2B_TEMPLATE_MAP"),
      stderrHasDerivePath: negOut.includes("PI_WEB_E2B_TEMPLATE_DERIVE"),
      // 修复路径 3 的原文是「设 PI_WEB_E2B_TEMPLATE 指定全局模板」(无 = 号,
      // 见 template-resolve.ts templateResolveMissingMessage)。
      stderrHasGlobalPath: negOut.includes("PI_WEB_E2B_TEMPLATE 指定全局模板"),
    };
    check("负路径:未接线 source 会话创建失败(HTTP 500)", neg.status === 500);
    check(
      "负路径:响应体不泄露解析细节(仅通用 INTERNAL)",
      neg.json?.error?.code === "INTERNAL" &&
        !JSON.stringify(neg.json).includes("PI_WEB_E2B_TEMPLATE"),
    );
    check(
      "负路径:dev 进程 stderr 含修复指引(解析错误 + 三条修复路径关键词)",
      negative.stderrHasResolveError &&
        negative.stderrHasMapPath &&
        negative.stderrHasDerivePath &&
        negative.stderrHasGlobalPath,
      `resolveErr=${negative.stderrHasResolveError} map=${negative.stderrHasMapPath} derive=${negative.stderrHasDerivePath} global=${negative.stderrHasGlobalPath}`,
    );

    // 佐证:沙盒 Pod 用的就是烘焙镜像(信息性,不断言 Pod 仍存活——会话已删)
    const pods = tryCmd("kubectl", [
      "-n",
      NS,
      "get",
      "pods",
      "-o",
      "jsonpath={range .items[*]}{.spec.containers[0].image}{\"\\n\"}{end}",
    ]);
    if (pods.ok && pods.stdout.includes(plan.imageName)) {
      note(`佐证:集群内存在使用烘焙镜像 ${plan.imageName} 的 Pod`);
    }

    await stopDev(sandboxEntry);

    // ── Phase B:非沙盒基线 dev(local 模式,同源 agent)────────────────────
    const localEntry = spawnDev("local-dev", path.join(ROOT, "scripts", "dev-all.mjs"), {
      PORT: String(LOCAL_API),
      PI_WEB_DEV_API_PORT: String(LOCAL_API),
      PI_WEB_DEV_CLIENT_PORT: String(LOCAL_VITE),
    });
    await waitHttpReady(`http://127.0.0.1:${LOCAL_API}`, 120_000, localEntry);
    check("非沙盒基线 dev(local 模式)就绪", true);

    localCap = await captureSurface(
      `http://127.0.0.1:${LOCAL_API}`,
      "local",
      "LOCAL_PARITY_OK",
    );
    check("非沙盒会话就绪握手完成", localCap.ready === true);

    await stopDev(localEntry);
  } finally {
    await stopAll();
  }

  // ── Phase C:规范化 diff(逐项一致断言)────────────────────────────────────
  note("── 装配面逐项对照(沙盒 vs 非沙盒,规范化后 deep-diff)──");

  const cmdNames = (sandboxCap.commandsAgent ?? []).map((c) => c.name);
  parityCheck(
    "commands·agent 声明面(extensions 进程内装配的命令清单)",
    sandboxCap.commandsAgent,
    localCap.commandsAgent,
    `(${cmdNames.length} 条:${cmdNames.join(", ")})`,
  );
  check(
    "commands 含 img_vision(visionExtension 已装配)",
    cmdNames.includes("img_vision"),
  );
  check(
    "commands 含 surface:canvas 探针(canvasSurfaceExtension 已装配)",
    cmdNames.includes("surface:canvas"),
  );
  // 宿主环境面方向性断言:沙盒不得凭空多出宿主级命令;local 多出的原样公示 + CONCERN。
  check(
    "沙盒侧无宿主环境级命令(user-scope/平台强注入不进不可变镜像)",
    (sandboxCap.commandsHostEnv ?? []).length === 0,
    (sandboxCap.commandsHostEnv ?? []).map((c) => c.name).join(", ") || "空",
  );
  const localHostEnvNames = (localCap.commandsHostEnv ?? []).map((c) => c.name);
  if (localHostEnvNames.length > 0) {
    concerns.push(
      `非沙盒侧存在 ${localHostEnvNames.length} 条宿主环境级命令(${localHostEnvNames.join(", ")}):` +
        "来自宿主 ~/.pi/agent 个人包与 local 分支强注入的平台扩展(pi-sandbox/ext-tools/auto-title)," +
        "按设计不进不可变镜像 ⇒ 沙盒会话缺这部分宿主级能力(含 auto-title 自动会话标题)——" +
        "属 e2b 模式既有行为差,非本 spec agent 声明面回归;是否补齐交人裁定",
    );
  }

  const slashIds = (sandboxCap.slashItems ?? []).map((i) => i.label ?? i.id);
  parityCheck(
    "slash 补全(装配期 slash_completions 声明帧)",
    sandboxCap.slashItems,
    localCap.slashItems,
    `(${slashIds.length} 条:${slashIds.join(", ")})`,
  );
  check(
    "slash 补全含 /img-gen 与 /img-edit(aigcSlashCompletions)",
    JSON.stringify(sandboxCap.slashItems).includes("img-gen") &&
      JSON.stringify(sandboxCap.slashItems).includes("img-edit"),
  );
  parityCheck("slash 补全分组", sandboxCap.slashGroups, localCap.slashGroups);
  parityCheck("completion 触发符", sandboxCap.triggers, localCap.triggers);

  parityCheck(
    "agent 声明路由(agent_routes 声明帧)",
    sandboxCap.routes,
    localCap.routes,
    `(${(sandboxCap.routes ?? []).map((r) => r.name).join(", ")})`,
  );
  check(
    "agent-routes 含 gallery-stats",
    (sandboxCap.routes ?? []).some((r) => r.name === "gallery-stats"),
  );
  parityCheck(
    "route 真实调用结果(handler 在 agent 进程内执行)",
    sandboxCap.galleryStats,
    localCap.galleryStats,
    `(status=${sandboxCap.galleryStats?.status})`,
  );

  parityCheck(
    "surface:canvas 权威快照(state/surface 桥;剔 rev)",
    sandboxCap.surfaceState,
    localCap.surfaceState,
  );

  parityCheck(
    "webext 解析面(布局/贡献声明入口)",
    sandboxCap.webextResolve,
    localCap.webextResolve,
  );

  // prompt 流式(Req 1.1/6.2):沙盒是主验收对象;完整回复为尽力断言
  check("沙盒会话接受 prompt(2xx)", sandboxCap.promptAccepted === true);
  check(
    "沙盒 prompt 返回流(数据面往返)",
    sandboxCap.promptStreamed === true,
    `帧类别=${(sandboxCap.promptFrameKinds ?? []).join(",")}`,
  );
  if (!sandboxCap.promptFullReply) {
    concerns.push(
      "沙盒 prompt 未取得完整 LLM 回复(沙箱内无 provider 凭据/模型配置时的预期降级);" +
        "数据面往返已由回流帧与 gallery-stats route 调用证明",
    );
  } else {
    check("沙盒 prompt 完整流式回复(含 marker)", true);
  }
  check("非沙盒会话接受 prompt(2xx)", localCap.promptAccepted === true);
  check("非沙盒 prompt 返回流", localCap.promptStreamed === true);

  // ── 证据落盘 ───────────────────────────────────────────────────────────────
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = path.join(EVIDENCE_DIR, "assembly-parity.json");
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        image: plan.imageName,
        template: plan.templateName,
        sandbox: sandboxCap,
        local: localCap,
        negative,
        concerns,
        failures,
      },
      null,
      2,
    ),
  );
  note(`证据已写入 ${evidencePath}`);

  for (const c of concerns) {
    // eslint-disable-next-line no-console
    console.log(`⚠ CONCERN: ${c}`);
  }
  // eslint-disable-next-line no-console
  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(`\x1b[31m[e2e:sandbox-baked] 失败:${err?.stack ?? err}\x1b[0m`);
  // 失败诊断:dev 输出末段(负路径/就绪失败的服务端根因都在这里)。
  for (const entry of running) {
    // eslint-disable-next-line no-console
    console.error(`--- ${entry.label} 输出末段 ---\n${entry.buf.out.slice(-1500)}`);
  }
  await stopAll();
  process.exit(1);
});
