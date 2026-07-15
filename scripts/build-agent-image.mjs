#!/usr/bin/env node
/**
 * build:agent-image —— agent source 目录 → 专属沙箱镜像构建编排
 * (`sandbox-baked-agent-image` spec,任务 3.1 + 3.2;Req 2.1-2.3/2.5/2.7/6.3/1.5)。
 *
 * 决策(收集/排除/Dockerfile 文本/命名/tag)全部来自 `packages/server/src/sandbox-image/`
 * 纯函数内核(可单测);本脚本只做不可单测的编排:落盘 + spawn(research「构建工具 =
 * scripts 编排 + server 包纯函数内核」)。
 *
 * 流程:
 *   1) computeBakePlan(真实 node:fs 端口)→ staging 清单 / Dockerfile / image:tag / 模板名
 *   2) 落盘 build context 到 os.tmpdir 唯一子目录(staged/ + Dockerfile)
 *   3) bundle 模式(缺省):esbuild 单文件 staged/index.js(externals = pi SDK + @blksails/*,
 *      由基础镜像全局 node_modules 解析);`--no-bundle`:拷全部源,沙箱运行时 jiti 编译
 *   4) `docker build -t <image:tag>`(tag 缺省 = 源内容哈希 → 同内容恒同 tag,层缓存命中)
 *   5) 可选 `--kind-load [--kind-cluster c]`:`kind load docker-image` 进本地 kind 集群
 *   6) 可选 `--register`:kubectl 读 config-templates → upsert 静态条目 {name,image,port:8080}
 *      → patch 写回(经临时 patch 文件,避免 shell 转义)→ rollout restart + 等就绪。
 *      幂等:同名条目整条替换,重复执行结果一致。manager 对 ConfigMap 变更不保证热加载,
 *      故每次注册都 rollout restart(research「agent-sandbox 模板注册机制」待验证项的落地)。
 *   7) 输出 image:tag / 派生模板名 / 内容哈希 + 下一步指引(kind load / 注册模板 / TEMPLATE_MAP)
 *
 * 每个外部步骤(docker/kind/kubectl)失败都给「步骤名 + 原始 stderr + 修复建议」(Req 6.3)。
 *
 * 用法:node scripts/build-agent-image.mjs <sourceDir> [--tag t] [--base-image i] [--no-bundle]
 *        [--kind-load] [--kind-cluster c] [--register]
 *      (或 `pnpm build:agent-image <sourceDir> …`)
 * 基础镜像优先序:--base-image > env PI_WEB_E2B_BASE_IMAGE > 缺省 pi-clouds/agent-runner:pi。
 * 集群定位 env(对齐 dev-e2b-local.mjs 同名惯例):AGENT_SANDBOX_NS / AGENT_SANDBOX_SVC
 * (deploy 与 ConfigMap 同名,缺省均 agent-sandbox)。
 *
 * ⚠ bundle 后 agent 内 `import.meta.url` 相对路径语义变化(单文件化);有此依赖的 agent
 *   用 `--no-bundle` 退回「拷源 + 沙箱运行时 jiti 编译」。
 * TS 内核加载:createRequire 锚定 server 包 resolve jiti,再 jiti 编程式 import bake-plan.ts
 * (runner-bootstrap.mjs 同款;刻意不写字面量 `import(<变量>)`——vitest ssrTransform 教训)。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PKG_JSON = path.join(ROOT, "packages", "server", "package.json");
const BAKE_PLAN_TS = path.join(
  ROOT,
  "packages",
  "server",
  "src",
  "sandbox-image",
  "bake-plan.ts",
);
const DEFAULT_BASE_IMAGE = "pi-clouds/agent-runner:pi";
const DEFAULT_KIND_CLUSTER = "pi-clouds";
// agent-sandbox 集群定位(deploy 与 ConfigMap 同名);env 覆盖对齐 dev-e2b-local.mjs 惯例。
const SANDBOX_NS = process.env.AGENT_SANDBOX_NS ?? "agent-sandbox";
const SANDBOX_DEPLOY = process.env.AGENT_SANDBOX_SVC ?? "agent-sandbox";
const SANDBOX_CONFIGMAP = SANDBOX_DEPLOY;
const TEMPLATES_KEY = "config-templates";

const USAGE = `用法:node scripts/build-agent-image.mjs <sourceDir> [--tag t] [--base-image i] [--no-bundle] [--kind-load] [--kind-cluster c] [--register]
  <sourceDir>       agent source 目录(须含入口 index.js 或 index.ts)
  --tag t           显式镜像 tag(缺省 = 源内容 sha256 前 12 位,内容寻址)
  --base-image i    基础镜像(缺省 env PI_WEB_E2B_BASE_IMAGE 或 ${DEFAULT_BASE_IMAGE})
  --no-bundle       不做 esbuild 单文件化,拷全部源(沙箱运行时 jiti 编译)
  --kind-load       构建后 kind load docker-image 进本地 kind 集群
  --kind-cluster c  kind 集群名(缺省 ${DEFAULT_KIND_CLUSTER};仅与 --kind-load 联用)
  --register        注册为 agent-sandbox 静态模板(kubectl patch ${TEMPLATES_KEY} + rollout restart + 等就绪;幂等)
                    集群定位 env:AGENT_SANDBOX_NS(缺省 ${SANDBOX_NS})/ AGENT_SANDBOX_SVC(缺省 ${SANDBOX_DEPLOY})`;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`\x1b[36m[build:agent-image]\x1b[0m ${msg}`);
}
function die(msg) {
  // eslint-disable-next-line no-console
  console.error(`\x1b[31m[build:agent-image] ${msg}\x1b[0m`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI 解析(未知 flag 直接报错)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  /** @type {{ sourceDir?: string; tag?: string; baseImage?: string; bundle: boolean; kindLoad: boolean; kindCluster: string; register: boolean }} */
  const opts = { bundle: true, kindLoad: false, kindCluster: DEFAULT_KIND_CLUSTER, register: false };
  const takeValue = (arg, name, rest) => {
    if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1);
    const v = rest.shift();
    if (v === undefined || v.startsWith("--")) die(`${name} 缺少取值\n${USAGE}`);
    return v;
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--tag" || arg.startsWith("--tag=")) {
      opts.tag = takeValue(arg, "--tag", rest);
    } else if (arg === "--base-image" || arg.startsWith("--base-image=")) {
      opts.baseImage = takeValue(arg, "--base-image", rest);
    } else if (arg === "--no-bundle") {
      opts.bundle = false;
    } else if (arg === "--kind-load") {
      opts.kindLoad = true;
    } else if (arg === "--kind-cluster" || arg.startsWith("--kind-cluster=")) {
      opts.kindCluster = takeValue(arg, "--kind-cluster", rest);
    } else if (arg === "--register") {
      opts.register = true;
    } else if (arg.startsWith("-")) {
      die(`未知参数:${arg}\n${USAGE}`);
    } else if (opts.sourceDir === undefined) {
      opts.sourceDir = arg;
    } else {
      die(`多余的位置参数:${arg}\n${USAGE}`);
    }
  }
  if (opts.sourceDir === undefined) die(`缺少 <sourceDir>\n${USAGE}`);
  return opts;
}

// ---------------------------------------------------------------------------
// 真实 BakeFsPort 适配器(契约见 bake-plan.ts:listFiles 递归 + 相对路径 + posix 分隔)
// ---------------------------------------------------------------------------

/** @returns {{ exists(p: string): boolean; listFiles(dir: string): string[]; readFile(p: string): Buffer }} */
export function createNodeBakeFs() {
  return {
    exists: (p) => fs.existsSync(p),
    listFiles: (dir) => {
      if (!fs.statSync(dir).isDirectory()) {
        throw new Error(`not a directory: ${dir}`);
      }
      /** @type {string[]} */
      const out = [];
      const walk = (abs, rel) => {
        for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
          const childAbs = path.join(abs, ent.name);
          const childRel = rel === "" ? ent.name : `${rel}/${ent.name}`;
          // symlink 以指向目标定性(statSync 解引用),与拷贝时 copyFileSync 读目标内容一致
          const kind = ent.isSymbolicLink() ? fs.statSync(childAbs) : ent;
          if (kind.isDirectory()) walk(childAbs, childRel);
          else if (kind.isFile()) out.push(childRel);
        }
      };
      walk(dir, "");
      return out;
    },
    readFile: (p) => fs.readFileSync(p),
  };
}

// ---------------------------------------------------------------------------
// TS 内核加载(bake-plan.ts):jiti 是 server 包依赖,root 解析不到,须锚定 server 包
// ---------------------------------------------------------------------------

export async function loadBakePlanModule() {
  const requireFromServer = createRequire(SERVER_PKG_JSON);
  const { createJiti } = requireFromServer("jiti");
  const jiti = createJiti(SERVER_PKG_JSON);
  return jiti.import(BAKE_PLAN_TS);
}

// ---------------------------------------------------------------------------
// 步骤级外部命令执行(Req 6.3:步骤名 + 原始 stderr + 修复建议)
// ---------------------------------------------------------------------------

/**
 * 跑一个外部命令步骤,失败即 die 且错误可操作:
 * - 可执行缺失(ENOENT)→ 步骤名 + notFoundHint(安装指引);
 * - 非零退出 → 步骤名 + 原始 stderr 透传 + fixHint(修复建议)。
 * 成功返回 spawnSync 结果(stdout/stderr 已捕获,调用方决定是否回显)。
 */
function runStep(step, cmd, cmdArgs, { notFoundHint, fixHint }) {
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  if (res.error && res.error.code === "ENOENT") {
    die(`步骤「${step}」失败:找不到 ${cmd} 可执行文件。\n${notFoundHint}`);
  }
  if (res.error) {
    die(`步骤「${step}」启动失败:${String(res.error.message ?? res.error)}`);
  }
  if (res.status !== 0) {
    const stderr = (res.stderr ?? "").trim();
    die(
      `步骤「${step}」失败(${cmd} exit ${res.status})。\n` +
        `--- 原始 stderr ---\n${stderr === "" ? "(空)" : stderr}\n` +
        `--- 修复建议 ---\n${fixHint}`,
    );
  }
  return res;
}

const KUBECTL_NOT_FOUND_HINT =
  "注册模板需要 kubectl:\n" +
  "  - macOS:brew install kubectl(或 Docker Desktop/OrbStack 自带)\n" +
  "  - 其他:https://kubernetes.io/docs/tasks/tools/";

// ---------------------------------------------------------------------------
// --kind-load:kind load docker-image 进本地集群
// ---------------------------------------------------------------------------

function kindLoadImage(imageName, cluster) {
  const step = `kind load(集群 ${cluster})`;
  log(`kind load docker-image ${imageName} --name ${cluster} …`);
  const res = runStep(step, "kind", ["load", "docker-image", imageName, "--name", cluster], {
    notFoundHint:
      "加载镜像进本地集群需要 kind:\n" +
      "  - macOS:brew install kind\n" +
      "  - 其他:https://kind.sigs.k8s.io/docs/user/quick-start/#installation",
    fixHint:
      `  - 确认集群存在:kind get clusters(应含 ${cluster};不同名用 --kind-cluster 指定)\n` +
      `  - 确认镜像已构建:docker images | grep ${imageName.split(":")[0]}\n` +
      "  - 确认 docker daemon 在跑(kind load 依赖本地 docker)",
  });
  // kind 的进度输出走 stdout/stderr 混合;成功也回显便于确认已加载到哪些节点
  for (const line of `${res.stdout ?? ""}${res.stderr ?? ""}`.split("\n")) {
    if (line.trim() !== "") log(`  ${line.trim()}`);
  }
  log(`kind load 完成:${imageName} → 集群 ${cluster}`);
}

// ---------------------------------------------------------------------------
// --register:kubectl patch config-templates 静态条目 + rollout restart + 等就绪
// ---------------------------------------------------------------------------

/**
 * 注册烘焙镜像为 agent-sandbox 静态模板条目(幂等:同 name 存在则整条替换)。
 * 写回经临时 patch 文件 + `kubectl patch --patch-file`(JSON 串套 JSON 串,
 * 避免 shell 引号转义地狱)。manager 不保证热加载 ConfigMap,故每次注册都
 * rollout restart + rollout status 等就绪。
 */
function registerTemplate(plan) {
  const cmRef = `configmap/${SANDBOX_CONFIGMAP}(ns ${SANDBOX_NS})`;
  const clusterHint =
    `  - 确认本地集群在跑且 kubectl context 正确:kubectl config current-context\n` +
    `  - 确认 agent-sandbox 已部署:kubectl -n ${SANDBOX_NS} get deploy,cm\n` +
    `  - ns/名字不同时用 env 覆盖:AGENT_SANDBOX_NS / AGENT_SANDBOX_SVC`;

  // 1) 读现有 config-templates
  log(`读取 ${cmRef} 的 ${TEMPLATES_KEY} …`);
  const get = runStep(
    `读取模板 ConfigMap(kubectl get ${cmRef})`,
    "kubectl",
    ["-n", SANDBOX_NS, "get", "configmap", SANDBOX_CONFIGMAP, "-o", "json"],
    { notFoundHint: KUBECTL_NOT_FOUND_HINT, fixHint: clusterHint },
  );
  /** @type {{ data?: Record<string, string> }} */
  let cm;
  try {
    cm = JSON.parse(get.stdout);
  } catch (e) {
    die(`步骤「解析模板 ConfigMap JSON」失败:${String(e)}\n--- 修复建议 ---\n${clusterHint}`);
  }
  const raw = cm.data?.[TEMPLATES_KEY];
  if (typeof raw !== "string") {
    die(
      `步骤「解析模板 ConfigMap」失败:${cmRef} 缺少键 ${TEMPLATES_KEY}。\n` +
        `--- 修复建议 ---\n  - 确认目标是 agent-sandbox manager 的模板 ConfigMap\n${clusterHint}`,
    );
  }
  /** @type {unknown} */
  let templates;
  try {
    templates = JSON.parse(raw);
  } catch (e) {
    die(
      `步骤「解析 ${TEMPLATES_KEY} JSON 数组」失败:${String(e)}\n` +
        `--- 修复建议 ---\n  - ${cmRef} 的 ${TEMPLATES_KEY} 值应为 JSON 数组 [{name,image,port?,…}],先人工修复其内容`,
    );
  }
  if (!Array.isArray(templates)) {
    die(
      `步骤「解析 ${TEMPLATES_KEY} JSON 数组」失败:期望数组,实为 ${typeof templates}。\n` +
        `--- 修复建议 ---\n  - ${cmRef} 的 ${TEMPLATES_KEY} 值应为 JSON 数组 [{name,image,port?,…}],先人工修复其内容`,
    );
  }

  // 2) upsert 静态条目(同 name 整条替换 = 幂等)
  const slug = plan.templateName.replace(/^piweb-agent-/, "").replace(/\.[^.]*$/, "");
  const entry = {
    name: plan.templateName,
    image: plan.imageName,
    port: 8080,
    description: `piweb baked agent (${slug})`,
  };
  const idx = templates.findIndex((t) => t !== null && typeof t === "object" && t.name === plan.templateName);
  const action = idx >= 0 ? "替换同名条目" : "追加新条目";
  if (idx >= 0) templates[idx] = entry;
  else templates.push(entry);
  log(`upsert 模板条目(${action}):${JSON.stringify(entry)}`);

  // 3) patch 写回(临时 patch 文件,免 shell 转义)
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "piweb-register-"));
  const patchFile = path.join(patchDir, "patch.json");
  fs.writeFileSync(
    patchFile,
    JSON.stringify({ data: { [TEMPLATES_KEY]: JSON.stringify(templates) } }),
  );
  try {
    runStep(
      `写回模板 ConfigMap(kubectl patch ${cmRef})`,
      "kubectl",
      [
        "-n", SANDBOX_NS,
        "patch", "configmap", SANDBOX_CONFIGMAP,
        "--type", "merge",
        "--patch-file", patchFile,
      ],
      { notFoundHint: KUBECTL_NOT_FOUND_HINT, fixHint: clusterHint },
    );
  } finally {
    fs.rmSync(patchDir, { recursive: true, force: true });
  }

  // 4) rollout restart + 等就绪(manager 不保证热加载 ConfigMap)
  log(`rollout restart deploy/${SANDBOX_DEPLOY}(manager 重读模板)…`);
  runStep(
    `重启 manager(kubectl rollout restart deploy/${SANDBOX_DEPLOY})`,
    "kubectl",
    ["-n", SANDBOX_NS, "rollout", "restart", `deploy/${SANDBOX_DEPLOY}`],
    { notFoundHint: KUBECTL_NOT_FOUND_HINT, fixHint: clusterHint },
  );
  runStep(
    `等待 manager 就绪(kubectl rollout status deploy/${SANDBOX_DEPLOY})`,
    "kubectl",
    ["-n", SANDBOX_NS, "rollout", "status", `deploy/${SANDBOX_DEPLOY}`, "--timeout=120s"],
    {
      notFoundHint: KUBECTL_NOT_FOUND_HINT,
      fixHint:
        `  - 看 Pod 事件:kubectl -n ${SANDBOX_NS} describe deploy/${SANDBOX_DEPLOY}\n` +
        `  - 看容器日志:kubectl -n ${SANDBOX_NS} logs deploy/${SANDBOX_DEPLOY} --tail=100\n` +
        "  - 常见原因:镜像拉取失败 / 模板 JSON 不合法致 manager 启动崩",
    },
  );
  log(`模板注册完成(${action}):${plan.templateName} → ${plan.imageName}(port 8080),manager 已重启就绪`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.sourceDir);
  const baseImage =
    args.baseImage ?? process.env.PI_WEB_E2B_BASE_IMAGE ?? DEFAULT_BASE_IMAGE;

  const { computeBakePlan, isBakeExcluded } = await loadBakePlanModule();
  const bakeFs = createNodeBakeFs();

  const result = computeBakePlan(
    { sourceDir, baseImage, bundle: args.bundle, tag: args.tag },
    bakeFs,
  );
  if (!result.ok) {
    die(`烘焙计划失败 [${result.error.code}] ${result.error.detail}`);
  }
  const plan = result.value;

  // -- 审计清单(Req 2.5:排除规则可查知;打印收集与排除,供开发者核对) ---------
  const excluded = bakeFs.listFiles(sourceDir).filter(isBakeExcluded).sort();
  log(`source:      ${sourceDir}`);
  log(`base image:  ${baseImage}`);
  log(`模式:        ${args.bundle ? "bundle(esbuild 单文件)" : "no-bundle(拷源 + 运行时 jiti)"}`);
  log(`staging 收集(${plan.files.length} 项${args.bundle ? " + bundle 产物 index.js" : ""}):`);
  for (const f of plan.files) log(`  + ${f.dest}`);
  if (args.bundle) log(`  + index.js  (esbuild bundle ← ${path.relative(sourceDir, plan.bundleEntryPoint)},externals: ${plan.externals.join(", ")})`);
  log(`排除(${excluded.length} 项,规则见 bake-plan.ts BAKE_EXCLUDES):`);
  if (excluded.length === 0) log("  (无)");
  for (const rel of excluded) log(`  - ${rel}`);

  // -- 落盘 build context(os.tmpdir 唯一子目录:staged/ + Dockerfile) ----------
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), "piweb-agent-image-"));
  const stagedDir = path.join(contextDir, "staged");
  fs.mkdirSync(stagedDir);
  for (const f of plan.files) {
    const dest = path.join(stagedDir, ...f.dest.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
  }

  if (args.bundle) {
    log("esbuild bundle …");
    await esbuild.build({
      entryPoints: [plan.bundleEntryPoint],
      outfile: path.join(stagedDir, "index.js"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      external: [...plan.externals],
      logLevel: "warning",
    });
  }

  fs.writeFileSync(path.join(contextDir, "Dockerfile"), plan.dockerfile);
  log(`build context: ${contextDir}`);

  // -- docker build(stdio inherit:构建输出/缓存命中/stderr 原样透传) ----------
  log(`docker build -t ${plan.imageName} …`);
  const build = spawnSync("docker", ["build", "-t", plan.imageName, contextDir], {
    stdio: "inherit",
  });
  if (build.error && build.error.code === "ENOENT") {
    die(
      "找不到 docker 可执行文件。构建镜像需要 Docker:\n" +
        "  - macOS:安装 Docker Desktop 或 OrbStack 后重试\n" +
        "  - Linux:参考 https://docs.docker.com/engine/install/",
    );
  }
  if (build.error) die(`docker build 启动失败:${String(build.error.message ?? build.error)}`);
  if (build.status !== 0) {
    die(`docker build 失败(exit ${build.status});build context 保留在 ${contextDir} 供排查`);
  }
  fs.rmSync(contextDir, { recursive: true, force: true });

  // -- 可选:kind load / 注册模板(任务 3.2;失败即步骤级错误退出) ----------------
  if (args.kindLoad) kindLoadImage(plan.imageName, args.kindCluster);
  if (args.register) registerTemplate(plan);

  // -- 输出与下一步指引(Req 2.7;已由 flag 完成的步骤标记 ✓) ---------------------
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`构建完成(${elapsed}s)`);
  log(`  image:tag   ${plan.imageName}`);
  log(`  模板名      ${plan.templateName}`);
  log(`  tag         ${plan.tag}${args.tag ? "(显式)" : "(源内容哈希,同内容恒同 tag)"}`);
  log("下一步:");
  if (args.kindLoad) {
    log(`  1) ✓ 已加载进 kind 集群 ${args.kindCluster}(--kind-load)`);
  } else {
    log(`  1) 加载进本地 kind 集群(或直接加 --kind-load):`);
    log(`       kind load docker-image ${plan.imageName} --name ${DEFAULT_KIND_CLUSTER}`);
  }
  if (args.register) {
    log(`  2) ✓ 已注册为 agent-sandbox 模板并重启 manager(--register)`);
  } else {
    log(`  2) 注册为 agent-sandbox 模板(或直接加 --register):`);
    log(`       在 ${SANDBOX_CONFIGMAP} 的 ${TEMPLATES_KEY} 中追加 {"name":"${plan.templateName}","image":"${plan.imageName}","port":8080}`);
    log(`       然后 kubectl -n ${SANDBOX_NS} rollout restart deploy/${SANDBOX_DEPLOY}`);
  }
  log(`  3) 让 pi-web 会话按 source 命中该模板(三选一):`);
  log(`       PI_WEB_E2B_TEMPLATE_MAP='{"${sourceDir}":"${plan.templateName}"}'`);
  log(`       PI_WEB_E2B_TEMPLATE_DERIVE=1(需 dynamic 模板规则已注册)`);
  log(`       PI_WEB_E2B_TEMPLATE=${plan.templateName}(全局单模板)`);
}

// 入口守卫:仅「node scripts/build-agent-image.mjs …」直跑时执行 main。集成测试
// (test/sandbox-image-build.integration.test.ts,任务 3.3)以模块形式 import 本文件取
// createNodeBakeFs/loadBakePlanModule,不得触发 main(parseArgs 会对 vitest argv die)。
// 两侧都先 realpath 再比对:argv[1] 可能经 symlink(pnpm bin 链)到达,直接比路径会漏判
// (shared-runtime-payload 教训:入口守卫不 realpath 会误判)。
const isDirectRun = (() => {
  const argv1 = process.argv[1];
  if (typeof argv1 !== "string" || argv1 === "") return false;
  try {
    return (
      fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (isDirectRun) await main();
