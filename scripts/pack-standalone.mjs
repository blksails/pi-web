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
import { existsSync, cpSync } from "node:fs";
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

console.log(`[pack-standalone] 完成。standalone server: ${serverJs}`);
