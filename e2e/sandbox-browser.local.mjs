#!/usr/bin/env node
/**
 * 本地 kind 门控 **沙盒 Chrome e2e** 编排器 —— aigc-canvas-agent 真实链路全功能面。
 *
 * 编排(被测 spec = e2e/sandbox-browser/aigc-canvas-sandbox.e2e.ts):
 *   0) 门控:kubectl / agent-sandbox 就绪 / docker / kind / 基座镜像 / 端口 /
 *      OPENROUTER_API_KEY(真实生成凭据)——任一不满足 SKIP exit 0(CI 无 kind 不红);
 *   1) MinIO(容器 pi-e2e-minio :9000)确保在跑 + bucket `pi-attach` —— 全远程 S3 附件
 *      拓扑,宿主/沙箱子进程/浏览器三方同指一个 endpoint(宿主局域网 IP);
 *   2) bake hello-agent 模板(退化用例 T8 需要第二个可建会话的 source);
 *   3) Phase A:PI_WEB_E2B_BAKE_SOURCE 一条龙起沙盒 dev(API :3021 / vite :5184)
 *      → playwright(project=sandbox)跑全量 spec;
 *   4) Phase B:同附件拓扑/同凭据起非沙盒基线 dev(API :3022 / vite :5185)
 *      → 同一 spec 再跑一遍(project=local-baseline)—— 与 localhost:5173 主 dev 同构
 *      (local 模式),两面全绿即为「沙盒 vs 非沙盒」的对比验证。
 *
 * 跑法:`pnpm e2e:sandbox-browser`(或 node e2e/sandbox-browser.local.mjs)。
 * 可调 env:AGENT_SANDBOX_NS / AGENT_SANDBOX_SVC / PI_WEB_E2B_BASE_IMAGE / KIND_CLUSTER /
 *   PI_E2E_HOST_IP(缺省自动探测第一个非回环 IPv4)/ PI_E2E_GEN_MODEL / PI_E2E_VISION_MODEL /
 *   APISERVICES_API_KEY(缺省从 ~/.pi/agent/models.json 的 apiservices.apiKey 兜底;
 *   两处都没有 → T6/T7 视觉用例 skip,其余照跑)/ PI_E2E_PHASE(sandbox|baseline|both,缺省 both)。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANVAS_DIR = path.join(ROOT, "examples", "aigc-canvas-agent");
const HELLO_DIR = path.join(ROOT, "examples", "hello-agent");
const NS = process.env.AGENT_SANDBOX_NS ?? "agent-sandbox";
const DEPLOY = process.env.AGENT_SANDBOX_SVC ?? "agent-sandbox";
const KIND_CLUSTER = process.env.KIND_CLUSTER ?? "pi-clouds";
const BASE_IMAGE = process.env.PI_WEB_E2B_BASE_IMAGE ?? "pi-clouds/agent-runner:pi";
const PHASE = process.env.PI_E2E_PHASE ?? "both";

const SANDBOX_API = 3021;
const SANDBOX_VITE = 5184;
const LOCAL_API = 3022;
const LOCAL_VITE = 5185;
const PROXY_PORT = 13000;
const MINIO_PORT = 9000;
const MINIO_NAME = "pi-e2e-minio";
const MINIO_AK = "pie2eminio";
const MINIO_SK = "pie2eminio-secret";
const MINIO_BUCKET = "pi-attach";
const MINIO_IMAGE =
  process.env.PI_E2E_MINIO_IMAGE ?? "hub.dockerblksails.cc/minio/minio:latest";

function note(msg) {
  // eslint-disable-next-line no-console
  console.log(`\x1b[36m[e2e:sandbox-browser]\x1b[0m ${msg}`);
}
function skip(reason) {
  // eslint-disable-next-line no-console
  console.log(`SKIP: ${reason}`);
  // eslint-disable-next-line no-console
  console.log("(本 e2e 依赖本地 kind + agent-sandbox + docker + 真实凭据;不满足即整套跳过)");
  process.exit(0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 宿主局域网 IPv4(宿主进程 / 浏览器 / kind Pod 三方可达的同一地址)。 */
function detectHostIp() {
  if (process.env.PI_E2E_HOST_IP) return process.env.PI_E2E_HOST_IP;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name.startsWith("lo") || name.startsWith("utun")) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      return a.address;
    }
  }
  return undefined;
}

/** APISERVICES key:env 优先,缺省从宿主 ~/.pi/agent/models.json 兜底(不打印)。 */
function resolveApiservicesKey() {
  if (process.env.APISERVICES_API_KEY) return process.env.APISERVICES_API_KEY;
  try {
    const models = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "models.json"), "utf8"),
    );
    const key = models?.providers?.apiservices?.apiKey;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
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
    skip("kubectl get deploy 输出非 JSON(集群异常)");
  }
  if ((depJson?.status?.readyReplicas ?? 0) < 1) skip(`${NS}/${DEPLOY} 无就绪副本`);

  const docker = tryCmd("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (!docker.ok) skip(`docker daemon 不可用:${docker.err}`);
  const kind = tryCmd("kind", ["get", "clusters"]);
  if (!kind.ok) skip(`kind CLI 不可用:${kind.err}`);
  if (!kind.stdout.split("\n").map((s) => s.trim()).includes(KIND_CLUSTER)) {
    skip(`kind 集群 ${KIND_CLUSTER} 不存在`);
  }
  const img = tryCmd("docker", ["image", "inspect", BASE_IMAGE]);
  if (!img.ok) skip(`基座镜像 ${BASE_IMAGE} 本地不存在`);

  if (!process.env.OPENROUTER_API_KEY) {
    skip("缺 OPENROUTER_API_KEY(真实图像生成凭据)");
  }

  const ports = [];
  if (PHASE !== "baseline") ports.push(PROXY_PORT, SANDBOX_API, SANDBOX_VITE);
  if (PHASE !== "sandbox") ports.push(LOCAL_API, LOCAL_VITE);
  for (const port of ports) {
    if (!(await portFree(port))) skip(`端口 :${port} 被占用(疑似另一套 dev 在跑,不抢占)`);
  }

  const hostIp = detectHostIp();
  if (hostIp === undefined) skip("探测不到宿主局域网 IPv4(可用 PI_E2E_HOST_IP 显式指定)");
  note(`门控通过:context=${kubectlCtx.stdout.trim()} / 宿主 IP ${hostIp}`);
  return { hostIp };
}

/** MinIO 就绪(幂等):容器在跑 + 健康 + bucket 存在。 */
async function ensureMinio() {
  const running = tryCmd("docker", ["inspect", "-f", "{{.State.Running}}", MINIO_NAME]);
  if (!running.ok || running.stdout.trim() !== "true") {
    tryCmd("docker", ["rm", "-f", MINIO_NAME]);
    const run = tryCmd("docker", [
      "run", "-d", "--name", MINIO_NAME, "-p", `${MINIO_PORT}:9000`,
      "-e", `MINIO_ROOT_USER=${MINIO_AK}`, "-e", `MINIO_ROOT_PASSWORD=${MINIO_SK}`,
      MINIO_IMAGE, "server", "/data",
    ]);
    if (!run.ok) skip(`MinIO 容器启动失败:${run.err}`);
  }
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${MINIO_PORT}/minio/health/live`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) break;
    } catch {
      /* 未就绪 */
    }
    if (i === 29) skip("MinIO 健康检查超时");
    await sleep(1000);
  }
  const mb = tryCmd("docker", [
    "exec", MINIO_NAME, "sh", "-c",
    `mc alias set local http://127.0.0.1:9000 ${MINIO_AK} ${MINIO_SK} >/dev/null && mc mb --ignore-existing local/${MINIO_BUCKET}`,
  ]);
  if (!mb.ok) skip(`MinIO bucket 创建失败:${mb.err}`);
  note(`MinIO 就绪(:${MINIO_PORT},bucket=${MINIO_BUCKET})`);
}

/** 全远程 S3 附件拓扑(宿主/沙箱/浏览器三方同一 endpoint)。 */
function attachmentEnv(hostIp) {
  return {
    PI_WEB_ATTACHMENT_BACKENDS: JSON.stringify({
      backends: [
        {
          kind: "s3",
          name: "minio",
          bucket: MINIO_BUCKET,
          region: "us-east-1",
          endpoint: `http://${hostIp}:${MINIO_PORT}`,
          forcePathStyle: true,
          accessKeyEnv: "PI_E2E_MINIO_AK",
          secretKeyEnv: "PI_E2E_MINIO_SK",
        },
      ],
      write: "minio",
      registry: { kind: "s3", backend: "minio" },
    }),
    PI_E2E_MINIO_AK: MINIO_AK,
    PI_E2E_MINIO_SK: MINIO_SK,
    // S3 presign 协议上限内的稳定 TTL;同时作为沙箱内旧版包(无 clamp)兜底,经
    // PI_WEB_E2B_ENV_PASSTHROUGH 透传(仅 e2b 分支消费,基线 dev 设了也无害)。
    PI_WEB_ATTACHMENT_URL_TTL_MS: "604800000",
    PI_WEB_E2B_ENV_PASSTHROUGH: "PI_WEB_ATTACHMENT_URL_TTL_MS",
  };
}

const running = [];

function spawnDev(label, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
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
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* 组已不存在 */
  }
}

async function stopAll() {
  for (const entry of [...running].reverse()) await stopDev(entry);
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
      /* 未就绪 */
    }
    await sleep(500);
  }
  throw new Error(`${entry.label} ${base} 在 ${timeoutMs}ms 内未就绪`);
}

/** 跑一遍 playwright spec(同步等待,stdio 透传);返回 exit code。 */
function runPlaywright(project, baseUrl, extraEnv) {
  note(`playwright(project=${project})→ ${baseUrl}`);
  const res = spawnSync(
    "pnpm",
    ["exec", "playwright", "test", "-c", "playwright.sandbox.config.ts"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PI_E2E_BASE_URL: baseUrl,
        PI_E2E_PROJECT: project,
        PI_E2E_CANVAS_SOURCE: CANVAS_DIR,
        PI_E2E_HELLO_SOURCE: HELLO_DIR,
        ...extraEnv,
      },
    },
  );
  return res.status ?? 1;
}

async function main() {
  const { hostIp } = await gate();
  await ensureMinio();

  const apiservicesKey = resolveApiservicesKey();
  const hasVisionKey = apiservicesKey !== undefined;
  if (!hasVisionKey) {
    note("⚠ 无 APISERVICES_API_KEY(env 与 ~/.pi/agent/models.json 均无)→ 视觉用例 T6/T7 将 skip");
  }

  // hello-agent 模板(T8 退化用例):幂等 bake + 注册。模板名与 dev-e2b-local 同一套纯函数派生。
  const { loadBakePlanModule, createNodeBakeFs } = await import(
    "../scripts/build-agent-image.mjs"
  );
  const { computeBakePlan } = await loadBakePlanModule();
  const helloPlan = computeBakePlan(
    { sourceDir: HELLO_DIR, baseImage: BASE_IMAGE, bundle: true },
    createNodeBakeFs(),
  );
  if (!helloPlan.ok) {
    throw new Error(`hello-agent 烘焙计划失败 [${helloPlan.error.code}] ${helloPlan.error.detail}`);
  }
  const results = {};

  if (PHASE !== "baseline") {
    note("bake hello-agent 模板(退化用例前置)…");
    const bakeHello = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "build-agent-image.mjs"), HELLO_DIR, "--kind-load", "--register"],
      { cwd: ROOT, stdio: "inherit" },
    );
    if (bakeHello.status !== 0) throw new Error(`hello-agent bake 失败(exit ${bakeHello.status})`);
  }

  const sharedEnv = {
    ...attachmentEnv(hostIp),
    ...(hasVisionKey ? { APISERVICES_API_KEY: apiservicesKey } : {}),
  };
  const specEnv = { PI_E2E_HAS_VISION_KEY: hasVisionKey ? "1" : "0" };

  try {
    // ── Phase A:沙盒(e2b baked)────────────────────────────────────────────
    if (PHASE !== "baseline") {
      const sandboxEntry = spawnDev(
        "sandbox-dev",
        path.join(ROOT, "scripts", "dev-e2b-local.mjs"),
        {
          ...sharedEnv,
          PI_WEB_E2B_BAKE_SOURCE: CANVAS_DIR,
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({
            [HELLO_DIR]: helloPlan.value.templateName,
          }),
          // 真实生成/编辑/视觉是长链路,沙箱寿命拉长到 30min(manager 缺省 TTL 会在
          // 数分钟后回收 Pod → 会话中途死亡)。
          PI_WEB_E2B_TIMEOUT_MS: "1800000",
          PORT: String(SANDBOX_API),
          PI_WEB_DEV_CLIENT_PORT: String(SANDBOX_VITE),
        },
      );
      note("沙盒 dev 启动中(bake → kind load → register → port-forward → dev)…");
      await waitHttpReady(`http://127.0.0.1:${SANDBOX_API}`, 420_000, sandboxEntry);
      results.sandbox = runPlaywright("sandbox", `http://localhost:${SANDBOX_VITE}`, specEnv);
      await stopDev(sandboxEntry);
    }

    // ── Phase B:非沙盒基线(与 localhost:5173 主 dev 同构的 local 模式)──────
    if (PHASE !== "sandbox") {
      const localEntry = spawnDev("local-dev", path.join(ROOT, "scripts", "dev-all.mjs"), {
        ...sharedEnv,
        PORT: String(LOCAL_API),
        PI_WEB_DEV_API_PORT: String(LOCAL_API),
        PI_WEB_DEV_CLIENT_PORT: String(LOCAL_VITE),
      });
      await waitHttpReady(`http://127.0.0.1:${LOCAL_API}`, 120_000, localEntry);
      results.baseline = runPlaywright(
        "local-baseline",
        `http://localhost:${LOCAL_VITE}`,
        specEnv,
      );
      await stopDev(localEntry);
    }
  } finally {
    await stopAll();
  }

  const failed = Object.entries(results).filter(([, code]) => code !== 0);
  for (const [name, code] of Object.entries(results)) {
    note(`${name}: ${code === 0 ? "PASS" : `FAIL(exit ${code})`}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(`\x1b[31m[e2e:sandbox-browser] 失败:${err?.stack ?? err}\x1b[0m`);
  await stopAll();
  process.exit(1);
});
