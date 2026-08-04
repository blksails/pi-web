/**
 * Resolve the absolute path to the real-mode runner bootstrap script
 * (`runner-bootstrap.mjs`), which lives at the root of the
 * `@blksails/pi-web-runner` package.
 *
 * 本模块只做**解析**，从不 `import` runner 的实现 —— `createRequire(...).resolve()`
 * 只返回路径字符串，不加载模块。这是硬约束：兼容层一旦 import 新包，会把 runner 与整套
 * agent 运行时 SDK 拉进服务端产物，那正是 `index.ts:3-8` 刻意排除 runner 的原因。
 * 调用方（`lib/app/pi-handler.ts`）拿到路径后把它当 `runnerEntry` 交给 `assemble`。
 *
 * ## 三级解析（spec: runner-package-extraction 任务 4.1；design C3）
 *
 *   ① **包解析** `createRequire(import.meta.url).resolve(
 *      "@blksails/pi-web-runner/runner-bootstrap.mjs")`
 *      —— 与 `process.cwd()` **无关**。求值基准是本模块自身的位置，故 dev 源码树、
 *      `dist/` 产物树、standalone 分发树走的是**同一条**路径。这消除了旧实现里
 *      「dev 态主路径与 cwd 回退恒等命中 → 主路径断了也看不见」的成因。
 *      新包 `exports` 已声明该子路径（`packages/runner/package.json`）。
 *   ② 失败则回退运行时 `process.cwd()` 下的 `packages/runner/runner-bootstrap.mjs`，
 *      **并做 `existsSync`**。保住「产物以产物根为 cwd 启动」这一既有形态的兜底。
 *   ③ 两级皆不成立 → **抛错**，消息里列出所查过的全部位置。
 *
 * ★ ③ 是本 spec 唯一有意的逻辑变更。旧实现第二级**无条件返回**且不做存在性检查，
 *   于是解析失败被延后到 spawn 子进程时才以 ENOENT 现形，错误现场离根因很远。
 *
 * ## 为什么 ① 在打包产物里成立（已实证，勿凭直觉否掉）
 *
 * 早先本文件与 `scripts/build-server.mjs` 都声称构建器会把 `import.meta.url`
 * **内联成构建机绝对路径** —— 那是 **webpack/Next 时代**的行为，迁到 Vite + esbuild
 * （`format: "esm"`）后**已不成立**。esbuild 保留 `import.meta.url`。复核命令：
 *
 *     grep -c "import.meta.url" dist/server.mjs      # → 7（活的，未内联）
 *     ls -la dist/node_modules/@blksails/            # → 全部指向 ../../packages/* 的符号链接
 *
 * 产物树里 `createRequire(<dist/server.mjs>).resolve(...)` 能解析到工作区包，连通配
 * 深路径都成立。（`scripts/build-server.mjs` 里那处同样过时的注释由任务 4.2 修正。）
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** ① 的解析目标：新包声明的引导脚本子路径导出。 */
const BOOTSTRAP_SPECIFIER = "@blksails/pi-web-runner/runner-bootstrap.mjs";

/** ② 的兜底相对路径：产物 / 仓库根下引导脚本的落点。 */
const CWD_RELATIVE_BOOTSTRAP = path.join("packages", "runner", "runner-bootstrap.mjs");

/**
 * 解析所依赖的三个外部事实。抽成接口**仅**为了让三条分支各自可被单元测试直接驱动 ——
 * 分支 ② / ③ 无法在真实进程里稳定复现（包解析在本仓恒成功）。产品代码一律走
 * {@link runnerBootstrapPath}，它使用 {@link defaultResolutionDeps}。
 *
 * @internal 不从包主入口导出，不属于对外契约。
 */
export interface RunnerBootstrapResolutionDeps {
  /** 按 Node 包解析规则解析 specifier；解析不到时抛错。 */
  resolvePackageSubpath(specifier: string): string;
  exists(filePath: string): boolean;
  cwd(): string;
}

/** @internal */
export const defaultResolutionDeps: RunnerBootstrapResolutionDeps = {
  resolvePackageSubpath: (specifier) =>
    createRequire(import.meta.url).resolve(specifier),
  exists: existsSync,
  cwd: () => process.cwd(),
};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 三级解析的实现体。
 *
 * @internal 测试注入用；产品代码请用 {@link runnerBootstrapPath}。
 * @throws 三级皆不成立时抛出，错误消息包含所查过的**全部**位置。
 */
export function resolveRunnerBootstrapPath(
  deps: RunnerBootstrapResolutionDeps = defaultResolutionDeps,
): string {
  const attempted: string[] = [];

  // ① 包解析（与 process.cwd() 无关）
  try {
    const resolved = deps.resolvePackageSubpath(BOOTSTRAP_SPECIFIER);
    if (deps.exists(resolved)) return resolved;
    attempted.push(`包解析 ${BOOTSTRAP_SPECIFIER} → ${resolved}（文件不存在）`);
  } catch (err) {
    attempted.push(`包解析 ${BOOTSTRAP_SPECIFIER} → 解析失败：${describeError(err)}`);
  }

  // ② 工作目录兜底（补上存在性检查 —— 旧实现在此无条件返回）
  const fromCwd = path.join(deps.cwd(), CWD_RELATIVE_BOOTSTRAP);
  if (deps.exists(fromCwd)) return fromCwd;
  attempted.push(`工作目录兜底 → ${fromCwd}（文件不存在）`);

  // ③ 解析时即失败，而不是把 ENOENT 延后到 spawn 子进程时
  throw new Error(
    `无法解析 runner 引导脚本 runner-bootstrap.mjs。已查过以下位置：\n` +
      attempted.map((line) => `  - ${line}`).join("\n"),
  );
}

/**
 * Absolute path to `runner-bootstrap.mjs`。
 *
 * @throws 解析不到真实存在的脚本时抛出（消息含所查过的全部位置）。
 */
export function runnerBootstrapPath(): string {
  return resolveRunnerBootstrapPath();
}
