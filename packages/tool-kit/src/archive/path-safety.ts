/**
 * path-safety — 会话 root 内路径解析与 zip-slip 判定（纯函数 + fs realpath 可选）。
 */
import path from "node:path";
import { realpathSync } from "node:fs";

export type PathResolveOk = { readonly ok: true; readonly abs: string };
export type PathResolveErr = {
  readonly ok: false;
  readonly code: "PATH_ESCAPE";
  readonly message: string;
};
export type PathResolveResult = PathResolveOk | PathResolveErr;

/** 规范化 root 为绝对路径（不做 realpath，避免 root 尚不存在时失败）。 */
export function normalizeRoot(root: string): string {
  return path.resolve(root);
}

/**
 * 判定 abs 是否位于 root 内（含 root 自身）。
 * 使用 path.relative：以 `..` 开头或为绝对路径则逃逸。
 */
export function isInsideRoot(root: string, abs: string): boolean {
  const r = normalizeRoot(root);
  const a = path.resolve(abs);
  if (a === r) return true;
  const rel = path.relative(r, a);
  if (rel === "") return true;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

/**
 * 把用户路径解析到 root 下；逃逸 → PATH_ESCAPE。
 * `userPath` 空串视为 root 自身。
 */
export function resolveUnderRoot(root: string, userPath: string): PathResolveResult {
  const r = normalizeRoot(root);
  const raw = userPath.trim() === "" ? "." : userPath;
  // 禁止显式绝对路径落在 root 外；resolve 后统一检。
  const abs = path.resolve(r, raw);
  if (!isInsideRoot(r, abs)) {
    return {
      ok: false,
      code: "PATH_ESCAPE",
      message: `Path escapes session root: ${userPath}`,
    };
  }
  return { ok: true, abs };
}

/**
 * 将 ZIP entry 名解析到 extractRoot 下。拒绝绝对路径、盘符、空名、以及 `..` 逃逸。
 * entry 使用 posix 分隔符。
 */
export function resolveZipEntry(
  extractRoot: string,
  entryName: string,
): PathResolveResult {
  const name = entryName.replace(/\\/g, "/");
  if (name === "" || name === ".") {
    return {
      ok: false,
      code: "PATH_ESCAPE",
      message: `Invalid empty archive entry name`,
    };
  }
  // 绝对路径 / UNC / Windows 盘符
  if (
    name.startsWith("/") ||
    name.startsWith("//") ||
    /^[A-Za-z]:/.test(name)
  ) {
    return {
      ok: false,
      code: "PATH_ESCAPE",
      message: `Archive entry is absolute: ${entryName}`,
    };
  }
  const parts = name.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    return {
      ok: false,
      code: "PATH_ESCAPE",
      message: `Archive entry escapes extract root: ${entryName}`,
    };
  }
  return resolveUnderRoot(extractRoot, parts.join(path.sep));
}

/**
 * 可选：realpath 后再检（目标已存在时防 symlink 逃逸）。
 * 目标不存在则回退到 resolveUnderRoot 结果。
 */
export function resolveUnderRootReal(
  root: string,
  userPath: string,
): PathResolveResult {
  const base = resolveUnderRoot(root, userPath);
  if (!base.ok) return base;
  try {
    const realRoot = realpathSync(normalizeRoot(root));
    let realAbs: string;
    try {
      realAbs = realpathSync(base.abs);
    } catch {
      // 尚不存在：检查父目录 realpath
      return base;
    }
    if (!isInsideRoot(realRoot, realAbs)) {
      return {
        ok: false,
        code: "PATH_ESCAPE",
        message: `Path escapes session root after realpath: ${userPath}`,
      };
    }
    return { ok: true, abs: realAbs };
  } catch {
    return base;
  }
}
