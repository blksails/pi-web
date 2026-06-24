/**
 * `@blksails/web-kit/build` — `pi-web build` 程序化入口(esbuild 编排 + externals 强制 +
 * CSS scoping + manifest/SRI 产出)。实现见 awe-2(任务 2.2/2.3/2.4)。
 */
export type { BuildOptions, BuildResult } from "./build.js";
export { buildWebExtension } from "./build.js";
