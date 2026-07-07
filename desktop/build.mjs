/**
 * 桌面壳构建脚本(spec pi-web-desktop task 1.3)。
 *
 * 用 esbuild 把主进程与 preload 打成自包含 CJS 产物(dist/):关键在于**构建期内联**从
 * `bin/pi-web.mjs` 复用的纯函数(buildEnv/findFreePort/waitForReady/standaloneServerJs),
 * 使打包态(Electron app)无需在运行时 import 仓库根脚本即可运行。
 *
 * - `electron` 外置(运行时由 Electron 提供,不打进 bundle)。
 * - Node 内建自动外置(platform:"node")。
 * - `src/preload.ts` 存在才打(task 2.2 引入),故本脚本无需随后续任务改动。
 * - `static/` 若存在则整目录拷进 `dist/static`(加载页等运行时资源)。
 */
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

const entries = [{ in: join(ROOT, "src/main.ts"), out: "dist/main.js" }];
const preload = join(ROOT, "src/preload.ts");
if (existsSync(preload)) entries.push({ in: preload, out: "dist/preload.js" });

for (const e of entries) {
  await build({ ...common, entryPoints: [e.in], outfile: join(ROOT, e.out) });
}

const staticDir = join(ROOT, "static");
if (existsSync(staticDir)) {
  await mkdir(join(ROOT, "dist/static"), { recursive: true });
  await cp(staticDir, join(ROOT, "dist/static"), { recursive: true });
}

console.log(`[desktop] build 完成:${entries.map((e) => e.out).join(", ")}`);
