/**
 * 服务端单文件入口构建(spec vite-spa-migration 任务 6.1,Req 5.1)。
 *
 * ★ 入口必须位于**产物根**:`dist/server.mjs`,不能是 `dist/server/index.mjs`。
 *
 * 理由(design 决定性约束):`packages/server` 的 `runnerBootstrapPath()` 与
 * `resolvePiCliEntry()` 采用「① 从 `import.meta.url` 推算 → ② 失败或不存在则回退
 * `process.cwd()`」。esbuild 与 webpack 一样会把 `import.meta.url` 内联为**构建机绝对
 * 路径**,异机/异 OS 下路径 ① 必然失效,只能依赖路径 ②。而 `bin/pi-web.mjs` 以
 * `dirname(serverJs)` 作 cwd —— 入口若在子目录,cwd 就不是产物根,回退全部失效,
 * 真实会话必崩(且只有 `e2e:cli:reloc` 能抓到)。
 *
 * external 清单(design 决策 4):
 *  - pi SDK 两包 + jiti —— agent 子进程在**运行时**经 jiti 动态 import,静态打包它们既无意义
 *    也会破坏 pnpm 的 realpath 解析布局(这正是旧 `pack-standalone.mjs` 563 行要修的伤)。
 *  - pg —— 含可选的 `require('pg-native')`,避免 esbuild 静态解析失败。
 *  - `node:sqlite` 是 Node 内置;`zod` 纯 JS —— 均可安全 bundle。
 */
import * as esbuild from "esbuild";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(process.env.PI_WEB_DIST ?? join(ROOT, "dist"));
/** ★ 产物根,不是子目录。 */
const OUT_FILE = join(OUT_DIR, "server.mjs");
/**
 * ★ 子命令实现入口,同样落在**产物根**(spec cli-package-commands 任务 1.1,Req 10.6)。
 * 与 `OUT_FILE` 同级 —— `bin/pi-web.mjs` 对非 run 意图动态加载它时,理由与
 * `server.mjs` 必须在产物根完全一致(见文件顶部注释)。
 */
const CLI_COMMANDS_OUT_FILE = join(OUT_DIR, "cli-commands.mjs");

export const EXTERNAL = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "jiti",
  "pg",
  "pg-native",
];

/** 与 `vite.config.ts` / `vitest.node-e2e.config.ts` 一致的工作区别名。 */
const ALIAS = {
  "@blksails/pi-web-logger": "packages/logger/src/index.ts",
  "@blksails/pi-web-agent-kit": "packages/agent-kit/src/index.ts",
  "@blksails/pi-web-canvas-kit": "packages/canvas-kit/src/index.ts",
  "@blksails/pi-web-primitives": "packages/primitives/src/index.ts",
  "@blksails/pi-web-canvas-ui": "packages/canvas-ui/src/index.ts",
  "@blksails/pi-web-tool-kit/aigc-canvas-schema":
    "packages/tool-kit/src/aigc/canvas/schema.ts",
  "@blksails/pi-web-tool-kit/commands": "packages/tool-kit/src/commands/index.ts",
  "@blksails/pi-web-tool-kit/extension-entry":
    "packages/tool-kit/src/extension-tools/entry-path.ts",
  "@blksails/pi-web-tool-kit/auto-title-entry":
    "packages/tool-kit/src/auto-title/entry-path.ts",
  "@blksails/pi-web-tool-kit/runtime": "packages/tool-kit/src/runtime.ts",
  "@blksails/pi-web-tool-kit": "packages/tool-kit/src/index.ts",
};

/**
 * 裸路径→文件的扩展名探测:esbuild 对**插件已返回的路径**不会再套用
 * `resolveExtensions`(那只作用于 esbuild 自身的默认解析算法),故无扩展名的 `@/…`
 * 说明符(如 `@/server/cli/context`)必须由插件自己探测出真实文件,否则 "Cannot read
 * file" 报错——生产 esbuild 构建才会暴露,dev 服务器走的是另一条(tsconfig-paths 感知的)
 * 解析链,不会复现。
 */
function resolveWithExtension(absPath) {
  if (existsSync(absPath)) return absPath;
  for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
    if (existsSync(absPath + ext)) return absPath + ext;
  }
  for (const ext of [".ts", ".tsx"]) {
    const indexPath = join(absPath, `index${ext}`);
    if (existsSync(indexPath)) return indexPath;
  }
  return absPath;
}

/** `@/x` → `<root>/x`(tsconfig paths 的 `@/*`)。 */
const aliasPlugin = {
  name: "pi-web-alias",
  setup(build) {
    for (const [spec, target] of Object.entries(ALIAS)) {
      const filter = new RegExp(`^${spec.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}$`);
      build.onResolve({ filter }, () => ({
        path: resolveWithExtension(join(ROOT, target)),
      }));
    }
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveWithExtension(join(ROOT, args.path.slice(2))),
    }));
  },
};

/** 两个入口共享的 esbuild 选项(alias/banner/external 等),仅 entryPoints/outfile 各异。 */
function sharedBuildOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: EXTERNAL,
    plugins: [aliasPlugin],
    // `.js` 扩展名的相对 import 实际指向 `.ts` 源(NodeNext 约定)。
    resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
    loader: { ".ts": "ts", ".tsx": "tsx" },
    // pi SDK 的 CJS/ESM 混用依赖 `require` 存在;ESM 产物需自建 shim。
    banner: {
      js: [
        "import { createRequire as __pwCreateRequire } from 'node:module';",
        "const require = __pwCreateRequire(import.meta.url);",
      ].join("\n"),
    },
    logLevel: "info",
    metafile: true,
  };
}

export async function buildServer() {
  rmSync(OUT_FILE, { force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const result = await esbuild.build(
    sharedBuildOptions(join(ROOT, "server", "index.ts"), OUT_FILE),
  );

  return { outfile: OUT_FILE, metafile: result.metafile };
}

/**
 * 子命令实现入口的第二次构建(spec cli-package-commands 任务 1.1)。
 * 本任务只建立构建接缝:`server/cli/index.ts` 目前只是最小骨架。
 */
export async function buildCliCommands() {
  rmSync(CLI_COMMANDS_OUT_FILE, { force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const result = await esbuild.build(
    sharedBuildOptions(join(ROOT, "server", "cli", "index.ts"), CLI_COMMANDS_OUT_FILE),
  );

  return { outfile: CLI_COMMANDS_OUT_FILE, metafile: result.metafile };
}

export { CLI_COMMANDS_OUT_FILE };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outfile } = await buildServer();
  process.stdout.write(`[build-server] → ${outfile}\n`);
  const { outfile: cliOutfile } = await buildCliCommands();
  process.stdout.write(`[build-server] → ${cliOutfile}\n`);
}
