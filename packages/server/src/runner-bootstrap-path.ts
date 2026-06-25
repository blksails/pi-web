/**
 * Resolve the absolute path to the real-mode runner bootstrap script
 * (`runner-bootstrap.mjs`) that lives at the root of the `@blksails/pi-web-server`
 * package.
 *
 * This module computes the path from ITS OWN location (`import.meta.url`), so
 * the result is independent of `process.cwd()` and of how the host app is
 * bundled. It imports nothing from the pi SDK / jiti / the runner, so it is
 * safe to pull into the Next server bundle (the App calls this to get the
 * bootstrap path it then hands to `assemble` as `runnerEntry`).
 *
 * Layout:  packages/server/src/runner-bootstrap-path.ts  (this file)
 *          packages/server/runner-bootstrap.mjs          (target, one dir up)
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
// src/ -> package root
const serverPkgDir = path.dirname(path.dirname(here));

/**
 * Absolute path to `runner-bootstrap.mjs`.
 *
 * 优先用本模块位置(`import.meta.url`)推算(dev:源码树;同路径 standalone 亦可)。
 * 但 standalone 产物里 webpack 会把 `import.meta.url` **内联成构建机绝对路径**,产物
 * 换机/换 OS 后该路径不存在 —— 此时回退到运行时 cwd(产物以 cwd=standalone 根启动),
 * `runner-bootstrap.mjs` 落在 `packages/server/` 下。两者皆不存在才返回原计算值(让上层
 * 报清晰的 ENOENT)。
 */
export function runnerBootstrapPath(): string {
  const fromHere = path.join(serverPkgDir, "runner-bootstrap.mjs");
  if (existsSync(fromHere)) return fromHere;
  const fromCwd = path.join(
    process.cwd(),
    "packages/server/runner-bootstrap.mjs",
  );
  if (existsSync(fromCwd)) return fromCwd;
  return fromHere;
}
