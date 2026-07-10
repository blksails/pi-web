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

/**
 * `pi-web add` 编排器(spec cli-component-add,任务 3.2)。
 * bin 壳对 `add` 子命令做专用 early-dispatch:动态 `import()` 本产物后调用 `runAdd(argv)`,
 * 透传其退出码。add 的选项面(--target/--dry-run/--force)与 Wave 1 词条差异较大,
 * 整合后维持 early-dispatch 路径,不并入下方 `runSubcommand` 的词条 switch。
 */
export { runAdd, ADD_USAGE, type AddCommandOptions } from "./component/add-command.js";

// ---------------------------------------------------------------------------
// runSubcommand — 分发层(任务 6.1,Req 1.7)
// ---------------------------------------------------------------------------

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import type { PluginKind } from "@blksails/pi-web-protocol";
import { scaffold, type ScaffoldError } from "./scaffold/scaffold-writer.js";
import { listTemplates, resolveExamplesRoot } from "./scaffold/template-catalog.js";
import { createCliContext } from "./context.js";
import { createProgressReporter, type ProgressReporter, type CliError } from "./reporter.js";
import { createInstaller, type Installer } from "./install/installer.js";
import { createPluginInstaller, type PluginInstaller } from "./install/plugin-installer.js";

/** 已知子命令名(与 `bin/pi-web.mjs` 的 `SUBCOMMAND_NAMES` 同一份契约,此处独立声明避免
 * 从 `.mjs` 反向 import 类型)。Wave 1 五个 + `publish`(Wave 2,尚未接入)。 */
export type SubcommandName = "create" | "install" | "uninstall" | "list" | "update" | "publish";

/**
 * `runSubcommand` 的可注入依赖(design.md Error Handling:全部依赖可测试替身注入,
 * 绝不在单测里真跑 `pi`/`git`/`npm`/网络)。
 *
 * 高层端口(`installer`/`pluginInstaller`)优先于低层工厂参数被使用 —— 测试直接注入
 * 已构造好的 `Installer`/`PluginInstaller` 替身(与 `installer.test.ts`/`plugin-installer.test.ts`
 * 同策略),不需要再深一层注入 `PiCli`/`CommandRunner` 等。
 */
export interface RunSubcommandDeps {
  /** 调用目录,缺省 `process.cwd()`;测试注入以避免依赖真实 cwd。 */
  readonly cwd?: string;
  /** 环境变量源,缺省 `process.env`。 */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * `create` 子命令解析 `examplesRoot` 的候选路径(按优先级排列,取第一个真实存在的)。
   * 缺省由调用方(`bin/pi-web.mjs`)按「产物根旁 examples/ 优先，仓库根 examples/ 兜底」
   * 传入 —— 见任务报告 DIST_ROOT_STRATEGY。
   */
  readonly examplesRootCandidates?: readonly string[];
  /** 进度报告器,缺省新建一个真实(`console.log`)实现。 */
  readonly reporter?: ProgressReporter;
  /** 测试替身:`scaffold()` 的注入点(缺省真实实现)。 */
  readonly scaffoldFn?: typeof scaffold;
  /** 测试替身:`listTemplates()` 的注入点(缺省真实实现)。 */
  readonly listTemplatesFn?: typeof listTemplates;
  /** `install`/`uninstall` 用的 `Installer` 端口;缺省按 `CliContext` 装配真实实现。 */
  readonly installer?: Installer;
  /** `list`/`update` 用的 `PluginInstaller` 端口;缺省装配真实实现。 */
  readonly pluginInstaller?: PluginInstaller;
}

/** `create` 只支持 agent|plugin 两种骨架;`component` 包经 `pi-web add` 车道分发,无骨架模板。 */
const DEFAULT_TEMPLATE_BY_KIND: Record<Exclude<PluginKind, "component">, string> = {
  agent: "minimal-agent",
  plugin: "plugin-code-review-agent",
};

function usageError(reporter: ProgressReporter, stage: string, message: string): number {
  reporter.fail(stage, { code: "USAGE_ERROR", message });
  return 1;
}

function scaffoldErrorToCliError(error: ScaffoldError): CliError {
  switch (error.code) {
    case "TARGET_NOT_EMPTY":
      return { code: error.code, message: `目标目录已存在且非空: ${error.path}` };
    case "TEMPLATE_NOT_FOUND":
      return {
        code: error.code,
        message: `模板不存在: "${error.name}"(可用模板: ${
          error.available.length > 0 ? error.available.join(", ") : "无"
        })`,
      };
  }
}

async function runCreate(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        kind: { type: "string" },
        template: { type: "string" },
        list: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    return usageError(reporter, "create", err instanceof Error ? err.message : String(err));
  }

  const examplesRoot = resolveExamplesRoot(
    deps.examplesRootCandidates ?? [],
    existsSync,
  );
  if (examplesRoot === undefined) {
    return usageError(
      reporter,
      "create",
      "无法定位随包分发的模板目录(examples/);请检查安装是否完整。",
    );
  }

  const listTemplatesFn = deps.listTemplatesFn ?? listTemplates;
  if (parsed.values.list === true) {
    const templates = listTemplatesFn(examplesRoot);
    for (const t of templates) {
      // eslint-disable-next-line no-console
      console.log(`${t.name}\t${t.title}\t${t.description}`);
    }
    reporter.complete("create", `${templates.length} 个可用模板`);
    return 0;
  }

  const [name] = parsed.positionals;
  if (name === undefined) {
    return usageError(reporter, "create", "缺少必需的 <name> 参数(运行 `pi-web create --help` 查看用法)。");
  }

  const kindRaw = parsed.values.kind ?? "agent";
  if (kindRaw !== "agent" && kindRaw !== "plugin") {
    return usageError(reporter, "create", `--kind 取值非法: "${kindRaw}"(应为 agent 或 plugin)。`);
  }
  const kind: PluginKind = kindRaw;
  const templateName = parsed.values.template ?? DEFAULT_TEMPLATE_BY_KIND[kind];

  const cwd = deps.cwd ?? process.cwd();
  const targetDir = resolvePath(cwd, name);
  const scaffoldFn = deps.scaffoldFn ?? scaffold;

  reporter.start("create", `生成骨架 ${name}(${kind}, 模板 ${templateName})`);
  const result = await scaffoldFn({ name, kind, templateName, targetDir }, examplesRoot);
  if (!result.ok) {
    reporter.fail("create", scaffoldErrorToCliError(result.error));
    return 1;
  }
  reporter.complete(
    "create",
    `${result.value.absolutePath}\n下一步: ${result.value.nextStepHint}`,
  );
  return 0;
}

async function runInstall(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        project: { type: "boolean", default: false },
        kind: { type: "string" },
      },
    });
  } catch (err) {
    return usageError(reporter, "install", err instanceof Error ? err.message : String(err));
  }

  const [source] = parsed.positionals;
  if (source === undefined) {
    return usageError(reporter, "install", "缺少必需的 <source> 参数(运行 `pi-web install --help` 查看用法)。");
  }

  let kindHint: PluginKind | undefined;
  if (parsed.values.kind !== undefined) {
    if (parsed.values.kind !== "agent" && parsed.values.kind !== "plugin") {
      return usageError(reporter, "install", `--kind 取值非法: "${parsed.values.kind}"(应为 agent 或 plugin)。`);
    }
    kindHint = parsed.values.kind;
  }

  const cwd = deps.cwd ?? process.cwd();
  const installer = deps.installer ?? createDefaultInstaller(deps);

  reporter.start("install", source);
  const res = await installer.install(source, {
    scope: parsed.values.project === true ? "project" : "user",
    kindHint,
    cwd,
  });
  if (!res.ok) {
    reporter.fail("install", { code: res.error.code, message: res.error.message });
    return 1;
  }
  reporter.complete("install", `${res.value.kind}: ${JSON.stringify(res.value.result)}`);
  return 0;
}

async function runUninstall(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        project: { type: "boolean", default: false },
        kind: { type: "string" },
      },
    });
  } catch (err) {
    return usageError(reporter, "uninstall", err instanceof Error ? err.message : String(err));
  }

  const [name] = parsed.positionals;
  if (name === undefined) {
    return usageError(reporter, "uninstall", "缺少必需的 <name> 参数(运行 `pi-web uninstall --help` 查看用法)。");
  }

  let kindHint: PluginKind | undefined;
  if (parsed.values.kind !== undefined) {
    if (parsed.values.kind !== "agent" && parsed.values.kind !== "plugin") {
      return usageError(reporter, "uninstall", `--kind 取值非法: "${parsed.values.kind}"(应为 agent 或 plugin)。`);
    }
    kindHint = parsed.values.kind;
  }

  const cwd = deps.cwd ?? process.cwd();
  const installer = deps.installer ?? createDefaultInstaller(deps);

  reporter.start("uninstall", name);
  const res = await installer.uninstall(name, {
    scope: parsed.values.project === true ? "project" : "user",
    kindHint,
    cwd,
  });
  if (!res.ok) {
    reporter.fail("uninstall", { code: res.error.code, message: res.error.message });
    return 1;
  }
  reporter.complete("uninstall", `${res.value.kind}: ${JSON.stringify(res.value.result)}`);
  return 0;
}

async function runList(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { outdated: { type: "boolean", default: false } },
    });
  } catch (err) {
    return usageError(reporter, "list", err instanceof Error ? err.message : String(err));
  }

  const pluginInstaller = deps.pluginInstaller ?? createPluginInstaller();
  const res = await pluginInstaller.listInstalled({ outdated: parsed.values.outdated === true });
  if (!res.ok) {
    reporter.fail("list", { code: res.error.code, message: res.error.message });
    return 1;
  }
  if (res.value.length === 0) {
    reporter.complete("list", "无已安装包");
    return 0;
  }
  for (const entry of res.value) {
    // eslint-disable-next-line no-console
    console.log(`${entry.id}\t${entry.version ?? "-"}\t${entry.scope}\t${entry.kind}`);
  }
  reporter.complete("list", `${res.value.length} 个已安装包`);
  return 0;
}

async function runUpdate(
  argv: readonly string[],
  deps: RunSubcommandDeps,
  reporter: ProgressReporter,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: {} });
  } catch (err) {
    return usageError(reporter, "update", err instanceof Error ? err.message : String(err));
  }

  const [packageId] = parsed.positionals;
  const pluginInstaller = deps.pluginInstaller ?? createPluginInstaller();

  reporter.start("update", packageId ?? "全部可更新的包");
  const res = await pluginInstaller.update({ packageId });
  if (!res.ok) {
    reporter.fail("update", { code: res.error.code, message: res.error.message });
    return 1;
  }
  for (const outcome of res.value.outcomes) {
    if (outcome.status === "failed") {
      reporter.fail("update", { code: outcome.status, message: `${outcome.id}: ${outcome.reason ?? ""}` });
    } else {
      reporter.complete("update", `${outcome.id}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);
    }
  }
  return res.value.hasFailures ? 1 : 0;
}

/** 装配生产 `Installer`:依据 `CliContext` 得到 `sourcesRoot`/`agentDir`(注册表路径)。 */
function createDefaultInstaller(deps: RunSubcommandDeps): Installer {
  const ctx = createCliContext({ cwd: deps.cwd, env: deps.env });
  return createInstaller({
    env: deps.env,
    agentInstallerOptions: {
      sourcesRoot: ctx.sourcesRoot,
      registryPath: join(ctx.agentDir, "sources.json"),
    },
  });
}

/**
 * 子命令分发入口(design.md `SubcommandRouter` 的对侧,Req 1.7)。
 *
 * 各子命令的选项解析、依赖装配与错误 → 退出码映射均在此完成;成功恒返回 `0`,
 * 失败恒返回非零值(不抛异常,内部 `try/catch` 只包裹参数解析,业务错误均以判别联合
 * 承接并经 `ProgressReporter.fail()` 渲染)。`publish`(Wave 2)尚未接入分发,恒返回失败。
 */
export async function runSubcommand(
  name: string,
  argv: readonly string[],
  deps: RunSubcommandDeps = {},
): Promise<number> {
  const reporter = deps.reporter ?? createProgressReporter();
  switch (name as SubcommandName) {
    case "create":
      return runCreate(argv, deps, reporter);
    case "install":
      return runInstall(argv, deps, reporter);
    case "uninstall":
      return runUninstall(argv, deps, reporter);
    case "list":
      return runList(argv, deps, reporter);
    case "update":
      return runUpdate(argv, deps, reporter);
    case "publish":
      reporter.fail("publish", {
        code: "NOT_IMPLEMENTED",
        message: "publish 子命令尚未接入分发层(Wave 2,见任务 10.1)。",
      });
      return 1;
    default:
      reporter.fail("dispatch", { code: "UNKNOWN_SUBCOMMAND", message: `未知子命令: ${name}` });
      return 1;
  }
}
