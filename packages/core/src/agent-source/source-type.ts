/**
 * 源类型识别(Req 1.1–1.6, 6.4, 8.1)。
 *
 * 支持:
 *  - 本地目录:绝对路径(`/`)、相对路径(`./`、`../`)。
 *  - git:`git:host/user/repo@ref`、`https://host/...@ref`、`ssh://...@ref`。
 *  - sourceResolver 插件(在内置之外分发)。
 *  - source 缺省 → default(默认 cwd + 无入口/cli 路径)。
 */
import path from "node:path";
import { SourceKindError } from "./errors.js";
import type { GitSource, IdentifiedSource, ResolveOptions } from "./types.js";

const DEFAULT_REF = "HEAD";

/** 从形如 `<base>@<ref>` 的字符串拆出 base 与可选 ref(只在最后一段判断 @,避免误伤 ssh user@host)。 */
function splitRef(value: string): { base: string; ref: string | undefined } {
  // ref 不含 `/`,因此只在最后一个 path 段里找 `@`。
  const lastSlash = value.lastIndexOf("/");
  const tailStart = lastSlash + 1;
  const atInTail = value.indexOf("@", tailStart);
  if (atInTail === -1) return { base: value, ref: undefined };
  return { base: value.slice(0, atInTail), ref: value.slice(atInTail + 1) };
}

function isLocalDir(source: string): boolean {
  return (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source === "." ||
    source === ".." ||
    // Windows 本地路径:盘符绝对(C:\ 或 C:/)、UNC(\\server\share)、反斜杠相对(.\ ..\)。
    // 否则 CLI 在 Windows 上绝对化后的 source(如 D:\a\examples\hello-agent)会落空 →
    // SourceKindError → 建会话 500。
    /^[A-Za-z]:[\\/]/.test(source) ||
    source.startsWith("\\\\") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\")
  );
}

/** 解析 `git:host/user/repo@ref` 形态。 */
function parseGitScheme(source: string): GitSource {
  const body = source.slice("git:".length);
  const { base, ref } = splitRef(body);
  const firstSlash = base.indexOf("/");
  const host = firstSlash === -1 ? base : base.slice(0, firstSlash);
  const repoPath = firstSlash === -1 ? "" : base.slice(firstSlash + 1);
  // git: 简写规范化为 https clone URL。
  const url = `https://${host}/${repoPath}.git`;
  return {
    url,
    ref: ref ?? DEFAULT_REF,
    host,
    repoPath,
    refIsDefault: ref === undefined,
  };
}

/** 解析 `https://...@ref` 或 `ssh://...@ref` 形态。 */
function parseGitUrl(source: string): GitSource {
  const { base, ref } = splitRef(source);
  let host = "unknown";
  let repoPath = "";
  try {
    const u = new URL(base);
    host = u.hostname || "unknown";
    repoPath = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
  } catch {
    // URL 解析失败时退化到字符串切片(仍可派生缓存键)。
    repoPath = base;
  }
  return {
    url: base,
    ref: ref ?? DEFAULT_REF,
    host,
    repoPath,
    refIsDefault: ref === undefined,
  };
}

function isGitUrl(source: string): boolean {
  return (
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://")
  );
}

/**
 * 识别 source。
 * @param source 原始 source 字符串(undefined → default 路径)。
 * @param opts 解析选项(用于 sourceResolver 插件与相对路径基准 cwd)。
 */
export function identify(
  source: string | undefined,
  opts: ResolveOptions = {},
): IdentifiedSource {
  if (source === undefined || source === "") {
    return { kind: "default" };
  }

  // 插件优先于内置分发(Req 8.1)。
  if (opts.sourceResolver && opts.sourceResolver.canHandle(source)) {
    return { kind: "plugin", plugin: opts.sourceResolver, source };
  }

  // 保留 `builtin:<name>` 前缀 → 随包发布的内置 agent(custom 模式,入口在包内、cwd 用用户目录)。
  if (source.startsWith("builtin:")) {
    const name = source.slice("builtin:".length);
    return { kind: "builtin", name: name.length > 0 ? name : "default-agent" };
  }

  if (source.startsWith("git:")) {
    return { kind: "git", git: parseGitScheme(source) };
  }

  if (isGitUrl(source)) {
    return { kind: "git", git: parseGitUrl(source) };
  }

  if (isLocalDir(source)) {
    const base = opts.cwd ?? process.cwd();
    const abs = path.isAbsolute(source) ? source : path.resolve(base, source);
    return { kind: "dir", path: abs };
  }

  throw new SourceKindError(source);
}
