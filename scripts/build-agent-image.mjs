#!/usr/bin/env node
/**
 * build:agent-image —— agent source 目录 → 专属沙箱镜像构建编排
 * (`sandbox-baked-agent-image` spec,任务 3.1;Req 2.1-2.3/2.5/2.7/1.5)。
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
 *   5) 输出 image:tag / 派生模板名 / 内容哈希 + 下一步指引(kind load / 注册模板 / TEMPLATE_MAP)
 *
 * 用法:node scripts/build-agent-image.mjs <sourceDir> [--tag t] [--base-image i] [--no-bundle]
 *      (或 `pnpm build:agent-image <sourceDir> …`)
 * 基础镜像优先序:--base-image > env PI_WEB_E2B_BASE_IMAGE > 缺省 pi-clouds/agent-runner:pi。
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

const USAGE = `用法:node scripts/build-agent-image.mjs <sourceDir> [--tag t] [--base-image i] [--no-bundle]
  <sourceDir>       agent source 目录(须含入口 index.js 或 index.ts)
  --tag t           显式镜像 tag(缺省 = 源内容 sha256 前 12 位,内容寻址)
  --base-image i    基础镜像(缺省 env PI_WEB_E2B_BASE_IMAGE 或 ${DEFAULT_BASE_IMAGE})
  --no-bundle       不做 esbuild 单文件化,拷全部源(沙箱运行时 jiti 编译)`;

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
// CLI 解析(未知 flag 直接报错;--kind-load/--register 归任务 3.2,届时再加)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  /** @type {{ sourceDir?: string; tag?: string; baseImage?: string; bundle: boolean }} */
  const opts = { bundle: true };
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
function createNodeBakeFs() {
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

async function loadBakePlanModule() {
  const requireFromServer = createRequire(SERVER_PKG_JSON);
  const { createJiti } = requireFromServer("jiti");
  const jiti = createJiti(SERVER_PKG_JSON);
  return jiti.import(BAKE_PLAN_TS);
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

  // -- 输出与下一步指引(Req 2.7) ------------------------------------------------
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`构建完成(${elapsed}s)`);
  log(`  image:tag   ${plan.imageName}`);
  log(`  模板名      ${plan.templateName}`);
  log(`  tag         ${plan.tag}${args.tag ? "(显式)" : "(源内容哈希,同内容恒同 tag)"}`);
  log("下一步:");
  log(`  1) 加载进本地 kind 集群:`);
  log(`       kind load docker-image ${plan.imageName} --name pi-clouds`);
  log(`  2) 注册为 agent-sandbox 模板(静态条目;或等 --register,任务 3.2):`);
  log(`       在 agent-sandbox 的 config-templates 中追加 {"name":"${plan.templateName}","image":"${plan.imageName}","port":8080}`);
  log(`       然后 kubectl -n agent-sandbox rollout restart deploy/agent-sandbox`);
  log(`  3) 让 pi-web 会话按 source 命中该模板(三选一):`);
  log(`       PI_WEB_E2B_TEMPLATE_MAP='{"${sourceDir}":"${plan.templateName}"}'`);
  log(`       PI_WEB_E2B_TEMPLATE_DERIVE=1(需 dynamic 模板规则已注册)`);
  log(`       PI_WEB_E2B_TEMPLATE=${plan.templateName}(全局单模板)`);
}

await main();
