/**
 * extension-management — 来源白名单 + 版本固定校验(纯函数核心,Req 2.3/2.4/10.1/10.5)。
 *
 * 把原始 `source` 解析为 npm/git/local 判别联合,并校验:
 *  - 白名单:仅允许配置内的 npm scope 与 git host;任意裸 `http(s)://` URL、未列入白名单的
 *    scope/host → 拒绝(Req 2.3)。
 *  - 版本固定:npm 必须精确 `@x.y.z`(非 range/dist-tag);git 必须 pinned ref(commit/tag);
 *    未固定 → 拒绝(Req 2.4)。
 *
 * 无 IO、确定输出;拒绝携带可读原因(脱敏)供审计与错误响应复用。绝不"放行存疑源"。
 *
 * 支持的源语法:
 *   npm:@scope/pkg@1.2.3   |  npm:pkg@1.2.3
 *   git:host/user/repo@<ref>   |  https://host/user/repo@<ref>   |  git+ssh://...@<ref>
 *   local:<path>
 */
import type {
  AllowlistConfig,
  AllowlistDecision,
  ExtSource,
} from "../ext.types.js";

/** 默认受控白名单(部署方可经选项覆盖)。 */
export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  npmScopes: ["@pi-web", "@earendil-works"],
  gitHosts: ["github.com"],
  allowLocal: false,
};

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** git pinned ref:40-hex commit 或形如 vX.Y.Z 的 tag(拒绝裸分支名)。 */
const PINNED_REF = /^(?:[0-9a-f]{40}|[0-9a-f]{7,40}|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

/** 在最后一个 `@` 处切分(允许 scope 内的前导 `@`)。 */
function splitAtVersion(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  // scope 前导 `@`(位置 0)不算版本分隔。
  if (at <= 0) {
    return { name: spec };
  }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function parseNpm(spec: string): ExtSource | { error: string } {
  const { name, version } = splitAtVersion(spec);
  if (version === undefined || version.length === 0) {
    return { error: "npm source missing pinned version (@x.y.z required)" };
  }
  if (!EXACT_SEMVER.test(version)) {
    return {
      error: `npm source version "${version}" is not an exact semver (range/dist-tag rejected)`,
    };
  }
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1) {
      return { error: "invalid scoped npm package name" };
    }
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    if (pkg.length === 0) {
      return { error: "invalid scoped npm package name" };
    }
    return { kind: "npm", scope, name: pkg, version };
  }
  if (name.length === 0) {
    return { error: "invalid npm package name" };
  }
  return { kind: "npm", name, version };
}

function parseGit(raw: string): ExtSource | { error: string } {
  // 取出 @ref(在 path 末段;允许 host 后路径中的 `@`)。
  const at = raw.lastIndexOf("@");
  if (at <= 0) {
    return { error: "git source missing pinned ref (@<commit|tag> required)" };
  }
  const locator = raw.slice(0, at);
  const ref = raw.slice(at + 1);
  if (ref.length === 0) {
    return { error: "git source missing pinned ref (@<commit|tag> required)" };
  }
  if (!PINNED_REF.test(ref)) {
    return {
      error: `git ref "${ref}" is not a pinned commit/tag (mutable branch rejected)`,
    };
  }

  // 解析 host + repoPath,支持 git:host/u/r、https://host/u/r、git+ssh://git@host/u/r。
  let body = locator;
  body = body.replace(/^git\+/, "");
  let host: string;
  let repoPath: string;
  const schemeMatch = body.match(/^[a-z]+:\/\/(.+)$/i);
  if (schemeMatch?.[1] !== undefined) {
    let rest = schemeMatch[1];
    const userAt = rest.indexOf("@");
    if (userAt >= 0) rest = rest.slice(userAt + 1); // 去 user@
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
    // scp-like: git@host:user/repo
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
    /^[^@\s]+@[^:]+:/.test(source) // scp-like git@host:path
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

/**
 * 校验来源是否通过白名单 + 版本固定。纯函数。
 */
export function checkAllowlist(
  rawSource: string,
  cfg: AllowlistConfig,
): AllowlistDecision {
  const source = typeof rawSource === "string" ? rawSource.trim() : "";
  if (source.length === 0) {
    return { allowed: false, reason: "empty source" };
  }

  // local:
  if (source.startsWith("local:")) {
    if (!cfg.allowLocal) {
      return { allowed: false, reason: "local sources are not allowed" };
    }
    const p = source.slice("local:".length);
    if (p.length === 0) {
      return { allowed: false, reason: "local source missing path" };
    }
    const parsed: ExtSource = { kind: "local", path: p };
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  // npm:
  if (source.startsWith("npm:")) {
    const parsed = parseNpm(source.slice("npm:".length));
    if ("error" in parsed) return { allowed: false, reason: parsed.error };
    // allowAnyNpm:放宽 scope 白名单(含无 scope 包),仍保留版本固定——parseNpm 已强制
    // 精确 `@x.y.z`,故此处放行不削弱供应链防护。供 PI_WEB_EXT_ALLOW_NPM=1 单用户自托管开启。
    if (cfg.allowAnyNpm === true) {
      return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
    }
    const scope = parsed.kind === "npm" ? parsed.scope : undefined;
    if (scope === undefined) {
      return {
        allowed: false,
        reason: "unscoped npm packages are not allowlisted",
      };
    }
    if (!cfg.npmScopes.includes(scope)) {
      return {
        allowed: false,
        reason: `npm scope "${scope}" is not in the allowlist`,
      };
    }
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  // git-like(含任意 http(s):// URL)
  if (isGitLike(source)) {
    const parsed = parseGit(source);
    if ("error" in parsed) return { allowed: false, reason: parsed.error };
    const host = parsed.kind === "git" ? parsed.host : "";
    if (!cfg.gitHosts.includes(host)) {
      return {
        allowed: false,
        reason: `git host "${host}" is not in the allowlist`,
      };
    }
    return { allowed: true, source: parsed, canonical: canonicalize(parsed) };
  }

  return {
    allowed: false,
    reason:
      "unrecognized source scheme (use npm:@scope/pkg@x.y.z, git:host/path@ref, or local:path)",
  };
}
