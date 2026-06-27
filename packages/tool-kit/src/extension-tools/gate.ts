/**
 * extension-tools/gate — 工具侧来源门控（spec extension-install-agent-tools, Req 4）。
 *
 * 扩展管理扩展在 **agent 子进程**内执行装包（经 `pi.exec`）。安装前必须做与原 host 命令
 * `/plugin` **一致语义**的来源白名单 + 版本固定校验，避免任意来源被装（多用户托管安全）。
 *
 * **为何自包含**：本扩展由 pi 在子进程经 jiti 按文件路径加载，应尽量少跨包运行时依赖（standalone
 * 打包才稳）。故此处**移植** server 侧 `source-allowlist.ts` 的纯逻辑（source of truth：
 * `packages/server/src/extensions/install/source-allowlist.ts`），并以单测对齐防漂移。
 *
 * 门控开关经 spawn env 由主进程下发（与 pi-handler 同名）：
 *   PI_WEB_EXT_ADMIN_ALLOW_ANY=1 → 放行安装/卸载（allowMutate；缺省关闭，全拒）
 *   PI_WEB_EXT_ALLOW_LOCAL=1     → 放行 `local:<path>` 源
 *   PI_WEB_EXT_ALLOW_NPM=1       → 放行任意 npm 包（仍强制精确版本）
 */

/** 解析后的来源判别联合（与 server ExtSource 同形，内联以自包含）。 */
export type ExtSource =
  | { readonly kind: "npm"; readonly scope?: string; readonly name: string; readonly version: string }
  | { readonly kind: "git"; readonly host: string; readonly repoPath: string; readonly ref: string }
  | { readonly kind: "local"; readonly path: string };

/** 白名单配置（与 server AllowlistConfig 同形）。 */
export interface AllowlistConfig {
  readonly npmScopes: readonly string[];
  readonly gitHosts: readonly string[];
  readonly allowLocal: boolean;
  readonly allowAnyNpm?: boolean;
}

export type AllowlistDecision =
  | { readonly allowed: true; readonly source: ExtSource; readonly canonical: string }
  | { readonly allowed: false; readonly reason: string };

/** 默认受控白名单（与 server DEFAULT_ALLOWLIST 一致）。 */
export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  npmScopes: ["@pi-web", "@earendil-works"],
  gitHosts: ["github.com"],
  allowLocal: false,
};

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PINNED_REF = /^(?:[0-9a-f]{40}|[0-9a-f]{7,40}|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

function splitAtVersion(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function parseNpm(spec: string): ExtSource | { error: string } {
  const { name, version } = splitAtVersion(spec);
  if (version === undefined || version.length === 0) {
    return { error: "npm source missing pinned version (@x.y.z required)" };
  }
  if (!EXACT_SEMVER.test(version)) {
    return { error: `npm source version "${version}" is not an exact semver (range/dist-tag rejected)` };
  }
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1) return { error: "invalid scoped npm package name" };
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    if (pkg.length === 0) return { error: "invalid scoped npm package name" };
    return { kind: "npm", scope, name: pkg, version };
  }
  if (name.length === 0) return { error: "invalid npm package name" };
  return { kind: "npm", name, version };
}

function parseGit(raw: string): ExtSource | { error: string } {
  const at = raw.lastIndexOf("@");
  if (at <= 0) return { error: "git source missing pinned ref (@<commit|tag> required)" };
  const locator = raw.slice(0, at);
  const ref = raw.slice(at + 1);
  if (ref.length === 0) return { error: "git source missing pinned ref (@<commit|tag> required)" };
  if (!PINNED_REF.test(ref)) {
    return { error: `git ref "${ref}" is not a pinned commit/tag (mutable branch rejected)` };
  }
  let body = locator.replace(/^git\+/, "");
  let host: string;
  let repoPath: string;
  const schemeMatch = body.match(/^[a-z]+:\/\/(.+)$/i);
  if (schemeMatch?.[1] !== undefined) {
    let rest = schemeMatch[1];
    const userAt = rest.indexOf("@");
    if (userAt >= 0) rest = rest.slice(userAt + 1);
    const slash = rest.indexOf("/");
    if (slash < 0) return { error: "git source missing repository path" };
    host = rest.slice(0, slash).replace(/:\d+$/, "");
    repoPath = rest.slice(slash + 1).replace(/\.git$/, "");
  } else if (body.startsWith("git:")) {
    const rest = body.slice("git:".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return { error: "git source missing repository path" };
    host = rest.slice(0, slash);
    repoPath = rest.slice(slash + 1).replace(/\.git$/, "");
  } else {
    const m = body.match(/^(?:[^@]+@)?([^:/]+):(.+)$/);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      host = m[1];
      repoPath = m[2].replace(/\.git$/, "");
    } else {
      return { error: "unrecognized git source locator" };
    }
  }
  if (host.length === 0 || repoPath.length === 0) {
    return { error: "git source missing host or repository path" };
  }
  return { kind: "git", host, repoPath, ref };
}

function isGitLike(source: string): boolean {
  return (
    source.startsWith("git:") ||
    source.startsWith("git+") ||
    source.startsWith("ssh://") ||
    /^https?:\/\//i.test(source) ||
    /^[^@\s]+@[^:]+:/.test(source)
  );
}

function canonicalize(source: ExtSource): string {
  switch (source.kind) {
    case "npm":
      return source.scope !== undefined
        ? `npm:${source.scope}/${source.name}@${source.version}`
        : `npm:${source.name}@${source.version}`;
    case "git":
      return `git:${source.host}/${source.repoPath}@${source.ref}`;
    case "local":
      return `local:${source.path}`;
  }
}

/** 校验来源是否通过白名单 + 版本固定（纯函数，与 server checkAllowlist 同语义）。 */
export function checkAllowlist(rawSource: string, cfg: AllowlistConfig): AllowlistDecision {
  const source = typeof rawSource === "string" ? rawSource.trim() : "";
  if (source.length === 0) return { allowed: false, reason: "empty source" };

  if (source.startsWith("local:")) {
    if (!cfg.allowLocal) return { allowed: false, reason: "local sources are not allowed" };
    const p = source.slice("local:".length);
    if (p.length === 0) return { allowed: false, reason: "local source missing path" };
    const parsed: ExtSource = { kind: "local", path: p };
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  if (source.startsWith("npm:")) {
    const parsed = parseNpm(source.slice("npm:".length));
    if ("error" in parsed) return { allowed: false, reason: parsed.error };
    if (cfg.allowAnyNpm === true) {
      return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
    }
    const scope = parsed.kind === "npm" ? parsed.scope : undefined;
    if (scope === undefined) return { allowed: false, reason: "unscoped npm packages are not allowlisted" };
    if (!cfg.npmScopes.includes(scope)) {
      return { allowed: false, reason: `npm scope "${scope}" is not in the allowlist` };
    }
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  if (isGitLike(source)) {
    const parsed = parseGit(source);
    if ("error" in parsed) return { allowed: false, reason: parsed.error };
    const host = parsed.kind === "git" ? parsed.host : "";
    if (!cfg.gitHosts.includes(host)) {
      return { allowed: false, reason: `git host "${host}" is not in the allowlist` };
    }
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  return {
    allowed: false,
    reason: "unrecognized source scheme (use npm:@scope/pkg@x.y.z, git:host/path@ref, or local:path)",
  };
}

/** 把规范化来源还原为传给 `pi install` 的来源标识（与 server assembleInstallArgs 的 sourceArg 一致）。 */
export function toInstallArg(source: ExtSource): string {
  switch (source.kind) {
    case "npm":
      return source.scope !== undefined
        ? `npm:${source.scope}/${source.name}@${source.version}`
        : `npm:${source.name}@${source.version}`;
    case "git":
      return `git:${source.host}/${source.repoPath}@${source.ref}`;
    case "local":
      return source.path;
  }
}

/** 门控 env 视图（便于测试注入）。 */
export interface GateEnv {
  readonly PI_WEB_EXT_ADMIN_ALLOW_ANY?: string;
  readonly PI_WEB_EXT_ALLOW_LOCAL?: string;
  readonly PI_WEB_EXT_ALLOW_NPM?: string;
}

export interface GateResult {
  /** 安装/卸载是否放行（admin/env 门控）。 */
  readonly allowMutate: boolean;
  /** 来源判定（仅安装用）。 */
  readonly decision: AllowlistDecision;
}

/** 据门控 env 组装 allowlist 并判定来源。`env` 缺省取 `process.env`。 */
export function gateInstall(source: string, env: GateEnv = process.env): GateResult {
  const allowMutate = env.PI_WEB_EXT_ADMIN_ALLOW_ANY === "1";
  const cfg: AllowlistConfig = {
    ...DEFAULT_ALLOWLIST,
    ...(env.PI_WEB_EXT_ALLOW_LOCAL === "1" ? { allowLocal: true } : {}),
    ...(env.PI_WEB_EXT_ALLOW_NPM === "1" ? { allowAnyNpm: true } : {}),
  };
  return { allowMutate, decision: checkAllowlist(source, cfg) };
}

/** 仅判定是否放行 mutate（卸载用，无来源校验）。 */
export function gateMutate(env: GateEnv = process.env): boolean {
  return env.PI_WEB_EXT_ADMIN_ALLOW_ANY === "1";
}
