/**
 * 把解包器打成零运行时依赖的单文件（spec shared-runtime-payload 任务 2.3）。
 *
 * `src/runtime/unpack.src.mjs` → `payload/unpack.mjs`（约 115KB，内联 npm `tar`）。
 *
 * ★ 为什么必须打包：解包器要随 npm 包与 .app 分发，而它运行时**没有 node_modules**
 *   可用——它正是用来解包出那棵 node_modules 的（chicken-and-egg）。
 *
 * ★ 为什么不放进 dist/：同上。它必须位于 `payload/`，与它要解包的归档并列。
 */
import * as esbuild from "esbuild";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "src/runtime/unpack.src.mjs");
const OUT_DIR = join(ROOT, "payload");
const OUT_FILE = join(OUT_DIR, "unpack.mjs");

mkdirSync(OUT_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: OUT_FILE,
  // node: 内置模块由 platform=node 自动 external；tar 必须被内联。
  banner: {
    js: "// 由 scripts/build-unpacker.mjs 生成，勿手改。源码见 src/runtime/unpack.src.mjs。",
  },
  logLevel: "warning",
});

console.log(`[build-unpacker] ${OUT_FILE} (${(statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
