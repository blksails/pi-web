/**
 * 自包含产物收集(spec vite-spa-migration 任务 8.1,Req 5.1/5.2)。
 *
 * 取代 `scripts/pack-standalone.mjs`(563 行)。那个脚本的主体是在**修 nft 造成的伤**:
 * nft 把 pnpm 符号链接解引用拍平成无依赖的实体目录,链条断裂 → runner 子进程
 * `Cannot find module 'chalk'` 即崩;于是它又把拍平副本 relink 回 `.pnpm` 规范副本。
 *
 * esbuild 不做依赖追踪,故这里可以直接按**原始布局**收集,不重排依赖树:
 *
 *   dist/                              ← cwd(bin/pi-web.mjs 以此为 cwd 启动)
 *   ├── server.mjs                     ← esbuild 单文件入口(唯一可执行入口)
 *   ├── client/                        ← vite 产物(含 public/ 的 webext-artifact/)
 *   ├── packages/<pkg>/{src,package.json,runner-bootstrap.mjs}
 *   ├── lib/app/stub-agent-process.mjs ← --stub 模式;stubAgentPath() 经 cwd 解析
 *   └── node_modules/
 *       ├── @blksails/<pkg> → ../../packages/<pkg>   (相对链接,与源码树同构)
 *       └── <pi SDK 闭包>                             (hoist 自 .pnpm 同级兄弟)
 *
 * pi SDK 的传递依赖(chalk / undici / yaml …)在 `.pnpm/<hash>/node_modules/` 下是**兄弟**。
 * 把该目录的全部条目 hoist 到 `dist/node_modules` 顶层,兄弟关系即被保留 —— 这正是
 * `pack-standalone` 的 hoist 步骤,只是不必先被 nft 打散再修回来。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(process.env.PI_WEB_DIST ?? join(ROOT, "dist"));
const DIST_NM = join(DIST, "node_modules");

/** 运行时经 jiti 动态加载、不进 bundle 的包(与 build-server.mjs 的 EXTERNAL 对应)。 */
const RUNTIME_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "jiti",
  "pg",
];

/** 从 `packages/server` 起解析(pnpm 把 pi SDK 嵌套在此,不在 app 根)。 */
const requireFromServer = createRequire(join(ROOT, "packages/server/package.json"));
const requireFromRoot = createRequire(join(ROOT, "package.json"));

/**
 * 定位包根。
 *
 * ⚠ 不能只靠 `require.resolve`:pi SDK 的 `exports` **仅暴露 `import` condition**,
 * 且不导出 `./package.json` —— `createRequire().resolve()` 两条路都会抛。
 * (`next.config.ts` 的 `piSdkEntryAbsPath` 早有同样注释:读 package.json 直接,绕过 exports。)
 * 故优先按 pnpm 的已知安装位置直接探路径。
 */
const NM_BASES = [
  join(ROOT, "packages/server/node_modules"),
  join(ROOT, "node_modules"),
];

function tryRealpath(spec) {
  for (const base of NM_BASES) {
    const p = join(base, ...spec.split("/"));
    if (existsSync(join(p, "package.json"))) return p;
  }
  for (const req of [requireFromServer, requireFromRoot]) {
    try {
      return dirname(req.resolve(`${spec}/package.json`));
    } catch {
      /* 下一个 */
    }
    try {
      return dirname(req.resolve(spec));
    } catch {
      /* 继续 */
    }
  }
  return undefined;
}

/**
 * 给定包根,返回它所在的 `.pnpm/<hash>/node_modules` 目录(其下的条目互为兄弟)。
 * 非 pnpm 布局(已 hoist)返回 undefined。
 *
 *   scoped:    .../<hash>/node_modules/@earendil-works/pi-ai  → 上两级
 *   非 scoped: .../<hash>/node_modules/chalk                  → 上一级
 */
function pnpmSiblingDir(pkgRoot) {
  const real = realpathSync(pkgRoot);
  let nm = dirname(real);
  if (basename(nm).startsWith("@")) nm = dirname(nm); // 跳过 scope 目录
  if (basename(nm) !== "node_modules") return undefined;
  return nm.includes(`${sep}.pnpm${sep}`) ? nm : undefined;
}

/** 列出 `.pnpm/<hash>/node_modules` 下的包(展开 scope 目录),返回 [名称, 源路径]。 */
function listSiblings(siblingDir) {
  const out = [];
  for (const entry of readdirSync(siblingDir)) {
    if (entry === ".bin") continue;
    const p = join(siblingDir, entry);
    if (entry.startsWith("@")) {
      for (const inner of readdirSync(p)) out.push([`${entry}/${inner}`, join(p, inner)]);
    } else {
      out.push([entry, p]);
    }
  }
  return out;
}

/**
 * 收集运行时依赖的**传递闭包**并 hoist 到 `dist/node_modules` 顶层。
 *
 * pnpm 的每个包住在自己的 `.pnpm/<hash>/node_modules/` 下,其**直接**依赖是同目录的兄弟
 * (符号链接,指向那些依赖各自的 `.pnpm` 目录)。因此闭包必须按符号链接做 BFS:
 * 只 hoist 第一层兄弟会漏掉二层(实测:`minimatch` 有了,它的 `brace-expansion` 没有 →
 * `ERR_MODULE_NOT_FOUND`)。
 *
 * 一律 `dereference: true` 扁平化为实体目录 —— Windows 上创建符号链接需要特权,
 * 且 `realpath` 会抛 EPERM(记忆 pi-web-multiplatform-standalone)。
 */
function packRuntimeDeps() {
  const hoisted = new Set();
  const seenDirs = new Set();
  /** @type {string[]} 待处理的 `.pnpm/<hash>/node_modules` 目录 */
  const queue = [];

  for (const spec of RUNTIME_PACKAGES) {
    const pkgRoot = tryRealpath(spec);
    if (pkgRoot === undefined) {
      process.stderr.write(`[pack-dist] ⚠ 解析不到 ${spec},跳过\n`);
      continue;
    }
    const siblings = pnpmSiblingDir(pkgRoot);
    if (siblings !== undefined) {
      queue.push(siblings);
    } else if (!hoisted.has(spec)) {
      // 非 pnpm 布局(已 hoist):直接拷包本身。
      hoisted.add(spec);
      cpSync(pkgRoot, join(DIST_NM, spec), { recursive: true, dereference: true });
    }
  }

  while (queue.length > 0) {
    const dir = queue.shift();
    const real = realpathSync(dir);
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);

    for (const [name, src] of listSiblings(dir)) {
      // 无论是否已 hoist,都要跟进它自己的 .pnpm 目录(可能带来新的传递依赖)。
      let ownSiblings;
      try {
        ownSiblings = pnpmSiblingDir(src);
      } catch {
        ownSiblings = undefined;
      }
      if (ownSiblings !== undefined && !seenDirs.has(realpathSync(ownSiblings))) {
        queue.push(ownSiblings);
      }

      if (hoisted.has(name)) continue;
      hoisted.add(name);
      const dest = join(DIST_NM, ...name.split("/"));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, dereference: true });
    }
  }

  return hoisted;
}

/* ────────────────────────── 剪枝(prune) ──────────────────────────
 *
 * hoist 进来的第三方包携带大量**运行时永不读取**的文件:sourcemap、类型声明、
 * README、测试夹具。实测占 `dist/node_modules` 的一半以上。
 *
 * 这份产物同时被 **CLI(npm 包 `files: ["bin","dist"]`)** 与**桌面版(随包 resources)**
 * 携带,故每省 1MB 是省两次。
 *
 * 边界(违反即运行时崩溃):
 *   - 只处理 `dist/node_modules` 下的**第三方**包。`@blksails/*` 是指向 `dist/packages/`
 *     的链接(Windows 退化为实体拷贝),其 `src/**.ts` 由 jiti 在运行时加载,**不可删**。
 *     本函数在 `packWorkspacePackages()` **之前**调用,那时 `@blksails` 尚不存在。
 *   - `dist/examples`、`dist/packages` 同样含 jiti 加载的 `.ts`,不在本函数射程内。
 *   - `LICENSE`/`NOTICE`/`COPYING` **保留**:MIT/Apache 等要求分发时保留 copyright notice。
 *   - `.ts` 源码按包**动态判定**:若某包 `exports` 的运行时 condition(排除 `types`)
 *     解析到 `.ts`(如 `zod/@zod/source`、`@mistralai/mistralai/source`),则该包整体跳过
 *     `.ts` 删除。动态判定而非硬编码包名 —— 新增依赖时自动安全。
 *
 * 关闭:`PI_WEB_DIST_NO_PRUNE=1`(排查产物问题时保留完整树)。
 */

/** 运行时永不读取的文件后缀。 */
const PRUNE_SUFFIXES = [".map", ".d.ts", ".d.mts", ".d.cts", ".md", ".markdown"];
/** 运行时永不读取的目录名。 */
const PRUNE_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "example",
  "examples",
  "docs",
  ".github",
]);
/** 即便同名也必须保留的文件(法律义务)。 */
const KEEP_RE = /^(LICEN[CS]E|NOTICE|COPYING|AUTHORS)/i;
/** `exports` 中只被 TS 编译器读取、Node 运行时忽略的 condition。 */
const TYPE_ONLY_CONDITIONS = new Set(["types", "typings"]);

const isPlainTs = (p) =>
  typeof p === "string" && p.endsWith(".ts") && !/\.d\.(m|c)?ts$/.test(p);

/** 递归展开 `exports`,跳过纯类型 condition,产出所有运行时可解析的目标。 */
function* runtimeExportTargets(node) {
  if (typeof node === "string") {
    yield node;
  } else if (Array.isArray(node)) {
    for (const x of node) yield* runtimeExportTargets(x);
  } else if (node !== null && typeof node === "object") {
    for (const [cond, sub] of Object.entries(node)) {
      if (TYPE_ONLY_CONDITIONS.has(cond)) continue;
      yield* runtimeExportTargets(sub);
    }
  }
}

/** 该包是否可能在运行时解析到 `.ts` 源码(是则保留其 `.ts`)。 */
function packageResolvesToTs(pkgDir) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  } catch {
    return true; // 读不到清单 → 保守保留
  }
  for (const key of ["main", "module"]) {
    if (isPlainTs(pkg[key])) return true;
  }
  if (typeof pkg.bin === "object" && pkg.bin !== null) {
    for (const v of Object.values(pkg.bin)) if (isPlainTs(v)) return true;
  } else if (isPlainTs(pkg.bin)) {
    return true;
  }
  for (const target of runtimeExportTargets(pkg.exports)) {
    if (isPlainTs(target)) return true;
  }
  return false;
}

/** 列出 `dist/node_modules` 下的第三方包根(展开 scope,排除 `@blksails`)。 */
function listThirdPartyPackages() {
  const out = [];
  if (!existsSync(DIST_NM)) return out;
  for (const entry of readdirSync(DIST_NM)) {
    if (entry === "@blksails" || entry === ".bin") continue;
    const p = join(DIST_NM, entry);
    if (entry.startsWith("@")) {
      for (const inner of readdirSync(p)) out.push(join(p, inner));
    } else {
      out.push(p);
    }
  }
  return out;
}

function pruneTree(dir, { dropTs }, stats) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) {
        stats.bytes += dirSize(p);
        rmSync(p, { recursive: true, force: true });
        stats.dirs += 1;
        continue;
      }
      pruneTree(p, { dropTs }, stats);
      continue;
    }
    if (!entry.isFile()) continue;
    if (KEEP_RE.test(entry.name)) continue;

    const drop =
      PRUNE_SUFFIXES.some((s) => entry.name.endsWith(s)) ||
      (dropTs && isPlainTs(entry.name));
    if (drop) {
      stats.bytes += statSync(p).size;
      rmSync(p, { force: true });
      stats.files += 1;
    }
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}

/** 剪掉第三方依赖里运行时永不读取的文件。返回省下的字节数。 */
function pruneRuntimeDeps() {
  if (process.env.PI_WEB_DIST_NO_PRUNE === "1") return { bytes: 0, skipped: [] };
  const stats = { bytes: 0, files: 0, dirs: 0 };
  const keptTs = [];
  for (const pkgDir of listThirdPartyPackages()) {
    if (!existsSync(join(pkgDir, "package.json"))) continue;
    const resolvesToTs = packageResolvesToTs(pkgDir);
    if (resolvesToTs) keptTs.push(relative(DIST_NM, pkgDir));
    pruneTree(pkgDir, { dropTs: !resolvesToTs }, stats);
  }
  return { ...stats, keptTs };
}

/** workspace 包:拷 src + package.json,并在 node_modules 建相对链接(与源码树同构)。 */
function packWorkspacePackages() {
  const pkgsDir = join(ROOT, "packages");
  const scopeDir = join(DIST_NM, "@blksails");
  mkdirSync(scopeDir, { recursive: true });

  for (const pkg of readdirSync(pkgsDir)) {
    const srcPkg = join(pkgsDir, pkg);
    if (!existsSync(join(srcPkg, "package.json"))) continue;
    const destPkg = join(DIST, "packages", pkg);
    mkdirSync(destPkg, { recursive: true });
    cpSync(join(srcPkg, "package.json"), join(destPkg, "package.json"));
    if (existsSync(join(srcPkg, "src"))) {
      cpSync(join(srcPkg, "src"), join(destPkg, "src"), { recursive: true });
    }
    // runner 引导脚本(jiti 运行时加载,不进 bundle)。
    const bootstrap = join(srcPkg, "runner-bootstrap.mjs");
    if (existsSync(bootstrap)) cpSync(bootstrap, join(destPkg, "runner-bootstrap.mjs"));
    if (existsSync(join(srcPkg, "build"))) {
      cpSync(join(srcPkg, "build"), join(destPkg, "build"), { recursive: true });
    }

    // node_modules/@blksails/<name> → ../../packages/<pkg>
    const name = JSON.parse(readFileSync(join(srcPkg, "package.json"), "utf8")).name;
    if (typeof name !== "string" || !name.startsWith("@blksails/")) continue;
    const linkPath = join(DIST_NM, name);
    mkdirSync(dirname(linkPath), { recursive: true });
    rmSync(linkPath, { recursive: true, force: true });
    const target = relative(dirname(linkPath), destPkg);
    try {
      symlinkSync(target, linkPath, "junction");
    } catch {
      // Windows 无特权时退化为实体拷贝(与产物扁平化策略一致)。
      cpSync(destPkg, linkPath, { recursive: true, dereference: true });
    }
  }
}

/**
 * 被 bundle 的代码在**运行时** `require()` 的相对资源。
 *
 * `packages/server/src/config/schema-registry.ts` 里有:
 *   const require = createRequire(import.meta.url);
 *   const BUILTIN_SNAPSHOT = require("./schema-registry.data.json");
 *
 * 该模块被打进 `dist/server.mjs`,于是 `import.meta.url` 指向产物入口,相对 require 解析到
 * **产物根**。`packages/*` 零改动是本 spec 的硬约束,故由产物满足它的期望:把这些 `.data.json`
 * 放到入口相邻位置。
 *
 * (旧宿主里这类资源由 nft 追踪并拷到对应相对位置 —— 同一问题的不同解法。)
 *
 * 新增同类资源而忘记登记 → 服务端启动即 `MODULE_NOT_FOUND`,被任一 e2e 立即抓到。
 */
function packRuntimeAssets() {
  const assets = [];
  const pkgsDir = join(ROOT, "packages");
  for (const pkg of readdirSync(pkgsDir)) {
    const srcDir = join(pkgsDir, pkg, "src");
    if (!existsSync(srcDir)) continue;
    collectDataJson(srcDir, assets);
  }
  for (const file of assets) {
    cpSync(file, join(DIST, basename(file)));
  }
  return assets.length;
}

function collectDataJson(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectDataJson(p, out);
    else if (entry.name.endsWith(".data.json")) out.push(p);
  }
}

/**
 * 内置示例 agent 源(632K)。
 *
 * 旧 standalone 产物里它们是 nft 的副作用:`lib/app/webext-registry.ts` 静态 import
 * `examples/**\/.pi/web/web.config.tsx`,追踪器顺带把整个 examples 拷了进去。
 *
 * 保留该行为:`pi-web ./examples/hello-agent` 开箱即用,且 `e2e:cli:reloc` 依赖副本内
 * 存在示例源(它把整个产物搬到异路径后从副本启动,agent source 须随之可达)。
 */
function packExamples() {
  const src = join(ROOT, "examples");
  if (!existsSync(src)) return;
  cpSync(src, join(DIST, "examples"), { recursive: true, dereference: true });
}

/** `--stub` 模式的桩进程;`stubAgentPath()` 默认经 `process.cwd()` 解析。 */
function packStubAgent() {
  const src = join(ROOT, "lib/app/stub-agent-process.mjs");
  if (!existsSync(src)) return;
  const dest = join(DIST, "lib/app/stub-agent-process.mjs");
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

export function packDist() {
  if (!existsSync(join(DIST, "server.mjs"))) {
    throw new Error("缺少 dist/server.mjs — 请先运行 scripts/build-server.mjs");
  }
  if (!existsSync(join(DIST, "client", "index.html"))) {
    throw new Error("缺少 dist/client/index.html — 请先运行 vite build");
  }
  rmSync(DIST_NM, { recursive: true, force: true });
  mkdirSync(DIST_NM, { recursive: true });

  const hoisted = packRuntimeDeps();
  // ★ 必须在 packWorkspacePackages() **之前**:那时 `node_modules/@blksails` 尚不存在,
  //   剪枝不可能误伤 `dist/packages/**/*.ts`(jiti 在运行时加载它们)。
  const pruned = pruneRuntimeDeps();
  packWorkspacePackages();
  const assetCount = packRuntimeAssets();
  packExamples();
  packStubAgent();
  return { dist: DIST, hoistedCount: hoisted.size, assetCount, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dist, hoistedCount, assetCount, pruned } = packDist();
  process.stdout.write(
    `[pack-dist] → ${dist} (hoist ${hoistedCount} 个运行时包, ${assetCount} 个运行时资源)\n`,
  );
  if (pruned.bytes > 0) {
    const mb = (pruned.bytes / 1048576).toFixed(1);
    process.stdout.write(
      `[pack-dist] 剪枝省 ${mb} MB (${pruned.files} 文件 / ${pruned.dirs} 目录);` +
        ` ${pruned.keptTs.length} 个包因运行时可解析到 .ts 而保留源码: ${pruned.keptTs.join(", ") || "无"}\n`,
    );
  } else if (process.env.PI_WEB_DIST_NO_PRUNE === "1") {
    process.stdout.write("[pack-dist] 剪枝已关闭(PI_WEB_DIST_NO_PRUNE=1)\n");
  }
}
