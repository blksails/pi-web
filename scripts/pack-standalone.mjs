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
import { existsSync, cpSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

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

// 瘦身:CLI 包是 standalone 自包含产物,无需 test/docs/source-map/markdown 等开发文件(spec pi-web-cli 发布形态)。
const PRUNE_DIRS = new Set([
  "test", "tests", "__tests__", "docs", "doc", "example", "examples",
  ".github", ".vite", ".cache", "coverage", "stories", ".nyc_output", "man",
  // 纯 test/e2e 库:内部包 devDep 经 outputFileTracingIncludes 捎进来,运行时不需要
  "vitest", "vite", "@vitest", "tinypool", "tinyspy", "tinybench",
  "jsdom", "happy-dom", "@testing-library", "playwright", "playwright-core", "@playwright",
]);
const PRUNE_FILE = /\.(md|markdown|map|flow|tsbuildinfo)$|\.d\.ts$|^(changelog|authors|contributors|\.npmignore|\.editorconfig|\.prettierrc.*|\.eslintrc.*)$/i;
function prune(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (PRUNE_DIRS.has(e.name)) { rmSync(p, { recursive: true, force: true }); n++; }
      else n += prune(p);
    } else if (PRUNE_FILE.test(e.name)) { rmSync(p, { force: true }); n++; }
  }
  return n;
}
if (!process.env.PACK_NO_PRUNE) {
  const pruned = prune(standalone);
  console.log(`[pack-standalone] 瘦身:清理 ${pruned} 个开发文件/目录(test/docs/*.map/*.md…)`);
} else {
  console.log(`[pack-standalone] 跳过瘦身(PACK_NO_PRUNE=1)`);
}

console.log(`[pack-standalone] 完成。standalone server: ${serverJs}`);
