#!/usr/bin/env node
/**
 * dev:acs —— 本地连**真实 ACS Agent Sandbox**(阿里云 ack-sandbox-manager)起 pi-web dev。
 *
 * 与 `dev-e2b-local.mjs`(本地 kind agent-sandbox)的差异(实测依据见
 * pi-clouds docs/acs-baked-pools-design.md §0):
 *  - 控制面**直连**:ACS manager 的 E2B API 在根路径、不做 Host 分流 —— e2b SDK 2.33
 *    对 `http://127.0.0.1:<pf>` 零改写兼容,无需本地反代;
 *  - 数据面走 **header 路由**(`PI_WEB_E2B_RUNNER_WS_ROUTE=header`):gateway 按
 *    `e2b-sandbox-id`/`e2b-sandbox-port` upgrade 头路由到沙箱内 agent-runner(:8787)。
 *    (e2b-host 分支的 `wss://{port}-{id}.{domain}` 仅集群内可用:本机解析不了
 *    `agents-vpc.infra` 且 scheme 定死 wss,gateway 7788 是明文 ws。)
 *
 * 自动编排:
 *   1) port-forward svc/sandbox-manager 18080:8080 + svc/sandbox-gateway 17788:7788
 *      (KUBECONFIG=~/.kube/pi-clouds-acs.yaml,可经 env 覆盖);
 *   2) 组装 e2b env(transport=e2b / ws-runner / header 路由 / runnerPort 8787);
 *   3) 跑 `node scripts/dev-all.mjs`(API :3030 / vite :5193,避开本地沙盒 dev 3020/5183)。
 *
 * 前置:
 *  - ACS 集群 kubeconfig(缺省 ~/.kube/pi-clouds-acs.yaml);
 *  - env `E2B_API_KEY` = ack-sandbox-manager 的 adminApiKey(**不硬编码进仓**);
 *  - 模板已在 ACS 注册(templateID = SandboxSet 名;经 PI_WEB_E2B_TEMPLATE /
 *    PI_WEB_E2B_TEMPLATE_MAP 接线)。烘焙镜像的 ACS 注册流程见
 *    pi-clouds docs/acs-baked-pools-design.md §4.1(amd64 构建 + ACR push + SandboxSet)。
 *
 * 可调 env:ACS_KUBECONFIG / ACS_MANAGER_LOCAL_PORT(18080) / ACS_GATEWAY_LOCAL_PORT(17788) /
 *   PI_WEB_E2B_TEMPLATE(缺省 pi-runner) / PORT(3030) / PI_WEB_DEV_CLIENT_PORT(5193) /
 *   E2B_DOMAIN(缺省 agents-vpc.infra)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KUBECONFIG =
  process.env.ACS_KUBECONFIG ?? path.join(os.homedir(), ".kube", "pi-clouds-acs.yaml");
const MANAGER_PORT = Number(process.env.ACS_MANAGER_LOCAL_PORT ?? 18080);
const GATEWAY_PORT = Number(process.env.ACS_GATEWAY_LOCAL_PORT ?? 17788);
const TEMPLATE = process.env.PI_WEB_E2B_TEMPLATE ?? "pi-runner";
const DOMAIN = process.env.E2B_DOMAIN ?? "agents-vpc.infra";
const DEV_API_PORT = process.env.PORT ?? "3030";
const DEV_CLIENT_PORT = process.env.PI_WEB_DEV_CLIENT_PORT ?? "5193";

const procs = [];
let exiting = false;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`\x1b[36m[dev:acs]\x1b[0m ${msg}`);
}
function die(msg) {
  // eslint-disable-next-line no-console
  console.error(`\x1b[31m[dev:acs] ${msg}\x1b[0m`);
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

function httpProbe(port, pathName) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: pathName, timeout: 1500 },
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

async function portForward(label, target, local, remote, probePath) {
  if (await httpProbe(local, probePath)) {
    log(`${label} :${local} 已在转发,复用。`);
    return;
  }
  log(`kubectl port-forward ${target} ${local}:${remote} …`);
  const pf = spawn(
    "kubectl",
    ["-n", "sandbox-system", "port-forward", target, `${local}:${remote}`],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, KUBECONFIG },
    },
  );
  pf.on("exit", (c) => !exiting && die(`${label} port-forward 退出(code=${c})`));
  procs.push(pf);
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await httpProbe(local, probePath)) {
      log(`${label} :${local} 就绪。`);
      return;
    }
  }
  die(`${label} port-forward 起后 :${local} 仍不可达`);
}

async function main() {
  if (!fs.existsSync(KUBECONFIG)) {
    die(`ACS kubeconfig 不存在:${KUBECONFIG}(可用 ACS_KUBECONFIG 覆盖)`);
    return;
  }
  const apiKey = process.env.E2B_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    die(
      "缺 E2B_API_KEY(ack-sandbox-manager 的 adminApiKey)。" +
        "安全考虑不硬编码进仓 —— 请从集群侧取得后经 env 传入。",
    );
    return;
  }

  // manager 的任意 GET 都有响应(405/404 也算可达);gateway 无 HTTP 健康点,探根路径连通即可。
  await portForward("manager", "svc/sandbox-manager", MANAGER_PORT, 8080, "/v2/sandboxes");
  if (exiting) return;
  await portForward("gateway", "svc/sandbox-gateway", GATEWAY_PORT, 7788, "/");
  if (exiting) return;

  // eslint-disable-next-line no-console
  console.log(
    "\x1b[33m──────────────────────────────────────────────────────────────\n" +
      " ✅ 真实 ACS Agent Sandbox(阿里云)dev:\n" +
      `   控制面 E2B API   http://127.0.0.1:${MANAGER_PORT}(直连,无反代)\n` +
      `   数据面 gateway   ws://127.0.0.1:${GATEWAY_PORT}(header 路由)\n` +
      `   模板             ${TEMPLATE}(templateID = ACS SandboxSet 名)\n` +
      "   ⚠ 沙箱按运行计费;空闲回收依赖 PI_WEB_E2B_TIMEOUT_MS(建议设置)。\n" +
      "──────────────────────────────────────────────────────────────\x1b[0m",
  );

  const env = {
    ...process.env,
    PI_WEB_TRANSPORT: "e2b",
    PI_WEB_E2B_DATAPLANE: "ws-runner",
    E2B_API_KEY: apiKey,
    E2B_API_URL: `http://127.0.0.1:${MANAGER_PORT}`,
    E2B_DOMAIN: DOMAIN,
    PI_WEB_E2B_TEMPLATE: TEMPLATE,
    PI_WEB_E2B_VALIDATE_API_KEY: "false",
    PI_WEB_E2B_RUNNER_WS_BASE: `ws://127.0.0.1:${GATEWAY_PORT}`,
    PI_WEB_E2B_RUNNER_WS_ROUTE: "header",
    PI_WEB_E2B_RUNNER_PORT: process.env.PI_WEB_E2B_RUNNER_PORT ?? "8787",
    PORT: DEV_API_PORT,
    PI_WEB_DEV_API_PORT: DEV_API_PORT,
    PI_WEB_DEV_CLIENT_PORT: DEV_CLIENT_PORT,
  };
  log(`起 pi-web dev(ACS 模式):API :${DEV_API_PORT} / vite :${DEV_CLIENT_PORT}`);
  const dev = spawn(process.execPath, [path.join(root, "scripts", "dev-all.mjs")], {
    stdio: ["inherit", "inherit", "inherit"],
    env,
  });
  dev.on("exit", (c) => shutdown(c ?? 0));
  procs.push(dev);
}

main().catch((e) => die(String(e?.message ?? e)));
