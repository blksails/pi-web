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
 *
 * 4. **`--outdated`(Req 4.3)是一个已知设计缺口,不编造数据**——`pi list` 的输出不含
 *    「可用版本」字段;pi CLI(实测其 `docs/packages.md`)也**没有**任何 `outdated`/
 *    `--dry-run` 子命令能吐出「当前版本 vs 可用版本」的对照。`DefaultPackageManager` 上
 *    的 `checkForAvailableUpdates()` 不在 `PiCli` 接口上,`server/cli` 唯一的 IO 适配点是
 *    `PiCli`(`runPiCommand`/`listExtensions`),没有第二条通往「可用版本」的路。
 *    裁断:`listInstalled({ outdated: true })` 恒返回判别式错误 `OUTDATED_NOT_SUPPORTED`,
 *    不发起任何 `runPiCommand` 调用、不返回任何包数据——比伪造「当前=可用」的假数据更诚实。
 *    真正的实现需要额外接入一个能查询「最新可用版本」的数据源(如 npm registry 元数据),
 *    那是本任务边界(`PluginInstaller`)之外的新 IO 通道,留给后续任务。
 *
 * 5. **`update()` 逐包调用,不做单次 `pi update --extensions`(Req 4.4–4.7)**——
 *    `pi update --extensions` 是一次性更新全部包的单次子进程调用,拿不到「每个包是否成功」
 *    的粒度,无法满足 Req 4.7「某个包失败时继续处理其余包、结束时汇总失败项」。故 `update()`
 *    对每个目标包各发起一次独立的 `piCli.runPiCommand(["update", <id>], {})`,在本函数级别
 *    循环里用 `try` 语义(即不提前 return)逐个收集结果,保证一个包失败不影响其余包被处理。
 *    代价是变慢(N 次子进程),但换来了 Req 4.7 要求的可观察粒度。
 *
 * 6. **「固定/不可变」的判定:`kind` 为主,`npm` 额外用精确 semver 版本号判定**——
 *    经复核对 pi 真实源码(`@earendil-works/pi-coding-agent` dist/core/package-manager.js)
 *    逐行核实,更正了本条此前的错误论证(曾写「npm 无法区分是否钉死,两者在 `pi list`
 *    输出里长得一模一样」——不成立,详述如下):
 *      - `kind === "git"`:引用恒为固定 tag/commit,pi 自己从不将其推进到更新的 ref——
 *        跳过是对真实行为的如实反映,不是过度保守。
 *      - `kind === "local"`:指向磁盘上的文件/目录,从未经 pi 的包管理器拉取,「更新」
 *        对它没有意义——跳过。
 *      - `kind === "npm"`:pi 的 `parseSource()` 把 `pinned` 定义为
 *        `isExactNpmVersion(version)`(即 `semver.valid(version) !== null`),而
 *        `normalizePackageSourceForSettings()` 对非 `local` 的来源串原样保留、永不改写
 *        (`package-manager.js` 第 1110-1113 行)——用户在配置里写没写精确版本号,
 *        `pi list` 打印出的 source/version 就原样反映这一事实,并不存在「浮动安装恰好
 *        解析到某版本」与「显式钉死」在输出上「长得一模一样」的歧义。pi 更新时对
 *        `pinned` 的 npm 包直接过滤跳过(同文件第 926 行),而 `pi update <source>` 的
 *        CLI 层无论内部是否真的做了更新,都无条件打印 `Updated <source>` 并 exit 0
 *        (`package-manager-cli.js:602`)——这才是本文件**真正看不到**的部分:pi 的
 *        退出码/stdout 本身不足以证明「确实推进了版本」。故本文件对 `npm` 包自行判定:
 *        `version` 存在且是精确 semver(`isExactNpmVersion`,导出供后续任务复用)→
 *        判定为 pinned,直接标记 `"skipped"`(附真实原因),**不发起** `pi update` 调用,
 *        既避免了对一个已知会被 pi 静默跳过的包谎报 `"updated"`,也不依赖 pi 不可信的
 *        退出码语义。`version` 缺失或是浮动 range(如 `^1.0.0`)时才发起 `pi update`;
 *        见 `update()` 内联注释——这种情况下即便 `ok: true`,本文件也不断言「确实推进了
 *        版本」,只如实标记为 `"updated"`,并在其含义上保留这份不确定性(已通过前置的
 *        pinned 判定排除了「明知会被跳过」的情形)。
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
    | "NOT_INSTALLED"
    // `listInstalled({ outdated: true })` 的已知设计缺口,见文件头设计裁决 4。
    | "OUTDATED_NOT_SUPPORTED";
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

/** `listInstalled()` 的可选过滤(任务 5.1,见文件头设计裁决 4)。 */
export interface ListInstalledOptions {
  /**
   * 仅列出存在可用更新的包(Req 4.3)。当前 pi CLI 无法提供「可用版本」信息
   * ——恒返回 `OUTDATED_NOT_SUPPORTED`,不编造「当前版本=可用版本」之类的假数据。
   */
  readonly outdated?: boolean;
}

/** `update()` 的可选目标筛选(任务 5.2,Req 4.4, 4.5)。 */
export interface UpdatePluginOptions {
  /** 缺省更新全部可更新的包(Req 4.4);指定后只更新该包(Req 4.5,台账形态或带版本形态均可)。 */
  readonly packageId?: string;
}

/** 单个包的更新结果(Req 4.6 的跳过原因、Req 4.7 的失败原因均落在 `reason`)。 */
export type UpdatePackageStatus = "updated" | "skipped" | "failed";

export interface UpdatePackageOutcome {
  /** 台账形态的包标识(不含版本号),与 `listInstalled()` 的 `id` 一致。 */
  readonly id: string;
  readonly status: UpdatePackageStatus;
  /** `status` 为 `"skipped"`/`"failed"` 时携带真实原因;`"updated"` 时缺省。 */
  readonly reason?: string;
}

/**
 * `update()` 的汇总结果(Req 4.7)。`hasFailures` 是给调用方(未来的 `update` 子命令,
 * 任务 6.1)决定退出码的依据——外层 `Result.ok` 只表示「本次调用本身是否发生了基础设施级
 * 失败(如枚举台账都做不到)」,不代表「所有包都更新成功」,那由 `hasFailures` 表达。
 */
export interface UpdatePluginsResult {
  readonly outcomes: readonly UpdatePackageOutcome[];
  readonly hasFailures: boolean;
}

export interface PluginInstaller {
  install(
    source: ExtSource,
    options?: InstallPluginOptions,
  ): Promise<Result<InstallPluginResult, PluginInstallError>>;
  uninstall(sourceId: string): Promise<Result<UninstallPluginResult, PluginInstallError>>;
  listInstalled(
    options?: ListInstalledOptions,
  ): Promise<Result<readonly InstalledExtension[], PluginInstallError>>;
  update(
    options?: UpdatePluginOptions,
  ): Promise<Result<UpdatePluginsResult, PluginInstallError>>;
}

const PI_NOT_FOUND_MESSAGE =
  "pi CLI not found. Install it first: npm install -g @earendil-works/pi-coding-agent";

const OUTDATED_NOT_SUPPORTED_MESSAGE =
  "pi-web list --outdated is not supported: the pi CLI has no way to report an available " +
  "(latest) version for an installed package — `pi list` only reports the currently " +
  "installed version, and there is no `outdated`/`--dry-run` subcommand on pi's package " +
  "manager to compare against. Rather than fabricate an available version, this feature " +
  "reports the gap explicitly.";

/**
 * 判定一个字符串是否为 semver 意义下的**精确**版本号,与 pi 自身
 * `isExactNpmVersion` 的判定等价(`dist/core/package-manager.js`:
 * `semver.valid(version ?? "") !== null`)。不引入 `semver` 依赖,用一个纯正则
 * 复刻 `semver.valid()` 对完整 `<major>.<minor>.<patch>[-prerelease][+build]`
 * 形态的校验,并像 `semver.valid()` 一样接受可选的前导 `v`/`V`。
 *
 * 精确(true):`1.2.3`、`0.0.1`、`1.2.3-beta.1`、`1.2.3+build.5`、`1.2.3-rc.1+exp`、
 * `v1.2.3`(去掉前导 v 后合法)。
 * 非精确(false):`^1.0.0`、`~1.2`、`>=1.0.0`、`1.x`、`latest`、`1.2`(缺 patch)、
 * `v1`(缺 minor/patch)—— 任何range/通配符/不完整版本号。
 *
 * 导出以便 5.x 之后的任务(以及本文件内的 `update()`)复用同一条判定规则。
 */
export function isExactSemver(version: string): boolean {
  // semver.org 官方推荐的严格校验正则(去掉命名分组,保留结构)。
  // ★ major/minor/patch 必须是 `0|[1-9]\d*` —— 不可用泛化的 `\d+`,否则 `01.2.3`(前导零)
  //   会被误判为精确版本,而 `semver.valid("01.2.3")` 返回 null。
  const SEMVER_RE =
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
  // `semver.valid()` 只剥**小写** `v` 前缀(`V1.2.3` 返回 null),且**不** trim 两端空白
  // (`valid("  1.2.3  ")` 也返回 null)—— 已用真实 semver 包逐条交叉验证。
  const normalized = version.replace(/^v/, "");
  return SEMVER_RE.test(normalized);
}

/**
 * 判定一个台账条目是否被固定/不可变(Req 4.6,见文件头设计裁决 6)。返回真实的跳过原因;
 * `undefined` 表示可尝试更新。
 */
function pinnedSkipReason(entry: InstalledExtension): string | undefined {
  if (entry.kind === "git") {
    return (
      "git 来源固定到一个不可变引用(tag/commit);pi 从不会将其自动推进到更新的引用," +
      "如需更新请显式执行 pi install git:<host>/<path>@<new-ref>"
    );
  }
  if (entry.kind === "local") {
    return "本地路径来源未经 pi 包管理器拉取,不参与更新";
  }
  if (entry.kind === "npm" && entry.version !== undefined && isExactSemver(entry.version)) {
    return (
      `npm 包已钉死到精确版本 ${entry.version};pi 对已固定到精确 semver 的 npm 包会` +
      "在内部跳过更新(不会推进到更新的版本),如需升级请显式执行 " +
      `pi install npm:<name>@<new-version>`
    );
  }
  return undefined;
}

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

    async listInstalled(listOptions) {
      const cliResult = resolvePiCli(options);
      if (!cliResult.ok) return cliResult;
      if (listOptions?.outdated === true) {
        // 设计缺口(见文件头设计裁决 4):不发起任何 runPiCommand 调用、不返回任何包数据。
        return {
          ok: false,
          error: { code: "OUTDATED_NOT_SUPPORTED", message: OUTDATED_NOT_SUPPORTED_MESSAGE },
        };
      }
      return listInstalled(cliResult.value);
    },

    async update(updateOptions) {
      const cliResult = resolvePiCli(options);
      if (!cliResult.ok) return cliResult;
      const piCli = cliResult.value;

      const listed = await listInstalled(piCli);
      if (!listed.ok) return listed;

      let targets = listed.value;
      if (updateOptions?.packageId !== undefined) {
        const normalizedId = normalizeExtSourceId(updateOptions.packageId);
        const match = targets.find((entry) => entry.id === normalizedId);
        if (match === undefined) {
          return {
            ok: false,
            error: { code: "NOT_INSTALLED", message: `Not installed: ${normalizedId}` },
          };
        }
        targets = [match];
      }

      const outcomes: UpdatePackageOutcome[] = [];
      // 逐包调用(见文件头设计裁决 5):一个包失败不阻断其余包被处理(Req 4.7)。
      for (const entry of targets) {
        const skipReason = pinnedSkipReason(entry);
        if (skipReason !== undefined) {
          outcomes.push({ id: entry.id, status: "skipped", reason: skipReason });
          continue;
        }
        // 到这里,entry 要么没有可判定的版本号,要么版本号是浮动 range——两种情况下
        // pi 都可能真的推进了版本。但 `pi update <source>` 的 CLI 层无论内部是否真的
        // 做了更新,都无条件打印 `Updated <source>` 并 exit 0(见文件头设计裁决 6)——
        // 故 `ok: true` 只代表「pi 命令本身正常退出」,不是「确实推进了版本」的证明。
        // 这里选择保留 `"updated"` 这个 status 值(不新增 `"attempted"`),但不再对
        // npm 精确版本钉死的情形谎报——那部分已经在上面的 pinnedSkipReason 里提前
        // 拦截为 `"skipped"`;剩下这条分支里的不确定性,是「pi 退出码语义本就不区分
        // 空操作和真实更新」这一 pi 自身的已知局限,不是本文件可以从台账数据里进一步
        // 判定的东西。
        const res = await piCli.runPiCommand(["update", entry.id], {});
        if (res.ok) {
          outcomes.push({ id: entry.id, status: "updated" });
        } else {
          outcomes.push({
            id: entry.id,
            status: "failed",
            reason: redactSecrets(res.errorSummary ?? "pi update failed"),
          });
        }
      }

      const hasFailures = outcomes.some((outcome) => outcome.status === "failed");
      return { ok: true, value: { outcomes, hasFailures } };
    },
  };
}
