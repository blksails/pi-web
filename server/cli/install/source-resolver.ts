/**
 * SourceResolver — 来源形态判别与直连来源校验(spec cli-package-commands,任务 4.2,
 * Req 3.4, 8.1, 8.2)。
 *
 * 本任务只实现「直接来源」分支。判别为「注册表包标识」的实参目前返回明确的
 * `REGISTRY_NOT_IMPLEMENTED` 占位错误(design.md 的 `via: "registry"` 分支依赖
 * `RegistryPort`/`@pi-clouds/*`,归任务 9.1、Wave 2,阻塞于跨仓;本文件**不** import
 * 任何 `@pi-clouds/*` 包)。
 *
 * ## 判别规则(Req 8.1)
 *
 * 依次判定,命中任一条即为「直接来源」,否则为「注册表包标识」:
 *   1. 显式来源类型前缀 —— `npm:`、`git:`、`local:`(大小写不敏感)。
 *   2. URI 协议头 —— `scheme://...`(如 `https://`、`ssh://`)。
 *   3. scp 简写形态 —— `user@host:path`(如 `git@github.com:org/repo`)。
 *   4. 文件系统路径形态 —— 以 `./`、`../`、`/`、`~` 开头,或形如 `C:\`/`C:/` 的
 *      Windows 盘符路径。
 *   5. host 简写形态 —— 首个 `/` 之前的片段含 `.`(形似域名,如 `github.com/u/r`),
 *      用于把 `github.com/u/r`(直连 git 简写)与 `org/name`(注册表包标识)区分开
 *      —— 二者都含 `/`,但只有前者的首段像域名。
 *
 * 其余(如 `org/name`、`org/name@stable`、`bare-name`)判别为注册表包标识。
 *
 * ⚠️ 本文件当前只在 JSDoc 中说明判别规则;把该说明投影进子命令 `--help` 输出文本
 * 归后续接线任务(6.1 / 9.1 的 `InstallCommand`),不在本任务边界内。
 *
 * ## 直连来源校验(Req 3.4)
 *
 * 直接来源一律先规范化为 `checkAllowlist()`(既有纯函数,`@blksails/pi-web-server`)
 * 能识别的字符串形态,再交给它做白名单 + 版本/引用固定校验:
 *   - 已带 `npm:`/`git:`/`local:` 前缀、URI 协议头、或 scp 简写的实参原样传入
 *     (`checkAllowlist` 本就能解析这些形态)。
 *   - 文件系统路径形态的实参先展开 `~`、相对路径相对 `cwd` 绝对化,再包一层
 *     `local:<绝对路径>` 前缀传入(`checkAllowlist` 只认带前缀的 `local:` 语法)。
 *   - host 简写形态(命中规则 5 但未带前缀)原样传入 —— `checkAllowlist` 目前不识别
 *     无前缀的 git host 简写,会以「unrecognized source scheme」拒绝。这是已知的
 *     覆盖缺口,在 DESIGN_GAP 中如实记录,不在本任务内扩大 `checkAllowlist` 的解析面
 *     (那是只读、不属于本任务边界的既有纯函数)。
 *   - 白名单拒绝 → 返回 `{ code: "ALLOWLIST_REJECTED", reason }`,不抛异常,不发生
 *     任何下载或子进程调用。
 *
 * ## CLI 场景的本地路径信任模型(裁决)
 *
 * `DEFAULT_ALLOWLIST`(`@blksails/pi-web-server`)的 `allowLocal: false` 是 Web 多用户面
 * 的默认值(避免任意会话让服务端读本地任意路径)。但需求 9 要求 `pi-web install <本地目录>`
 * 必须能登记本地 agent 源 —— CLI 场景是单用户本地进程,调用者本就等价于本机管理员
 * (与 design.md「本地 CLI 用户本就是 admin」的既有裁决一致,pi-cli.ts 的 admin 策略绕过同理)。
 * 故本文件为 CLI 场景定义 `CLI_ALLOWLIST = { ...DEFAULT_ALLOWLIST, allowLocal: true }`,
 * 作为 `resolveSource()` 的默认配置(调用方仍可显式传入其它 `AllowlistConfig` 覆盖)。
 * 这不放宽 npm scope / git host 白名单,也不放宽版本固定 —— 只放开本地路径这一项,
 * 且仅对经由本文件规范化的 CLI 直连路径生效。
 *
 * ## `kind` 的确定(DESIGN_GAP)
 *
 * design.md 的 `ResolvedSource`(`via: "direct"`)要求携带 `kind: PluginKind`,但
 * npm/git 来源在**下载前**无从得知其 `kind`(需要读包内 `pi-web.json`/`package.json`,
 * 这些内容只在拉取后才存在)。这是 design 的一个缺口 —— 本任务的裁断是:
 *   - **本地路径来源**:目标目录若含 `pi-web.json` 且能解析出 `kind` 字段,采用该值;
 *     否则(无清单、清单缺 `kind`、清单非法 JSON)默认 `"agent"`
 *     (`LocalSourceRegistry`/`AgentInstaller` 面向的正是本地 agent 开发场景,见任务 4.1)。
 *   - **npm/git 来源**:`kind` 暂以 `"agent"` 占位,真实值须在下载解包后由
 *     `AgentInstaller`/`PluginInstaller` 重新判定并覆盖 —— 本文件**不**读取任何远端
 *     内容,该占位值不应被调用方当作最终依据。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute as posixIsAbsolute, join, resolve as resolvePath } from "node:path";
import {
  checkAllowlist,
  DEFAULT_ALLOWLIST,
  type AllowlistConfig,
  type ExtSource,
} from "@blksails/pi-web-server";
import {
  PI_WEB_MANIFEST_FILENAME,
  PiWebManifestSchema,
  type PluginKind,
} from "@blksails/pi-web-protocol";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 实参形态判别结果(Req 8.1)。 */
export type SourceForm = "direct" | "registry";

export type ResolvedSource =
  | { readonly via: "direct"; readonly source: ExtSource; readonly kind: PluginKind }
  | { readonly via: "registry"; readonly spec: string };

export type ResolveError =
  | { readonly code: "ALLOWLIST_REJECTED"; readonly reason: string }
  /** 注册表分支尚未接入(归任务 9.1);不代表来源本身被拒绝。 */
  | { readonly code: "REGISTRY_NOT_IMPLEMENTED"; readonly spec: string };

export interface ResolveSourceOptions {
  /** 白名单配置,缺省用 CLI 场景的 `CLI_ALLOWLIST`(见上方裁决)。 */
  readonly allowlistConfig?: AllowlistConfig;
  /** 相对路径解析基准目录,缺省 `process.cwd()`(测试注入以避免依赖真实 cwd)。 */
  readonly cwd?: string;
  /** `~` 展开的 home 目录,缺省 `os.homedir()`(测试注入)。 */
  readonly homeDir?: string;
}

/** CLI 场景的白名单配置:在既有 `DEFAULT_ALLOWLIST` 基础上放开本地路径(见上方裁决)。 */
export const CLI_ALLOWLIST: AllowlistConfig = {
  ...DEFAULT_ALLOWLIST,
  allowLocal: true,
};

const PREFIXED = /^(npm|git|local):/i;
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** scp 简写:`user@host:path`(host 段不含 `/`,与 URI scheme 的 `://` 区分开)。 */
const SCP_LIKE = /^[^@\s/]+@[^:\s/]+:.+/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

function isFilesystemPathForm(spec: string): boolean {
  return (
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/") ||
    spec.startsWith("~") ||
    WINDOWS_DRIVE.test(spec)
  );
}

/** 首段(第一个 `/` 之前)是否形似域名(含 `.`)——区分 `github.com/u/r` 与 `org/name`。 */
function hasHostLikeFirstSegment(spec: string): boolean {
  const slash = spec.indexOf("/");
  if (slash <= 0) return false;
  const firstSegment = spec.slice(0, slash);
  return firstSegment.includes(".");
}

/**
 * 判别实参形态(Req 8.1)。纯函数,不做任何 IO。
 */
export function classifySourceForm(spec: string): SourceForm {
  const s = spec.trim();
  if (s.length === 0) return "registry";
  if (PREFIXED.test(s)) return "direct";
  if (URI_SCHEME.test(s)) return "direct";
  if (SCP_LIKE.test(s)) return "direct";
  if (isFilesystemPathForm(s)) return "direct";
  if (hasHostLikeFirstSegment(s)) return "direct";
  return "registry";
}

function expandHome(spec: string, homeDir: string): string {
  if (spec === "~") return homeDir;
  if (spec.startsWith("~/") || spec.startsWith("~\\")) {
    return join(homeDir, spec.slice(2));
  }
  return spec;
}

function isAbsolutePathForm(p: string): boolean {
  return WINDOWS_DRIVE.test(p) || posixIsAbsolute(p);
}

/**
 * 把「文件系统路径形态」的直连实参规范化为 `checkAllowlist()` 能识别的
 * `local:<绝对路径>` 语法;其余直连形态原样传入(`checkAllowlist` 已能解析)。
 */
function normalizeDirectSource(spec: string, cwd: string, homeDir: string): string {
  const s = spec.trim();
  if (PREFIXED.test(s) || URI_SCHEME.test(s) || SCP_LIKE.test(s)) {
    return s;
  }
  if (isFilesystemPathForm(s)) {
    const expanded = expandHome(s, homeDir);
    const abs = isAbsolutePathForm(expanded) ? expanded : resolvePath(cwd, expanded);
    return `local:${abs}`;
  }
  // host 简写形态(如 github.com/u/r,无前缀):原样传入,已知会被
  // checkAllowlist 判「unrecognized source scheme」拒绝(见文件头 DESIGN_GAP 说明)。
  return s;
}

/** 本地路径来源的 `kind` 判定(见文件头「`kind` 的确定」)。不存在/非法清单时默认 `"agent"`。 */
async function resolveLocalKind(absPath: string): Promise<PluginKind> {
  try {
    const raw = await readFile(join(absPath, PI_WEB_MANIFEST_FILENAME), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = PiWebManifestSchema.safeParse(parsed);
    if (result.success) return result.data.kind;
    return "agent";
  } catch {
    return "agent";
  }
}

/**
 * 判别实参形态并(对直接来源)完成白名单校验(Req 3.4, 8.1, 8.2)。
 *
 * 不抛异常;白名单拒绝或注册表分支未接入均以判别联合返回。**不发生任何网络请求**——
 * 本文件不 import 任何 HTTP 客户端,注册表分支直接短路返回占位错误。
 */
export async function resolveSource(
  spec: string,
  options: ResolveSourceOptions = {},
): Promise<Result<ResolvedSource, ResolveError>> {
  const form = classifySourceForm(spec);
  if (form === "registry") {
    return { ok: false, error: { code: "REGISTRY_NOT_IMPLEMENTED", spec } };
  }

  const cfg = options.allowlistConfig ?? CLI_ALLOWLIST;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const normalized = normalizeDirectSource(spec, cwd, homeDir);

  const decision = checkAllowlist(normalized, cfg);
  if (!decision.allowed) {
    return { ok: false, error: { code: "ALLOWLIST_REJECTED", reason: decision.reason } };
  }

  const kind: PluginKind =
    decision.source.kind === "local" ? await resolveLocalKind(decision.source.path) : "agent";

  return { ok: true, value: { via: "direct", source: decision.source, kind } };
}
