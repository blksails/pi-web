/**
 * AgentInstaller — agent 通道的自建落盘(spec cli-package-commands,任务 4.4,
 * Req 3.6, 3.12)。
 *
 * ## 存在理由
 *
 * pi 自身的包管理(`DefaultPackageManager.getBaseDirForScope`)只落到 `cwd/.pi`
 * (project 作用域)或 `agentDir`(user 作用域,`~/.pi/agent`),没有第三种落点 ——
 * 它无法把一个包落到 `~/.pi-web/agents`(agent 源根)。`kind: "agent"` 的包必须能被
 * 本地实例的源列表发现,故本组件绕开 pi 的包管理,自行完成 git 浅克隆 / npm 发布产物
 * 解包 / 本地目录登记三条落盘路径。
 *
 * ## 设计裁决(任务报告 DECISIONS 有完整说明,此处摘要)
 *
 * 1. **子进程执行接缝** —— `CommandRunner`:`(command, args, options) => Promise<CommandResult>`。
 *    默认实现用 `node:child_process.spawn`,env 一律经 `buildChildEnv()`(`../context.js`)
 *    收窄为白名单 + `GIT_TERMINAL_PROMPT=0`/`CI=1`,不透传调用者完整环境。单测**始终**
 *    注入替身,绝不让默认实现被调用(即绝不真的 spawn `git`/`npm`/`tar`)。
 *
 * 2. **npm 来源如何取 tarball,且不执行任何包脚本(Req 3.12)** —— 用
 *    `npm view <spec> dist.tarball --json` 只读查询注册表元数据(不下载、不安装、不涉及
 *    任何包内代码),取得 tarball 直链后经注入的 `TarballDownloader`(默认 `fetch()`)
 *    做一次纯 HTTP GET,最后用系统 `tar -xzf ... --strip-components=1` 解包。
 *    全程**没有任何一步**调用 `npm install`/`npm pack`/`npm ci`/`npm run-script` 或任何会
 *    触发 `preinstall`/`install`/`postinstall`/`prepare`/`prepack` 生命周期脚本的命令 ——
 *    `npm view` 是纯元数据查询,`fetch` 是纯字节下载,`tar -xzf` 是纯归档解压,三者均不
 *    执行 tarball 内的任何 JS。单测对 `CommandRunner` 的记录做白名单断言
 *    (`npm` 的调用其 `args[0]` 只能是 `"view"`;`git` 的调用其 `args[0]` 只能属于
 *    `["init","remote","fetch","checkout"]`),任何偏离(如误写成 `npm install`)都会
 *    让该断言失败 —— 已用手工 mutation 验证过这条断言确实会抓到违规(见任务报告
 *    SCRIPT_SAFETY)。
 *
 * 3. **git 来源如何浅克隆到一个 pinned ref(sha 或 tag)** —— `git clone --depth 1
 *    --branch <ref>` 对 40/7-40 位十六进制 commit sha **不适用**(`--branch` 只接受服务端
 *    公开的 ref 名,多数 host 默认不公开任意 commit 作为可 clone 的 ref)。故改用通用于
 *    sha 与 tag 两种形态的四步序列:`git init` → `git remote add origin <url>` →
 *    `git fetch --depth 1 origin <ref>` → `git checkout FETCH_HEAD`。克隆完成后删除
 *    `.git` 目录,使落盘结果是一份不可变的文件快照(无法再 push/pull/切换分支),对齐
 *    需求措辞「浅克隆到不可变引用」。
 *
 * 4. **回滚(不留半成品目录)** —— 先在 `sourcesRoot` 下用 `fs.mkdtemp` 建一个隐藏的
 *    staging 目录(与最终目标同一文件系统,保证之后的 `rename` 是原子操作、不会跨设备
 *    失败),全部工作只写入 staging;任一步骤失败,`fs.rm(staging, { recursive: true,
 *    force: true })` 清理后返回判别式错误,**不会**在最终目标路径留下任何文件。只有
 *    全部步骤成功后才 `fs.rename(staging, finalDir)` 一步到位地"发布"。
 *    **目标目录已存在**(重复安装同一 git ref / npm 版本)时,视为幂等成功 ——
 *    落盘结果由 `rename` 是唯一入口保证「要么完整要么不存在」,故已存在的目标目录
 *    必然是此前一次完整安装的产物,直接短路返回 `created: false`,不重新拉取。
 *
 * 5. **本地路径来源** —— 委托 `LocalSourceRegistry.registerLocalSource()` 登记,
 *    **不拷贝目录、不在源根下创建任何条目**(9.2, 9.3 既有裁决)。
 *
 * ## 卸载(`uninstallAgentSource`,任务 4.5 缺口 1,Req 3.8)
 *
 * agent 通道的落盘有两种互斥形态,卸载必须覆盖两者,且不删除用户自己的源码目录:
 *
 * 1. **本地登记来源** —— 入参 `id` 若命中 `sources.json` 里的一条登记(按 realpath 比较,
 *    复用 4.1 的 `unregisterLocalSource`),只除名登记表条目,**绝不删除** `id` 指向的
 *    目录本身(那是用户的本地源码,不是本组件的落盘产物)。
 * 2. **源根下的目录**(git/npm 安装产物)—— 入参 `id` 视为 `sourcesRoot` 之下的目录名
 *    或绝对路径,校验其 realpath **确实**位于 `sourcesRoot` 的 realpath 之下后,整个
 *    目录递归删除。这条校验是必须的安全门:`id` 可能来自用户输入(CLI 参数),
 *    含 `../` 之类的相对路径穿越会让朴素的 `join(sourcesRoot, id)` 逃出源根,
 *    命中门控则拒绝(`PATH_ESCAPE`),不删除任何东西。
 *
 * 两种形态都不匹配(以及路径穿越判定命中)时返回 `NOT_INSTALLED` 判别错误,不抛异常;
 * 除名一个不存在的登记项同样是 `NOT_INSTALLED`,不静默成功。
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ExtSource } from "@blksails/pi-web-server";
import { buildChildEnv } from "../context.js";
import { redactSecrets } from "../reporter.js";
import { registerLocalSource, unregisterLocalSource, canonicalize } from "./local-source-registry.js";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 本组件可产出的判别式错误(不抛异常)。 */
export interface AgentInstallError {
  readonly code:
    | "GIT_CLONE_FAILED"
    | "NPM_VIEW_FAILED"
    | "NPM_TARBALL_MISSING"
    | "DOWNLOAD_FAILED"
    | "EXTRACT_FAILED"
    | "LOCAL_REGISTER_FAILED"
    | "STAGE_FAILED";
  readonly message: string;
}

export interface AgentInstallResult {
  /** 落盘方式:git 浅克隆 / npm 发布产物解包 / 本地路径登记。 */
  readonly method: "git" | "npm" | "local";
  /** 落盘绝对路径(`git`/`npm`),或已登记的本地目录 realpath(`local`)。 */
  readonly location: string;
  /** true = 本次新建/新登记;false = 已存在同一目标,幂等短路(未触碰任何内容)。 */
  readonly created: boolean;
}

/** 子进程执行结果。`ok` 为 `false` 时 `stderr` 已经过调用方按需脱敏前的原始内容。 */
export interface CommandResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunnerOptions {
  readonly cwd?: string;
}

/**
 * 子进程执行端口。默认实现见 {@link defaultCommandRunner};单测必须注入替身,
 * 绝不真的 spawn `git`/`npm`/`tar`。
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandRunnerOptions,
) => Promise<CommandResult>;

/** tarball 下载端口。默认实现用全局 `fetch()`;单测注入替身,绝不真的发起网络请求。 */
export type TarballDownloader = (url: string) => Promise<Buffer>;

export interface AgentInstallerOptions {
  /** agent 源根(写入目标目录),来自 `CliContext.sourcesRoot`。 */
  readonly sourcesRoot: string;
  /** 本地路径来源的登记表文件路径;`source.kind === "local"` 时必须提供。 */
  readonly registryPath?: string;
  readonly runCommand?: CommandRunner;
  readonly downloadTarball?: TarballDownloader;
}

/** 默认 `CommandRunner`:spawn 子进程,env 经 `buildChildEnv()` 收窄。 */
function defaultCommandRunner(
  command: string,
  args: readonly string[],
  options?: CommandRunnerOptions,
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args as string[], {
      cwd: options?.cwd,
      env: buildChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolvePromise({ ok: false, code: null, stdout, stderr: stderr || String(err) });
    });
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0, code, stdout, stderr });
    });
  });
}

/** 默认 `TarballDownloader`:一次纯 HTTP GET,不涉及任何包管理器。 */
async function defaultDownloadTarball(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 把任意字符串规整为安全的单段目录名(替换非 `[A-Za-z0-9._-]` 字符)。 */
function sanitizeDirName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function gitDirName(source: Extract<ExtSource, { kind: "git" }>): string {
  return sanitizeDirName(`git-${source.host}-${source.repoPath}-${source.ref}`);
}

function npmDirName(source: Extract<ExtSource, { kind: "npm" }>): string {
  const pkg = source.scope !== undefined ? `${source.scope}-${source.name}` : source.name;
  return sanitizeDirName(`npm-${pkg}-${source.version}`);
}

/** 建一个与 `sourcesRoot` 同一文件系统的 staging 目录,保证之后 rename 是原子操作。 */
async function makeStagingDir(sourcesRoot: string): Promise<string> {
  await fs.mkdir(sourcesRoot, { recursive: true });
  const name = `.staging-${randomBytes(8).toString("hex")}`;
  const stagingDir = join(sourcesRoot, name);
  await fs.mkdir(stagingDir, { recursive: true });
  return stagingDir;
}

async function cleanupStaging(stagingDir: string): Promise<void> {
  await fs.rm(stagingDir, { recursive: true, force: true });
}

function commandErrorMessage(prefix: string, res: CommandResult): string {
  const detail = res.stderr.trim().length > 0 ? res.stderr.trim() : res.stdout.trim();
  return redactSecrets(`${prefix}: ${detail.length > 0 ? detail : `exit code ${res.code}`}`);
}

async function installGit(
  source: Extract<ExtSource, { kind: "git" }>,
  options: AgentInstallerOptions,
): Promise<Result<AgentInstallResult, AgentInstallError>> {
  const finalDir = join(options.sourcesRoot, gitDirName(source));
  if (await pathExists(finalDir)) {
    return { ok: true, value: { method: "git", location: finalDir, created: false } };
  }

  const runCommand = options.runCommand ?? defaultCommandRunner;
  let stagingDir: string;
  try {
    stagingDir = await makeStagingDir(options.sourcesRoot);
  } catch (err) {
    return {
      ok: false,
      error: { code: "STAGE_FAILED", message: redactSecrets(String(err)) },
    };
  }

  try {
    const cloneUrl = `https://${source.host}/${source.repoPath}.git`;

    const initRes = await runCommand("git", ["init", stagingDir]);
    if (!initRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: { code: "GIT_CLONE_FAILED", message: commandErrorMessage("git init failed", initRes) },
      };
    }

    const remoteRes = await runCommand("git", ["remote", "add", "origin", cloneUrl], {
      cwd: stagingDir,
    });
    if (!remoteRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: {
          code: "GIT_CLONE_FAILED",
          message: commandErrorMessage("git remote add failed", remoteRes),
        },
      };
    }

    const fetchRes = await runCommand("git", ["fetch", "--depth", "1", "origin", source.ref], {
      cwd: stagingDir,
    });
    if (!fetchRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: { code: "GIT_CLONE_FAILED", message: commandErrorMessage("git fetch failed", fetchRes) },
      };
    }

    const checkoutRes = await runCommand("git", ["checkout", "FETCH_HEAD"], { cwd: stagingDir });
    if (!checkoutRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: {
          code: "GIT_CLONE_FAILED",
          message: commandErrorMessage("git checkout failed", checkoutRes),
        },
      };
    }

    // 移除 .git,使落盘结果是一份不可变文件快照(对齐「浅克隆到不可变引用」)。
    await fs.rm(join(stagingDir, ".git"), { recursive: true, force: true });
    await fs.rename(stagingDir, finalDir);
    return { ok: true, value: { method: "git", location: finalDir, created: true } };
  } catch (err) {
    await cleanupStaging(stagingDir);
    return { ok: false, error: { code: "GIT_CLONE_FAILED", message: redactSecrets(String(err)) } };
  }
}

async function installNpm(
  source: Extract<ExtSource, { kind: "npm" }>,
  options: AgentInstallerOptions,
): Promise<Result<AgentInstallResult, AgentInstallError>> {
  const finalDir = join(options.sourcesRoot, npmDirName(source));
  if (await pathExists(finalDir)) {
    return { ok: true, value: { method: "npm", location: finalDir, created: false } };
  }

  const runCommand = options.runCommand ?? defaultCommandRunner;
  const downloadTarball = options.downloadTarball ?? defaultDownloadTarball;

  let stagingDir: string;
  try {
    stagingDir = await makeStagingDir(options.sourcesRoot);
  } catch (err) {
    return {
      ok: false,
      error: { code: "STAGE_FAILED", message: redactSecrets(String(err)) },
    };
  }

  try {
    const pkgSpec =
      source.scope !== undefined
        ? `${source.scope}/${source.name}@${source.version}`
        : `${source.name}@${source.version}`;

    // 只读元数据查询,不下载、不安装、不执行任何包脚本(Req 3.12)。
    const viewRes = await runCommand("npm", ["view", pkgSpec, "dist.tarball", "--json"]);
    if (!viewRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: { code: "NPM_VIEW_FAILED", message: commandErrorMessage("npm view failed", viewRes) },
      };
    }

    let tarballUrl: string;
    try {
      const parsed: unknown = JSON.parse(viewRes.stdout);
      if (typeof parsed !== "string" || parsed.length === 0) {
        throw new Error("dist.tarball missing or not a string");
      }
      tarballUrl = parsed;
    } catch (err) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: { code: "NPM_TARBALL_MISSING", message: redactSecrets(String(err)) },
      };
    }

    let tarballBuffer: Buffer;
    try {
      // 纯 HTTP GET,不涉及任何包管理器或脚本执行。
      tarballBuffer = await downloadTarball(tarballUrl);
    } catch (err) {
      await cleanupStaging(stagingDir);
      return { ok: false, error: { code: "DOWNLOAD_FAILED", message: redactSecrets(String(err)) } };
    }

    const tarballPath = join(stagingDir, "package.tgz");
    await fs.writeFile(tarballPath, tarballBuffer);

    // 只解压归档,不执行包内任何脚本;npm tarball 顶层是 package/,故 strip-components=1。
    const extractRes = await runCommand("tar", [
      "-xzf",
      tarballPath,
      "-C",
      stagingDir,
      "--strip-components=1",
    ]);
    if (!extractRes.ok) {
      await cleanupStaging(stagingDir);
      return {
        ok: false,
        error: { code: "EXTRACT_FAILED", message: commandErrorMessage("tar extract failed", extractRes) },
      };
    }

    await fs.rm(tarballPath, { force: true });
    await fs.rename(stagingDir, finalDir);
    return { ok: true, value: { method: "npm", location: finalDir, created: true } };
  } catch (err) {
    await cleanupStaging(stagingDir);
    return { ok: false, error: { code: "EXTRACT_FAILED", message: redactSecrets(String(err)) } };
  }
}

async function installLocal(
  source: Extract<ExtSource, { kind: "local" }>,
  options: AgentInstallerOptions,
): Promise<Result<AgentInstallResult, AgentInstallError>> {
  if (options.registryPath === undefined) {
    return {
      ok: false,
      error: {
        code: "LOCAL_REGISTER_FAILED",
        message: "registryPath is required to install a local-path agent source",
      },
    };
  }

  const result = await registerLocalSource({
    registryPath: options.registryPath,
    target: source.path,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: "LOCAL_REGISTER_FAILED", message: redactSecrets(result.error.message) },
    };
  }

  return {
    ok: true,
    value: { method: "local", location: result.value.source, created: result.value.created },
  };
}

/**
 * 安装一个 `kind: "agent"` 的 `ExtSource`(Req 3.6, 3.12)。
 *
 * - `git` / `npm` 来源:落盘到 `options.sourcesRoot` 之下的新目录。
 * - `local` 来源:委托 `LocalSourceRegistry` 登记,不拷贝、源根下不新增目录。
 *
 * 不抛异常;全部失败路径以判别联合返回,错误信息经 `redactSecrets`。
 */
export async function installAgentSource(
  source: ExtSource,
  options: AgentInstallerOptions,
): Promise<Result<AgentInstallResult, AgentInstallError>> {
  switch (source.kind) {
    case "git":
      return installGit(source, options);
    case "npm":
      return installNpm(source, options);
    case "local":
      return installLocal(source, options);
  }
}

/** 本组件的卸载可产出的判别式错误(不抛异常)。 */
export interface AgentUninstallError {
  readonly code: "NOT_INSTALLED" | "PATH_ESCAPE" | "UNREGISTER_FAILED" | "REMOVE_FAILED" | "NOT_CONFIGURED";
  readonly message: string;
}

export interface AgentUninstallResult {
  /** 卸载方式:登记表除名 / 源根下目录整删。 */
  readonly method: "local" | "directory";
  /** 被移除的目标:`local` 是原登记的目录路径;`directory` 是被删除目录的 realpath。 */
  readonly location: string;
}

/** 尽力把一个字符串规整为 realpath;不存在/不可解析时返回 `undefined`。 */
async function tryRealpath(p: string): Promise<string | undefined> {
  try {
    return await fs.realpath(p);
  } catch {
    return undefined;
  }
}

/**
 * `id` 相对 `sourcesRoot` 的成员关系判定结果(只读,`uninstallAgentSource` 步骤 2 与
 * `isAgentSourceInstalled` 共享同一套路径逃逸防护,不重复实现)。
 */
type SourcesRootMembership =
  | { readonly kind: "not_found" }
  | { readonly kind: "escaped" }
  | { readonly kind: "member"; readonly realpath: string };

/**
 * 只读判定:`id`(相对 `sourcesRoot` 的目录名,或绝对路径)是否确实位于 `sourcesRoot`
 * 的 realpath 之下。不做任何文件系统写操作。★ 安全门与 `uninstallAgentSource` 步骤 2
 * 完全一致 —— `id` 可能来自用户输入(CLI 参数),含 `../` 之类的相对路径穿越必须被
 * 拒绝(`"escaped"`),不得让调用方误判为「已安装」。
 */
async function checkSourcesRootMembership(id: string, sourcesRoot: string): Promise<SourcesRootMembership> {
  const candidatePath = isAbsolute(id) ? id : join(sourcesRoot, id);
  const candidateReal = await tryRealpath(candidatePath);
  if (candidateReal === undefined) return { kind: "not_found" };

  const sourcesRootReal = (await tryRealpath(sourcesRoot)) ?? sourcesRoot;
  const rel = relative(sourcesRootReal, candidateReal);
  const isInsideSourcesRoot = rel.length > 0 && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  return isInsideSourcesRoot ? { kind: "member", realpath: candidateReal } : { kind: "escaped" };
}

/**
 * 只读判定:`id` 是否已登记在 `sources.json` 里的本地来源(与 `unregisterLocalSource`
 * 判据一致 —— 按 realpath 比较,该条目路径若已不存在则退化为原始字符串比较,复用
 * `local-source-registry.ts` 导出的 `canonicalize()`——但本函数**绝不写文件、绝不除名**,
 * 仅供 kind 探测使用)。坏 JSON / 登记表不存在时保守返回 `false`(不算命中,不抛异常)。
 *
 * ★ 复核 Finding 2(spec cli-package-commands):此前本函数手写了一份等价的
 * `tryRealpath(x) ?? x` 规范化逻辑,与 `local-source-registry.ts` 里 `canonicalize()`
 * 语义相同但物理分离,是会漂移的第二份副本;现直接 import 复用同一份实现。
 */
async function isRegisteredLocalSource(registryPath: string, id: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const sourcesRaw = (parsed as Record<string, unknown>)["sources"];
  if (!Array.isArray(sourcesRaw)) return false;

  const canonicalTarget = await canonicalize(id);
  for (const entry of sourcesRaw) {
    if (typeof entry !== "object" || entry === null) continue;
    const s = (entry as Record<string, unknown>)["source"];
    if (typeof s !== "string" || s.length === 0) continue;
    const existingCanonical = await canonicalize(s);
    if (existingCanonical === canonicalTarget) return true;
  }
  return false;
}

/** {@link isAgentSourceInstalled} 的只读探测结果。 */
export type AgentSourceProbe =
  | { readonly installed: true; readonly method: "local" | "directory" }
  | { readonly installed: false };

/**
 * 只读判定:`id` 是否是一个已安装的 agent 通道源(uninstall kind 探测用,spec
 * cli-package-commands 缺陷修复:`uninstall` 此前缺省一律走 plugin 通道,导致本地
 * agent 目录必定 `Not installed`)。
 *
 * 覆盖 `uninstallAgentSource` 认可的两种形态,但全程**不产生任何副作用**:
 *   1. 已登记在 `sources.json` 里的本地来源(`isRegisteredLocalSource`,不除名);
 *   2. `sourcesRoot` 之下的一个目录(`checkSourcesRootMembership`,复用同一套路径
 *      逃逸防护,不重写一遍)。
 *
 * ★ 之所以不能用 `uninstallAgentSource()` 本身来探测:它匹配上就会真的执行卸载
 * (除名登记表条目 / 递归删除目录),探测必须与执行分离。
 *
 * 两者皆不命中 → `{ installed: false }`(调用方据此判定应走 plugin 通道)。
 */
export async function isAgentSourceInstalled(
  id: string,
  options: AgentInstallerOptions,
): Promise<AgentSourceProbe> {
  if (options.registryPath !== undefined) {
    const registered = await isRegisteredLocalSource(options.registryPath, id);
    if (registered) return { installed: true, method: "local" };
  }

  const membership = await checkSourcesRootMembership(id, options.sourcesRoot);
  if (membership.kind === "member") return { installed: true, method: "directory" };
  return { installed: false };
}

/**
 * 卸载一个 `kind: "agent"` 的已安装包(Req 3.8)。
 *
 * 依次尝试:
 *   1. `id` 命中 `sources.json` 里的一条本地登记 → 除名登记表条目(不删除目标目录)。
 *   2. `id` 是 `sourcesRoot` 之下的一个目录(相对目录名或绝对路径均可)→ 校验其 realpath
 *      确实位于 `sourcesRoot` 的 realpath 之下后,整个递归删除。
 *   3. 两者都不匹配 → `NOT_INSTALLED`。
 *
 * 不抛异常;全部失败路径以判别联合返回,错误信息经 `redactSecrets`。
 */
export async function uninstallAgentSource(
  id: string,
  options: AgentInstallerOptions,
): Promise<Result<AgentUninstallResult, AgentUninstallError>> {
  // 1. 本地登记来源:先试着按登记表除名(不接触目标目录本身)。
  if (options.registryPath !== undefined) {
    const unregResult = await unregisterLocalSource({ registryPath: options.registryPath, target: id });
    if (!unregResult.ok) {
      return {
        ok: false,
        error: { code: "UNREGISTER_FAILED", message: redactSecrets(unregResult.error.message) },
      };
    }
    if (unregResult.value.removed) {
      return { ok: true, value: { method: "local", location: id } };
    }
  }

  // 2. 源根下的目录:候选路径是 id 本身(若为绝对路径)或 sourcesRoot 之下同名目录。
  // ★ 安全门(candidateReal 必须真的位于 sourcesRoot 的 realpath 之下,防止 id 含
  // `../` 之类导致删到源根之外)与只读探测 `isAgentSourceInstalled` 共用同一实现。
  const membership = await checkSourcesRootMembership(id, options.sourcesRoot);
  if (membership.kind === "not_found") {
    return { ok: false, error: { code: "NOT_INSTALLED", message: `Not installed: ${id}` } };
  }
  if (membership.kind === "escaped") {
    return {
      ok: false,
      error: {
        code: "PATH_ESCAPE",
        message: redactSecrets(`Refusing to remove a path outside sourcesRoot: ${id}`),
      },
    };
  }
  const candidateReal = membership.realpath;

  try {
    await fs.rm(candidateReal, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: { code: "REMOVE_FAILED", message: redactSecrets(String(err)) } };
  }
  return { ok: true, value: { method: "directory", location: candidateReal } };
}
