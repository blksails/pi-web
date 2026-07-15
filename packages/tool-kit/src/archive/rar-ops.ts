/**
 * rar-ops — 解压 .rar；探测主机后端 unrar / unar / bsdtar。
 * 无后端 → RAR_BACKEND_UNAVAILABLE（不抛未捕获异常）。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  isInsideRoot,
  normalizeRoot,
  resolveUnderRoot,
  resolveZipEntry,
} from "./path-safety.js";
import type { ArchiveResult } from "./types.js";

export type RarBackend = "unrar" | "unar" | "bsdtar";

function which(cmd: string): string | undefined {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  if (r.status === 0) {
    const p = (r.stdout ?? "").trim();
    return p.length > 0 ? p : undefined;
  }
  return undefined;
}

/** 探测可用 rar 后端（有序）。 */
export function detectRarBackend(): RarBackend | undefined {
  if (which("unrar")) return "unrar";
  if (which("unar")) return "unar";
  if (which("bsdtar")) return "bsdtar";
  return undefined;
}

function listEntries(backend: RarBackend, archiveAbs: string): string[] | null {
  if (backend === "unrar") {
    const r = spawnSync("unrar", ["lb", archiveAbs], { encoding: "utf8" });
    if (r.status !== 0) return null;
    return (r.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  if (backend === "unar") {
    // unar 无稳定 list；返回 null 表示跳过预检
    return null;
  }
  // bsdtar
  const r = spawnSync("bsdtar", ["-tf", archiveAbs], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function runExtract(
  backend: RarBackend,
  archiveAbs: string,
  destAbs: string,
): { status: number | null; stderr: string } {
  if (backend === "unrar") {
    const r = spawnSync("unrar", ["x", "-o+", archiveAbs, destAbs + path.sep], {
      encoding: "utf8",
    });
    return { status: r.status, stderr: (r.stderr ?? "") + (r.stdout ?? "") };
  }
  if (backend === "unar") {
    const r = spawnSync("unar", ["-force-overwrite", "-o", destAbs, archiveAbs], {
      encoding: "utf8",
    });
    return { status: r.status, stderr: (r.stderr ?? "") + (r.stdout ?? "") };
  }
  const r = spawnSync("bsdtar", ["-xf", archiveAbs, "-C", destAbs], {
    encoding: "utf8",
  });
  return { status: r.status, stderr: (r.stderr ?? "") + (r.stdout ?? "") };
}

/**
 * 解压 rar 到 destination（相对 root）。
 */
export function extractRar(
  root: string,
  archive: string,
  destination: string,
): ArchiveResult<{ destination: string; backend: RarBackend; extractedHint?: number }> {
  const r = normalizeRoot(root);
  const archRes = resolveUnderRoot(r, archive);
  if (!archRes.ok) return archRes;
  const destRes = resolveUnderRoot(r, destination);
  if (!destRes.ok) return destRes;

  if (!existsSync(archRes.abs)) {
    return { ok: false, code: "NOT_FOUND", message: `Archive not found: ${archive}` };
  }

  const backend = detectRarBackend();
  if (!backend) {
    return {
      ok: false,
      code: "RAR_BACKEND_UNAVAILABLE",
      message:
        "No RAR backend found on host (tried: unrar, unar, bsdtar). Install one to enable unrar.",
    };
  }

  const entries = listEntries(backend, archRes.abs);
  if (entries) {
    for (const name of entries) {
      const clean = name.replace(/\/+$/, "");
      if (clean === "") continue;
      const check = resolveZipEntry(destRes.abs, clean);
      if (!check.ok) return check;
    }
  }

  mkdirSync(destRes.abs, { recursive: true });
  const run = runExtract(backend, archRes.abs, destRes.abs);
  if (run.status !== 0) {
    // bsdtar 对部分 rar 版本会失败 → 映射为 INVALID 或仍标后端不可用
    const msg = (run.stderr || "extract failed").trim().slice(0, 500);
    if (/Unrecognized archive|not supported|Failed to open|Unknown/i.test(msg)) {
      return {
        ok: false,
        code: "RAR_BACKEND_UNAVAILABLE",
        message: `Backend ${backend} could not extract this RAR: ${msg}`,
      };
    }
    return {
      ok: false,
      code: "IO_ERROR",
      message: `RAR extract failed (${backend}): ${msg}`,
    };
  }

  // 提取后扫描：任何写出 dest 外的路径视为失败（尽力）
  const walkCheck = (dir: string): ArchiveResult => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, name.name);
      if (!isInsideRoot(destRes.abs, abs) && !isInsideRoot(r, abs)) {
        return {
          ok: false,
          code: "PATH_ESCAPE",
          message: `Extract wrote outside root: ${abs}`,
        };
      }
      if (name.isDirectory()) {
        const nested = walkCheck(abs);
        if (!nested.ok) return nested;
      }
    }
    return { ok: true };
  };
  const post = walkCheck(destRes.abs);
  if (!post.ok) return post;

  return {
    ok: true,
    destination: path.relative(r, destRes.abs) || ".",
    backend,
  };
}

/**
 * 为测试构造最小「伪 rar」不可用时的行为由 extractRar 覆盖。
 * 可选：写占位 .rar 字节（非合法 rar）以触发后端失败路径。
 */
export function writePlaceholderRar(absPath: string): void {
  mkdirSync(path.dirname(absPath), { recursive: true });
  // RAR 签名 "Rar!" 但体非法 — 后端通常报错
  writeFileSync(absPath, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]));
}

/** 测试辅助：清理目录 */
export function rimraf(abs: string): void {
  rmSync(abs, { recursive: true, force: true });
}
