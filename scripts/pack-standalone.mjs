#!/usr/bin/env node
/**
 * pack-standalone — Next.js `output:"standalone"` 的构建后收尾(spec pi-web-cli, Task 1.2)。
 *
 * standalone 产物**不**自带 `.next/static` 与 `public/`,须在 build 后手动复制进
 * `<distDir>/standalone` 对应位置,否则页面样式/脚本与公共资源缺失。本脚本:
 *   1) 校验 standalone 的 `server.js` 存在(缺失=尚未以 standalone 模式 build);
 *   2) 复制静态资源 `<distDir>/static` → `<standalone>/<distDir>/static`;
 *   3) 复制 `public/` → `<standalone>/public`(若存在)。
 *
 * 复制为覆盖式,可重复执行。布局假设 `outputFileTracingRoot` = app 根(= workspace 根),
 * 故 standalone 内 app 文件在根、`server.js` 在 standalone 根。
 */
import {
  existsSync,
  cpSync,
  readdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const distDir = process.env.NEXT_DIST_DIR ?? ".next-cli";
const root = resolve();
const standalone = join(root, distDir, "standalone");
const serverJs = join(standalone, "server.js");

if (!existsSync(serverJs)) {
  console.error(
    `[pack-standalone] 未找到 ${serverJs}\n` +
      `  请先以 standalone 模式构建:\`next build\`(next.config 已设 output:"standalone")。`,
  );
  process.exit(1);
}

const staticSrc = join(root, distDir, "static");
const staticDest = join(standalone, distDir, "static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log(`[pack-standalone] static → ${staticDest}`);
} else {
  console.warn(`[pack-standalone] 跳过 static(不存在 ${staticSrc})`);
}

const publicSrc = join(root, "public");
const publicDest = join(standalone, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
  console.log(`[pack-standalone] public → ${publicDest}`);
}

// Bug A 修复(spec pi-web-cli):会话激活时主进程 spawn 的 runner 子进程经 jiti 从
// `packages/server/node_modules/@earendil-works/*` 解析 pi SDK。dev 下这些是指向
// `.pnpm` store 的符号链接 —— Node 运行时默认先 realpath 再做模块解析,于是 pi SDK
// 的传递依赖(chalk / yaml / undici / cross-spawn …)从 `.pnpm` 同级链接处可解析。
// 但 nft(Node File Tracing)打包 standalone 时把符号链接**解引用拍平成无依赖的实体
// 目录**,链条断裂 → 子进程一起就 `Cannot find module 'chalk'` 崩溃、会话被销毁。
// `.pnpm` 规范副本(含完整同级依赖链接)其实已被 outputFileTracingIncludes 捎进产物,
// 这里把拍平副本替换回指向 `.pnpm` 规范副本的相对符号链接,精确还原 dev 的可跑布局。
function relinkPiSdkToPnpm() {
  const scopeDir = join(
    standalone,
    "packages/server/node_modules/@earendil-works",
  );
  const pnpmDir = join(standalone, "node_modules/.pnpm");
  if (!existsSync(scopeDir) || !existsSync(pnpmDir)) {
    console.warn(
      `[pack-standalone] 跳过 pi SDK relink(未找到 ${existsSync(scopeDir) ? pnpmDir : scopeDir})`,
    );
    return 0;
  }
  const pnpmEntries = readdirSync(pnpmDir);
  let n = 0;
  for (const e of readdirSync(scopeDir, { withFileTypes: true })) {
    // 已是符号链接(重复执行)或非目录则跳过。
    if (e.isSymbolicLink() || !e.isDirectory()) continue;
    const flat = join(scopeDir, e.name);
    let version = "";
    try {
      version = JSON.parse(
        readFileSync(join(flat, "package.json"), "utf8"),
      ).version;
    } catch {
      /* 无 package.json/版本则退化为前缀匹配 */
    }
    // `.pnpm` 目录名形如 `@earendil-works+<name>@<ver>_<peerhash>`;按版本精确匹配,
    // 多版本并存时只取版本一致者(prefix 后必须紧跟 `_` 或终止,避免 0.79.6 误配 0.79.60)。
    const prefix = `@earendil-works+${e.name}@${version}`;
    const match = pnpmEntries.find(
      (d) =>
        version &&
        (d === prefix || d.startsWith(`${prefix}_`)) &&
        existsSync(join(pnpmDir, d, "node_modules/@earendil-works", e.name)),
    );
    if (!match) {
      console.warn(
        `[pack-standalone] 未找到 @earendil-works/${e.name}@${version || "?"} 的 .pnpm 规范副本,保留拍平副本(可能无法解析其依赖)`,
      );
      continue;
    }
    const canonical = join(
      pnpmDir,
      match,
      "node_modules/@earendil-works",
      e.name,
    );
    rmSync(flat, { recursive: true, force: true });
    const rel = relative(scopeDir, canonical);
    symlinkSync(rel, flat, "dir");
    console.log(`[pack-standalone] relink @earendil-works/${e.name} → ${rel}`);
    n++;
  }
  return n;
}
const relinked = relinkPiSdkToPnpm();
console.log(`[pack-standalone] pi SDK relink:还原 ${relinked} 个 .pnpm 符号链接`);

// Bug C 修复(logging-system 合入后暴露):runner 子进程经 bootstrap jiti 在 runner.ts
// 顶层 import 一批 `@blksails/*` workspace 包(logger / protocol,以及 agent-loader 经
// alias 加载的 agent-kit;protocol 又依赖 logger)。dev 下这些靠 pnpm 在各包 node_modules
// 里建的 workspace 符号链接解析;standalone 里 nft 既不会为动态子进程建链接,又会把零星
// 追踪到的副本拍平。这里**还原 dev 的 workspace 解析**:
//   1) 在 standalone 顶层 `node_modules/@blksails/<name>` 建相对符号链接 → 对应包源码
//      目录(经 outputFileTracingIncludes 已落到 `standalone/packages/<dir>`)。任何
//      `packages/*/src/**` 的 bare import 都会沿 node_modules 向上查找命中此顶层链接。
//   2) 把 nft 在各 `packages/*/node_modules/@blksails/<dep>` 拍平/错指的副本一并替换为
//      指向同一源码目录的符号链接,避免就近的坏副本遮蔽顶层链接。
// 由此 standalone 的 @blksails 解析与 dev 完全一致(jiti 负责 TS 源码转译)。
function relinkWorkspacePackages() {
  const pkgsDir = join(standalone, "packages");
  if (!existsSync(pkgsDir)) {
    console.warn(`[pack-standalone] 跳过 workspace relink(未找到 ${pkgsDir})`);
    return 0;
  }
  // 扫描 standalone/packages/* 构建 包名(@blksails/x)→ 源码目录 的映射。
  const nameToDir = new Map();
  for (const e of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(pkgsDir, e.name);
    try {
      const name = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ).name;
      if (typeof name === "string" && name.startsWith("@blksails/")) {
        nameToDir.set(name, dir);
      }
    } catch {
      /* 无 package.json 的目录跳过 */
    }
  }
  if (nameToDir.size === 0) return 0;

  let n = 0;
  // 1) 顶层 node_modules/@blksails/<name> → 源码目录(相对符号链接,覆盖式)。
  const topScope = join(standalone, "node_modules/@blksails");
  mkdirSync(topScope, { recursive: true });
  for (const [name, dir] of nameToDir) {
    const linkPath = join(topScope, name.slice("@blksails/".length));
    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(relative(topScope, dir), linkPath, "dir");
    n++;
  }

  // 2) 把各 packages/*/node_modules/@blksails/<dep> 的拍平/错指副本替换为指向源码目录的链接。
  for (const e of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const depScope = join(pkgsDir, e.name, "node_modules/@blksails");
    if (!existsSync(depScope)) continue;
    for (const dep of readdirSync(depScope, { withFileTypes: true })) {
      const depName = `@blksails/${dep.name}`;
      const target = nameToDir.get(depName);
      if (!target) continue; // 非 workspace 包(不应出现),保留
      const depPath = join(depScope, dep.name);
      rmSync(depPath, { recursive: true, force: true });
      symlinkSync(relative(depScope, target), depPath, "dir");
      n++;
    }
  }
  console.log(
    `[pack-standalone] workspace relink:${[...nameToDir.keys()].join(", ")}`,
  );
  return n;
}
const wsRelinked = relinkWorkspacePackages();
console.log(`[pack-standalone] workspace relink:还原 ${wsRelinked} 个 @blksails 符号链接`);

// runner/stub 子进程经 jiti 加载 server src,server src 又 import 普通 npm 依赖(如 zod
// 的 schema 校验)。dev 下这些靠 pnpm 在 `packages/server/node_modules/<dep>` 建链接解析;
// standalone 里 nft 不为动态子进程复制,导致 `Cannot find module 'zod'`(扩展/store 装配
// 降级)。这里按 server 的运行时 `dependencies` 把仍不可解析的普通 npm 依赖 hoist 到顶层
// `node_modules/<dep>`(指向 `.pnpm` 规范副本),子进程沿 node_modules 向上查找即可命中。
// 仅处理普通包:@blksails(workspace relink 已覆盖)、@earendil-works(pi SDK relink 已
// 覆盖)跳过;type-only 依赖(如 `pg`,运行时被擦除、`.pnpm` 里根本不存在)经 existsSync 守卫
// 自动跳过。
function hoistServerRuntimeDeps() {
  const serverPkg = join(standalone, "packages/server/package.json");
  const pnpmDir = join(standalone, "node_modules/.pnpm");
  if (!existsSync(serverPkg) || !existsSync(pnpmDir)) return 0;
  let deps = {};
  try {
    deps = JSON.parse(readFileSync(serverPkg, "utf8")).dependencies ?? {};
  } catch {
    return 0;
  }
  const topNm = join(standalone, "node_modules");
  const serverProbe = join(standalone, "packages/server/src/index.ts");
  const probeRequire = createRequire(serverProbe);
  const pnpmEntries = readdirSync(pnpmDir);
  let n = 0;
  for (const name of Object.keys(deps)) {
    if (name.startsWith("@blksails/") || name.startsWith("@earendil-works/")) {
      continue; // 由 workspace / pi SDK relink 覆盖
    }
    // 已可从 server src 解析(如 jiti)则跳过,避免无谓 hoist / 覆盖。
    try {
      probeRequire.resolve(name);
      continue;
    } catch {
      /* 不可解析 → 尝试 hoist */
    }
    // 在 `.pnpm` 里找该包的规范副本:目录名形如 `<encoded>@<ver>[_peers]`,
    // encoded = name 把 `/` 换成 `+`(scoped 包)。
    const encoded = name.replace("/", "+");
    const match = pnpmEntries.find(
      (d) =>
        (d.startsWith(`${encoded}@`) &&
          existsSync(join(pnpmDir, d, "node_modules", name))),
    );
    if (!match) continue; // type-only / 未被追踪 → 跳过(运行时不需要)
    const canonical = join(pnpmDir, match, "node_modules", name);
    const linkPath = join(topNm, name);
    if (name.includes("/")) {
      mkdirSync(join(topNm, name.split("/")[0]), { recursive: true });
    }
    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(relative(join(linkPath, ".."), canonical), linkPath, "dir");
    console.log(`[pack-standalone] hoist npm dep:${name} → ${match}`);
    n++;
  }
  return n;
}
const hoisted = hoistServerRuntimeDeps();
console.log(`[pack-standalone] hoist server 运行时依赖:${hoisted} 个`);

// 瘦身:CLI 包是 standalone 自包含产物,无需开发文件。
//
// 关键(Bug B 修复):**只**删除"本身就是一个 dev 工具包"的目录 —— 即直接位于某个
// `node_modules` 下、且名字在白名单内的整包。绝不按名字递归删除任意子目录:旧实现把
// 任何名为 `doc`/`docs`/`test`/`example`… 的目录无差别删掉,误杀了 `yaml/dist/doc`
// 这类**运行时代码**(其内 `directives.js` 被 yaml 的 composer 运行时 require),导致
// 接通依赖后子进程仍崩在 `Cannot find module '../doc/directives.js'`。
// 通用内容目录名的无差别删除收益有限而风险极高,故移除;大头(dev 工具包整包 + *.map /
// *.d.ts / *.md 等按扩展名删文件)仍保留,且按扩展名删文件对运行时安全。
const PRUNE_PACKAGES = new Set([
  // 纯 test/e2e 库:内部包 devDep 经 outputFileTracingIncludes 捎进来,运行时不需要
  "vitest", "vite", "@vitest", "tinypool", "tinyspy", "tinybench",
  "jsdom", "happy-dom", "@testing-library", "playwright", "playwright-core", "@playwright",
]);
const PRUNE_FILE = /\.(md|markdown|map|flow|tsbuildinfo)$|\.d\.ts$|^(changelog|authors|contributors|\.npmignore|\.editorconfig|\.prettierrc.*|\.eslintrc.*)$/i;
function prune(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) {
      // 不跟随符号链接(如 relink 后的 pi SDK、.pnpm 内部同级 dep 链接),避免
      // 误删链接目标(运行时代码)或重复遍历。仅当链接名本身命中扩展名规则才删链接文件。
      if (!e.isDirectory() && PRUNE_FILE.test(e.name)) {
        rmSync(p, { force: true });
        n++;
      }
      continue;
    }
    if (e.isDirectory()) {
      // 仅删"直接位于 node_modules 下、且在白名单内"的整包;其余目录递归进入。
      if (PRUNE_PACKAGES.has(e.name) && basename(dir) === "node_modules") {
        rmSync(p, { recursive: true, force: true });
        n++;
      } else {
        n += prune(p);
      }
    } else if (PRUNE_FILE.test(e.name)) {
      rmSync(p, { force: true });
      n++;
    }
  }
  return n;
}
if (!process.env.PACK_NO_PRUNE) {
  const pruned = prune(standalone);
  console.log(`[pack-standalone] 瘦身:清理 ${pruned} 个开发文件/目录(dev 工具包整包 + *.map/*.d.ts/*.md…)`);
} else {
  console.log(`[pack-standalone] 跳过瘦身(PACK_NO_PRUNE=1)`);
}

console.log(`[pack-standalone] 完成。standalone server: ${serverJs}`);
