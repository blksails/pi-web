/**
 * 宿主 `@blksails/pi-web-kit` 版本的**唯一读取点**(#33)。
 *
 * 该值经各构建配置的 `define` 内联为 `__PI_WEB_KIT_VERSION__`,供 `server/bootstrap.ts`
 * 作为宿主自述版本(扩展兼容判定的输入)。
 *
 * ★ 为什么单独成文件:注入点分散在四处 —— `scripts/build-server.mjs`(生产服务端)、
 * `vite.config.ts`(dev/前端)、`vitest.config.ts`(单测)、`vitest.node-e2e.config.ts`
 * (node e2e)。若每处各写一遍读取逻辑,就又变成「需要人去对齐的多个真源」—— 那正是
 * #33 本身的病因。这里只留一份实现,各配置只引用。
 *
 * 新增构建路径时:import 本模块并加一行 `define`,别复制读取逻辑。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 读 `packages/web-kit/package.json` 的 version;缺失即抛(宁可构建失败,不要静默错值)。 */
export function readWebKitVersion() {
  const pkgPath = join(ROOT, "packages/web-kit/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`[web-kit-version] ${pkgPath} 缺少 version —— 宿主版本注入失败`);
  }
  return pkg.version;
}

/** 直接给各构建配置用的 `define` 片段。 */
export function webKitVersionDefine() {
  return { __PI_WEB_KIT_VERSION__: JSON.stringify(readWebKitVersion()) };
}
