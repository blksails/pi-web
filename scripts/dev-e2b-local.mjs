#!/usr/bin/env node
/**
 * dev:e2b:local —— 本地连 e2b(开源 agent-sandbox,与 ACS ack-sandbox-manager 同协议)起 pi-web dev。
 *
 * 自动编排:
 *   1) 从 kind 里的 agent-sandbox Deployment 读 SYSTEM_TOKEN(= E2B_API_KEY,无需手填)
 *   2) `kubectl port-forward svc/agent-sandbox 10000:80`(若未起)
 *   3) 起本地反代 scripts/e2b-local-proxy.mjs(:13000 -> :10000/e2b/v1,Host: localhost)
 *   4) 组装 e2b env(PI_WEB_TRANSPORT=e2b / E2B_API_URL 指反代 / E2B_DOMAIN / validateApiKey=false)
 *      + 隔离 dev 端口(默认 3020/5183,避开别的 worktree 占的 3000/5173)
 *   5) 跑 `node scripts/dev-all.mjs`;Ctrl-C / 子进程退出时收尾 port-forward + 反代
 *
 * 前置:本地 kind 集群跑着 agent-sandbox(见 pi-clouds docs/real-machine-verification-checklist §8)。
 *
 * ⚠ 数据面限制(必读):agent-sandbox 的运行时镜像**没有 e2b envd**,而 pi-web 的 E2bTransport
 * 走 e2b SDK `commands.run`(envd 数据面)。故本任务只连通**控制面**(建/销沙箱);网页发 prompt
 * 后 runner 无法在沙箱内起(commands.run 失败)。**完整 agent 闭环需真实 e2b 云**(有 envd),或
 * 后续给 pi-web 加 WS-runner 数据面传输(对齐 pi-clouds @pi-clouds/sandbox)。
 * 本任务用于:开发/联调 e2b 传输的控制面切换、建/销、错误传播,以及本地起 e2b 模式的装配路径。
 *
 * 可调 env:AGENT_SANDBOX_NS / AGENT_SANDBOX_SVC / E2B_MANAGER_PORT / E2B_PROXY_PORT /
 *          PI_WEB_E2B_TEMPLATE / PORT / PI_WEB_DEV_CLIENT_PORT / E2B_API_KEY(显式则不自动取)
 *
 * 烘焙闭环(spec sandbox-baked-agent-image,任务 5.1;Req 6.1/6.3):
 *   PI_WEB_E2B_BAKE_SOURCE=<agent source 目录> 时,起 dev 前先跑
 *   `scripts/build-agent-image.mjs <dir> --kind-load --register`(构建镜像 → 加载 kind →
 *   注册 agent-sandbox 模板),再把 `{<dir绝对路径>: <templateName>}` 注入
 *   PI_WEB_E2B_TEMPLATE_MAP(用户已显式配同键时用户优先)后起 dev——单命令从源目录到
 *   可用沙盒 dev。未设置该 env 时行为与从前完全一致(零行为变化)。
 *   操作文档:docs/sandbox-baked-agent-image.md。
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NS = process.env.AGENT_SANDBOX_NS ?? "agent-sandbox";
const SVC = process.env.AGENT_SANDBOX_SVC ?? "agent-sandbox";
const MANAGER_PORT = Number(process.env.E2B_MANAGER_PORT ?? 10000);
const PROXY_PORT = Number(process.env.E2B_PROXY_PORT ?? 13000);
// 默认 ws-runner 数据面 + piweb-demo 模板(镜像内置 agent-runner + stub-agent):完整闭环。
// 换 piweb-pi(真 pi --mode rpc)需先建并注册该镜像(见 dev-e2b-local 顶部/README)。
const DATA_PLANE = process.env.PI_WEB_E2B_DATAPLANE ?? "ws-runner";
const TEMPLATE = process.env.PI_WEB_E2B_TEMPLATE ?? (DATA_PLANE === "ws-runner" ? "piweb-demo" : "aio");
const RUNNER_PORT = process.env.PI_WEB_E2B_RUNNER_PORT ?? "8080";
const DEV_API_PORT = process.env.PORT ?? "3020";
const DEV_CLIENT_PORT = process.env.PI_WEB_DEV_CLIENT_PORT ?? "5183";
// 可选烘焙源目录:设了就在起 dev 前先「构建镜像 → kind load → 注册模板」一条龙。
const BAKE_SOURCE = process.env.PI_WEB_E2B_BAKE_SOURCE;

const procs = [];
let exiting = false;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`\x1b[36m[dev:e2b:local]\x1b[0m ${msg}`);
}
function die(msg) {
  // eslint-disable-next-line no-console
  console.error(`\x1b[31m[dev:e2b:local] ${msg}\x1b[0m`);
  shutdown(1);
}

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const p of procs) {
    if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
  }
  process.exitCode = code ?? 0;
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** 从 agent-sandbox Deployment 读 SYSTEM_TOKEN(= E2B_API_KEY)。 */
function fetchSystemToken() {
  if (process.env.E2B_API_KEY) {
    log("E2B_API_KEY 已由 env 提供,跳过自动读取。");
    return process.env.E2B_API_KEY;
  }
  try {
    const json = execFileSync(
      "kubectl",
      ["-n", NS, "get", "deploy", SVC, "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const dep = JSON.parse(json);
    const envs = dep?.spec?.template?.spec?.containers?.[0]?.env ?? [];
    const tok = envs.find((e) => e.name === "SYSTEM_TOKEN")?.value;
    if (!tok) throw new Error("SYSTEM_TOKEN 不在 Deployment env 中");
    log(`已从 ${NS}/${SVC} 读取 SYSTEM_TOKEN(E2B_API_KEY)。`);
    return tok;
  } catch (e) {
    die(
      `无法从 kind 读取 agent-sandbox SYSTEM_TOKEN:${String(e.message ?? e)}\n` +
        `请确认本地 kind 集群已起 agent-sandbox(kubectl -n ${NS} get deploy ${SVC}),` +
        `或显式设置 E2B_API_KEY 后重试。`,
    );
    return "";
  }
}

function portListening(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/healthz", timeout: 1500 },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensurePortForward() {
  if (await portListening(MANAGER_PORT)) {
    log(`manager :${MANAGER_PORT} 已在转发,复用。`);
    return;
  }
  log(`kubectl port-forward svc/${SVC} ${MANAGER_PORT}:80 …`);
  const pf = spawn(
    "kubectl",
    ["-n", NS, "port-forward", `svc/${SVC}`, `${MANAGER_PORT}:80`],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  pf.on("exit", (c) => !exiting && die(`port-forward 退出(code=${c})`));
  procs.push(pf);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portListening(MANAGER_PORT)) {
      log(`manager :${MANAGER_PORT} 就绪。`);
      return;
    }
  }
  die(`port-forward 起后 manager :${MANAGER_PORT} 仍不可达`);
}

function startProxy() {
  log(`起本地反代 :${PROXY_PORT} -> :${MANAGER_PORT}/e2b/v1`);
  const proxy = spawn(
    process.execPath,
    [path.join(root, "scripts", "e2b-local-proxy.mjs")],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        PROXY_PORT: String(PROXY_PORT),
        UPSTREAM_PORT: String(MANAGER_PORT),
      },
    },
  );
  proxy.on("exit", (c) => !exiting && die(`反代退出(code=${c})`));
  procs.push(proxy);
}

function startDev(env) {
  log(
    `起 pi-web dev(e2b 模式):API :${DEV_API_PORT} / vite :${DEV_CLIENT_PORT} / template=${TEMPLATE}`,
  );
  const dev = spawn(process.execPath, [path.join(root, "scripts", "dev-all.mjs")], {
    stdio: ["inherit", "inherit", "inherit"],
    env,
  });
  dev.on("exit", (c) => shutdown(c ?? 0));
  procs.push(dev);
}

// ---------------------------------------------------------------------------
// 烘焙阶段(PI_WEB_E2B_BAKE_SOURCE;未设置时以下代码完全不参与)
// ---------------------------------------------------------------------------

/**
 * 计算烘焙计划拿 templateName(不落盘不构建):直接 import build-agent-image.mjs
 * 导出的 loadBakePlanModule/createNodeBakeFs,在本进程跑 computeBakePlan——与随后
 * spawn 的构建脚本走同一套纯函数与同样缺省(bundle、tag=内容哈希),两侧命名恒一致
 * (比解析构建 stdout 稳;3.3 集成测试已钉住该导出面可 import)。
 */
async function computeBakeTemplate(sourceDir) {
  const { loadBakePlanModule, createNodeBakeFs } = await import(
    "./build-agent-image.mjs"
  );
  const { computeBakePlan } = await loadBakePlanModule();
  // baseImage 不参与镜像名/模板名派生(只进 Dockerfile 文本),此处取值仅为满足入参;
  // 与 build-agent-image.mjs 缺省保持同源(env 覆盖 → 同一缺省字面量)。
  const baseImage =
    process.env.PI_WEB_E2B_BASE_IMAGE ?? "pi-clouds/agent-runner:pi";
  const result = computeBakePlan(
    { sourceDir, baseImage, bundle: true },
    createNodeBakeFs(),
  );
  if (!result.ok) {
    die(
      `烘焙计划失败 [${result.error.code}] ${result.error.detail}\n` +
        `请确认 PI_WEB_E2B_BAKE_SOURCE 指向一个含入口 index.js/index.ts 的 agent source 目录` +
        `(当前解析为 ${sourceDir}),或去掉该 env 用预注册模板起 dev。`,
    );
    return undefined;
  }
  return result.value;
}

/**
 * 跑构建一条龙:build → kind load → 注册模板(spawn 构建脚本,stdio 继承让用户
 * 看到每一步;步骤级错误指引由 build-agent-image.mjs 自带,Req 6.3)。
 * 成功返回 { sourceDir, templateName };失败 die(不起 dev)。
 *
 * ⚠ 时序:--register 会 rollout restart agent-sandbox,已建立的 kubectl port-forward
 * 会随旧 Pod 一起断(其 exit 钩子会 die 整个编排)。故本阶段必须在 ensurePortForward
 * **之前**跑:fetchSystemToken 已证明 kubectl 可用且 deploy 存在(集群前置就绪),
 * bake 完(manager 已重启就绪)再对新 Pod 建 port-forward。
 */
async function runBakeStage() {
  const sourceDir = path.resolve(BAKE_SOURCE);
  const plan = await computeBakeTemplate(sourceDir);
  if (plan === undefined || exiting) return undefined;

  log(`bake:${sourceDir} → 镜像 ${plan.imageName} / 模板 ${plan.templateName}`);
  log("bake:跑 build-agent-image --kind-load --register(输出如下)…");
  const res = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts", "build-agent-image.mjs"),
      sourceDir,
      "--kind-load",
      "--register",
    ],
    { stdio: "inherit" },
  );
  if (res.error) {
    die(`bake:构建脚本启动失败:${String(res.error.message ?? res.error)}`);
    return undefined;
  }
  if (res.status !== 0) {
    die(
      `bake 阶段失败(exit ${res.status}),不起 dev。\n` +
        `上方 [build:agent-image] 已给出失败步骤(docker build / kind load / 模板注册)` +
        `的原始错误与修复建议,按其修复后重跑本命令;\n` +
        `或去掉 PI_WEB_E2B_BAKE_SOURCE,用已注册模板(PI_WEB_E2B_TEMPLATE=${TEMPLATE})起 dev。`,
    );
    return undefined;
  }
  return { sourceDir, templateName: plan.templateName };
}

/**
 * 合并 PI_WEB_E2B_TEMPLATE_MAP:用户显式配置优先——同键已存在则不覆盖,烘焙项仅
 * 在键缺失时补入。map 键用源目录**绝对路径**(resolver 会把 dir source 归一为绝对
 * policySource,resolveSandboxTemplate 的 policySource 级查找必命中;相对 source 串
 * 也经归一命中同键)。
 */
function mergeTemplateMap(userRaw, sourceDir, templateName) {
  if (userRaw === undefined || userRaw.trim() === "") {
    return JSON.stringify({ [sourceDir]: templateName });
  }
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (e) {
    die(
      `PI_WEB_E2B_TEMPLATE_MAP 不是合法 JSON,无法并入烘焙模板:${String(e?.message ?? e)}\n` +
        `请修正该 env(形如 {"<source>":"<模板名>"})或去掉它后重试。`,
    );
    return undefined;
  }
  if (user === null || typeof user !== "object" || Array.isArray(user)) {
    die(
      `PI_WEB_E2B_TEMPLATE_MAP 应为 JSON 对象(source → 模板名),实为 ${Array.isArray(user) ? "array" : typeof user}。`,
    );
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(user, sourceDir)) {
    log(
      `PI_WEB_E2B_TEMPLATE_MAP 已含键 ${sourceDir},用户显式配置优先(烘焙模板 ${templateName} 不覆盖)。`,
    );
    return userRaw;
  }
  return JSON.stringify({ ...user, [sourceDir]: templateName });
}

async function main() {
  const token = fetchSystemToken();

  // 烘焙阶段(可选):须在 ensurePortForward 之前(--register 的 rollout restart
  // 会断已有 port-forward,见 runBakeStage 文档)。
  let bake;
  let templateMapEnv;
  if (BAKE_SOURCE !== undefined && BAKE_SOURCE.trim() !== "") {
    if (exiting) return; // fetchSystemToken 失败(die)后不进 bake
    bake = await runBakeStage();
    if (bake === undefined || exiting) return;
    templateMapEnv = mergeTemplateMap(
      process.env.PI_WEB_E2B_TEMPLATE_MAP,
      bake.sourceDir,
      bake.templateName,
    );
    if (templateMapEnv === undefined || exiting) return;
  }

  await ensurePortForward();
  startProxy();

  const banner =
    DATA_PLANE === "ws-runner"
      ? " ✅ 数据面 = ws-runner(WS 连沙箱内 agent-runner,无需 envd)。\n" +
        `   模板=${TEMPLATE};piweb-demo=stub-agent(免 LLM),piweb-pi=真实 pi --mode rpc。\n` +
        (bake !== undefined
          ? `   bake 模式:source=${bake.sourceDir} → 模板=烘焙镜像 ${bake.templateName}(已注入 TEMPLATE_MAP)。\n`
          : "") +
        "   完整闭环:网页发 prompt → 沙箱内 agent 流式回复。\n" +
        "   前置:该模板须已注册(config-templates)且镜像已 kind load。"
      : " ⚠ 数据面 = envd(commands.run):agent-sandbox 无 envd,沙箱内 runner 起不来。\n" +
        "   完整 agent 闭环需真实 e2b 云。改用 PI_WEB_E2B_DATAPLANE=ws-runner 走本地闭环。";
  // eslint-disable-next-line no-console
  console.log(
    "\x1b[33m──────────────────────────────────────────────────────────────\n" +
      banner +
      "\n──────────────────────────────────────────────────────────────\x1b[0m",
  );

  const env = {
    ...process.env,
    // ── e2b 传输 ──
    PI_WEB_TRANSPORT: "e2b",
    PI_WEB_E2B_DATAPLANE: DATA_PLANE,
    E2B_API_KEY: token,
    E2B_API_URL: `http://127.0.0.1:${PROXY_PORT}`, // e2b 2.33 认此 env → 走本地反代控制面
    E2B_DOMAIN: `localhost:${MANAGER_PORT}`,
    PI_WEB_E2B_TEMPLATE: TEMPLATE,
    // bake 模式:烘焙 source → 模板名 映射(map 级命中优先于上面的全局模板;
    // 其他 source 仍走全局模板)。未设 BAKE_SOURCE 时不注入(零行为变化)。
    ...(templateMapEnv !== undefined
      ? { PI_WEB_E2B_TEMPLATE_MAP: templateMapEnv }
      : {}),
    PI_WEB_E2B_VALIDATE_API_KEY: "false", // agent-sandbox 用 sys-* token(非 e2b_ 格式)
    // ── ws-runner 数据面 ──
    PI_WEB_E2B_RUNNER_WS_BASE: `ws://127.0.0.1:${MANAGER_PORT}`,
    PI_WEB_E2B_RUNNER_PORT: RUNNER_PORT,
    // ── 隔离 dev 端口(避开别的 worktree)──
    PORT: DEV_API_PORT,
    PI_WEB_DEV_API_PORT: DEV_API_PORT,
    PI_WEB_DEV_CLIENT_PORT: DEV_CLIENT_PORT,
  };
  startDev(env);
}

main().catch((e) => die(String(e?.message ?? e)));
