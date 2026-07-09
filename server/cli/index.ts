/**
 * pi-web CLI 子命令实现入口(spec cli-package-commands,任务 1.1,Req 10.6)。
 *
 * 这是第二个 esbuild 单文件产物(`dist/cli-commands.mjs`)的构建入口 —— 与
 * `server/index.ts` → `dist/server.mjs` 同级,同样落在**产物根**。`bin/pi-web.mjs`
 * 对非 `run` 意图(create/install/uninstall/list/update/publish)会动态 `import()`
 * 该产物,复用后端已有的校验与编译逻辑,免于在薄启动器里重复实现。
 *
 * 本任务只建立构建接缝与最小骨架:真正的子命令分发(`runSubcommand`)与各子域实现
 * (scaffold/install/publish/registry)留给后续任务。此处先导出一个可被动态加载并
 * 调用的占位函数,验证「产物存在 + 可被 CLI 壳 import 并调用其导出」这条接缝成立。
 *
 * 任务 1.2 新增共享的运行上下文(`CliContext`)与进度报告器(`ProgressReporter`),
 * 在此 re-export 使其随本产物一并分发;尚无子命令消费它们(留给后续任务)。
 */

/**
 * 占位导出,证明本产物可被 `import()` 并调用其导出函数。
 * 后续任务(2.x 起)将替换为真正的 `runSubcommand(name, argv, ctx)` 分发入口。
 */
export function cliCommandsEntryReady(): true {
  return true;
}

export {
  createCliContext,
  resolveAgentDir,
  resolveSourcesRoot,
  defaultSourcesRoot,
  buildChildEnv,
  type CliContext,
  type CreateCliContextOptions,
} from "./context.js";
export {
  createProgressReporter,
  redactSecrets,
  type ProgressReporter,
  type ProgressReporterOptions,
  type ProgressStage,
  type CliError,
} from "./reporter.js";

/**
 * re-export `scaffold` / `listTemplates` / `resolveExamplesRoot`(任务 3.3,Req 2.10)。
 *
 * 这是本任务的最小必要接线:e2e 验证脚本需要从分发产物 `dist/cli-commands.mjs` 动态
 * `import()` 出骨架生成能力,以便在不启动完整 `create` 子命令分发的前提下,仍能用真实
 * 产物验证「生成的骨架可直接运行、无需额外安装依赖」这条观察态。**不在此处实现 `create`
 * 子命令的参数解析与分发**——那属于任务 6.1 的接线范围,本次只 re-export 既有能力。
 */
export {
  scaffold,
  type ScaffoldRequest,
  type ScaffoldSuccess,
  type ScaffoldError,
  type Result as ScaffoldResult,
} from "./scaffold/scaffold-writer.js";
export {
  listTemplates,
  resolveTemplate,
  resolveExamplesRoot,
  type TemplateInfo,
  type TemplateResolution,
} from "./scaffold/template-catalog.js";
