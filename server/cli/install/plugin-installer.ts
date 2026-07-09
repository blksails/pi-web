/**
 * PluginInstaller — plugin 通道的安装 / 卸载 / 列出(spec cli-package-commands,
 * 任务 4.3,Req 3.5, 3.7, 3.8, 3.9)。
 *
 * 只负责把 `kind: "plugin"` 的包交给 pi 自身的包管理落盘 —— 复用既有的参数装配
 * (`assembleInstallArgs`/`assembleRemoveArgs`,`@blksails/pi-web-server`,只读、不改)与
 * 唯一 IO 适配点 `PiCli`。不重新实现参数拼装或输出解析。
 *
 * ## 设计裁决
 *
 * 1. **`PiCli` 如何注入**——`{ piCli?: PiCli; piCliFactory?: () => PiCli }`。测试场景
 *    直接传入已构造好的替身(`piCli`);`piCliFactory` 是留给「默认走真实
 *    `ChildProcessPiCli`,但构造期可能因 pi 未安装而抛 `PiCliNotFoundError`」这条路径的
 *    可测试接缝 —— 测试无需 `vi.mock` 模块,只需传入一个会抛错的工厂函数即可复现
 *    「pi 未安装」分支。两者都缺省时,默认工厂是 `() => new ChildProcessPiCli()`。
 *
 * 2. **scope(user/project)如何传给 pi**——`install()` 接受可选的第二个参数
 *    `{ scope?: "user" | "project" }`(任务 4.5 补齐,消除 `installer.ts` 曾重新实现
 *    一遍 assemble+execute 的重复)。`assembleInstallArgs(source)`
 *    (`packages/server/src/extensions/install/install-args.ts`,只读、不改)产出的参数
 *    固定为 `["install", <source>, "--no-approve"]`,不接受、也不装配 `-l`(project 级)
 *    标志,是一个纯函数,不知道调用方的 scope 语境;本文件在拿到它的返回值后,
 *    在装配与执行之间对 `args` 做**纯函数后处理**(`scope === "project"` 时追加 `-l`),
 *    不修改 `assembleInstallArgs` 本身。`scope` 缺省或为 `"user"` 时行为与此前逐字节
 *    相同(4.3 既有测试的前提)。`uninstall()` 保持不接受 scope——`assembleRemoveArgs`
 *    同样没有 `-l` 钩子,不在本任务内臆造。
 *
 * 3. **卸载未安装的包如何判定(3.9)**——先 `piCli.runPiCommand(["list"], {})` +
 *    `parsePiList` 取当前台账,按 `id` 精确匹配。不依赖 `pi remove` 的退出码语义
 *    (pi 对「移除不存在的包」的退出码未在需求或既有代码注释中承诺,靠猜测退出码
 *    值会是脆弱契约);列表判定则完全复用既有解析器,行为可预测、可测试。
 *    若列出这一步本身失败(pi 子进程报错),映射为 `LIST_FAILED` 并中止,不盲目尝试
 *    `remove`(避免把「无法判定」误当作「允许移除」)。
 */
import {
  ChildProcessPiCli,
  PiCliNotFoundError,
  assembleInstallArgs,
  assembleRemoveArgs,
  parsePiList,
  type ExtSource,
  type InstalledExtension,
  type PiCli,
} from "@blksails/pi-web-server";
import { redactSecrets } from "../reporter.js";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 本组件可产出的判别式错误(不抛异常)。 */
export interface PluginInstallError {
  readonly code:
    | "PI_CLI_NOT_FOUND"
    | "PI_COMMAND_FAILED"
    | "LIST_FAILED"
    | "NOT_INSTALLED";
  readonly message: string;
}

export interface CreatePluginInstallerOptions {
  /** 已构造好的 `PiCli` 替身;测试注入。缺省时按需经 `piCliFactory` 构造。 */
  readonly piCli?: PiCli;
  /**
   * 缺省 `PiCli` 工厂,缺省值为 `() => new ChildProcessPiCli()`。测试可传入一个会抛
   * `PiCliNotFoundError` 的工厂以复现「pi 未安装」分支,无需 `vi.mock`。
   */
  readonly piCliFactory?: () => PiCli;
}

export interface InstallPluginResult {
  /**
   * 台账形态的包标识(即 `listInstalled()`/`parsePiList` 产出的 `id`,**不含版本号**)。
   * 与 `pi install` 实际接受的来源串(可能带版本,如 `npm:foo@1.2.3`)不是同一个字符串;
   * 若要把这个 `id` 传回 `uninstall()`,两种形态(带版本/不带版本)都可以,详见
   * `normalizeExtSourceId`。
   */
  readonly id: string;
  readonly stdout: string;
}

export interface UninstallPluginResult {
  /** 被移除的包标识,台账形态(不含版本号),与 `listInstalled()` 的 `id` 一致。 */
  readonly id: string;
  readonly stdout: string;
}

/**
 * 把一个来源标识规范化为台账形态的 `id`(剥离版本号)。
 *
 * 复刻 `packages/server/src/extensions/cli/pi-cli.ts` 中 `parseListLine` 对
 * `<id>@<version>` 的切分规则(只读该实现,不修改):按**最后一个 `@`** 切分,且要求
 * 该 `@` 不在字符串开头(`indexOf > 0`)才视为版本分隔符。这保证:
 *   - `npm:foo@1.2.3` → `npm:foo`(剥离版本)
 *   - `npm:@scope/pkg@1.2.3` → `npm:@scope/pkg`(scoped 包名里的 `@` 在开头之后但不是
 *     最后一个,真正的最后一个 `@` 才是版本分隔符)
 *   - `git:github.com/u/r@abc1234def` → `git:github.com/u/r`
 *   - `local:/abs/path`(无 `@`)→ 原样返回
 *   - 已经不含版本的 `npm:foo` → 原样返回(幂等)
 *
 * 导出以便 4.5 等后续任务复用同一条规则,避免规则漂移。
 */
export function normalizeExtSourceId(sourceId: string): string {
  const at = sourceId.lastIndexOf("@");
  if (at > 0) return sourceId.slice(0, at);
  return sourceId;
}

/** `install()` 的可选安装作用域(任务 4.5 补齐,见文件头设计裁决 2)。 */
export interface InstallPluginOptions {
  /** 缺省 `"user"`;显式 `"project"` 时对装配好的 pi 参数追加 `-l`。 */
  readonly scope?: "user" | "project";
}

export interface PluginInstaller {
  install(
    source: ExtSource,
    options?: InstallPluginOptions,
  ): Promise<Result<InstallPluginResult, PluginInstallError>>;
  uninstall(sourceId: string): Promise<Result<UninstallPluginResult, PluginInstallError>>;
  listInstalled(): Promise<Result<readonly InstalledExtension[], PluginInstallError>>;
}

const PI_NOT_FOUND_MESSAGE =
  "pi CLI not found. Install it first: npm install -g @earendil-works/pi-coding-agent";

function defaultPiCliFactory(): PiCli {
  return new ChildProcessPiCli();
}

/** 解析本次调用要用的 `PiCli`;构造失败(pi 未安装)时返回可操作错误,不抛异常。 */
function resolvePiCli(options: CreatePluginInstallerOptions): Result<PiCli, PluginInstallError> {
  if (options.piCli !== undefined) return { ok: true, value: options.piCli };
  const factory = options.piCliFactory ?? defaultPiCliFactory;
  try {
    return { ok: true, value: factory() };
  } catch (err) {
    if (err instanceof PiCliNotFoundError) {
      return { ok: false, error: { code: "PI_CLI_NOT_FOUND", message: PI_NOT_FOUND_MESSAGE } };
    }
    throw err;
  }
}

/** 列出 pi 台账中已安装的包(4.x 的最小前置能力;`--outdated` 等归 5.1/5.2)。 */
async function listInstalled(
  piCli: PiCli,
): Promise<Result<readonly InstalledExtension[], PluginInstallError>> {
  const res = await piCli.runPiCommand(["list"], {});
  if (!res.ok) {
    return {
      ok: false,
      error: {
        code: "LIST_FAILED",
        message: redactSecrets(res.errorSummary ?? "pi list failed"),
      },
    };
  }
  return { ok: true, value: parsePiList(res.stdout) };
}

/** 装配 `PluginInstaller`。构造本身不做任何 IO(`PiCli` 的解析延后到各方法调用时)。 */
export function createPluginInstaller(
  options: CreatePluginInstallerOptions = {},
): PluginInstaller {
  return {
    async install(source, installOptions) {
      const cliResult = resolvePiCli(options);
      if (!cliResult.ok) return cliResult;
      const piCli = cliResult.value;

      const assembled = assembleInstallArgs(source);
      // project 作用域:对装配好的参数做纯函数后处理追加 `-l`,不改 assembleInstallArgs。
      const args =
        installOptions?.scope === "project" ? [...assembled.args, "-l"] : assembled.args;
      const res = await piCli.runPiCommand(args, assembled.env);
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: "PI_COMMAND_FAILED",
            message: redactSecrets(res.errorSummary ?? "pi install failed"),
          },
        };
      }
      // args 形如 ["install", <source>, "--no-approve", ("-l")?];索引 1 是传给 pi 的
      // 来源串(可能带版本),规范化为台账形态(不含版本)后作为返回的 id,与
      // listInstalled()/parsePiList 的 id 语义对齐(见 normalizeExtSourceId)。
      const id = normalizeExtSourceId(args[1] ?? "");
      return { ok: true, value: { id, stdout: res.stdout } };
    },

    async uninstall(sourceId) {
      const cliResult = resolvePiCli(options);
      if (!cliResult.ok) return cliResult;
      const piCli = cliResult.value;

      // 入参可能是带版本的来源串(如 `install()` 返回值在规范化之前的历史形态,或用户
      // 手写的 `npm:foo@1.2.3`),也可能已经是台账形态;两种写法都规范化到同一个 id
      // 再比对,详见 normalizeExtSourceId。
      const normalizedId = normalizeExtSourceId(sourceId);

      const listed = await listInstalled(piCli);
      if (!listed.ok) return listed;
      const isInstalled = listed.value.some((entry) => entry.id === normalizedId);
      if (!isInstalled) {
        return {
          ok: false,
          error: { code: "NOT_INSTALLED", message: `Not installed: ${normalizedId}` },
        };
      }

      const { args, env } = assembleRemoveArgs(normalizedId);
      const res = await piCli.runPiCommand(args, env);
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: "PI_COMMAND_FAILED",
            message: redactSecrets(res.errorSummary ?? "pi remove failed"),
          },
        };
      }
      return { ok: true, value: { id: normalizedId, stdout: res.stdout } };
    },

    async listInstalled() {
      const cliResult = resolvePiCli(options);
      if (!cliResult.ok) return cliResult;
      return listInstalled(cliResult.value);
    },
  };
}
