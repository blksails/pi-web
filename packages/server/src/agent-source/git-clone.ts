/**
 * git 源克隆/更新到缓存(Req 2.1–2.6, 6.1–6.3, 7.3)。
 *
 * - 非交互执行:强制 `GIT_TERMINAL_PROMPT=0` 与 ssh BatchMode。
 * - 缓存路径:`<root>/<host>/<repoPath>@<ref>`(默认 root = ~/.pi-web/agents/git)。
 * - 缓存命中复用;in-flight Map 去重并发;缺 `.git` 视为损坏并重建。
 * - 失败抛 GitResolveError(含 source、ref、原因摘要,不含 env 敏感值)。
 *
 * 本文件是唯一执行 git 的 IO 点(git-runner 角色合并于此),便于集成测试以本地 bare repo mock。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitResolveError } from "./errors.js";
import type { GitSource } from "./types.js";

/** 强制非交互的 git 执行 env(Req 2.3)。不透传调用方敏感 env。 */
export function nonInteractiveGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
    GCM_INTERACTIVE: "never",
  };
}

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 执行单条 git 命令(非交互)。 */
export function runGit(args: string[], cwd?: string): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: nonInteractiveGitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 默认缓存根。 */
export function defaultGitCacheRoot(): string {
  return path.join(os.homedir(), ".pi-web", "agents", "git");
}

/** 归一化路径片段,使其可安全用作文件夹名(替换非安全字符)。 */
function sanitizeSegment(seg: string): string {
  return seg.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "_";
}

/** 派生缓存目录(归一化 source@ref)。 */
export function deriveCachePath(src: GitSource, root: string): string {
  const host = sanitizeSegment(src.host);
  const repo = sanitizeSegment(src.repoPath.replace(/\.git$/, ""));
  const ref = sanitizeSegment(src.ref);
  return path.join(root, host, `${repo}@${ref}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 缓存目录是否为完整的 git 工作树(含 `.git`)。 */
async function isHealthyCache(dir: string): Promise<boolean> {
  return (await pathExists(dir)) && (await pathExists(path.join(dir, ".git")));
}

/** 进行中操作去重(按缓存路径)。 */
const inFlight = new Map<string, Promise<string>>();

/** 仅用于测试:重置 in-flight 表。 */
export function __resetInFlightForTest(): void {
  inFlight.clear();
}

async function cloneAndCheckout(src: GitSource, dir: string): Promise<void> {
  await fs.mkdir(path.dirname(dir), { recursive: true });
  // 先克隆(不检出),再固定到 pinned ref。
  const clone = await runGit(["clone", "--no-checkout", src.url, dir]);
  if (clone.code !== 0) {
    throw new GitResolveError(src.url, src.ref, summarize(clone.stderr || clone.stdout));
  }
  // 固定到 ref:支持分支/标签/commit;HEAD 表示远端默认分支。
  const target = src.ref === "HEAD" ? "HEAD" : src.ref;
  const checkout = await runGit(["checkout", "--force", target], dir);
  if (checkout.code !== 0) {
    throw new GitResolveError(src.url, src.ref, summarize(checkout.stderr || checkout.stdout));
  }
}

/** 剥离可能的敏感片段,产出简短原因。 */
function summarize(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "git command failed";
  return firstLine.slice(0, 200);
}

/**
 * 确保 git 源已在缓存中并固定到 ref,返回本地工作树目录。
 * 命中复用;损坏重建;并发去重。
 */
export function ensureGitSource(src: GitSource, root?: string): Promise<string> {
  const cacheRoot = root ?? defaultGitCacheRoot();
  const dir = deriveCachePath(src, cacheRoot);

  const existing = inFlight.get(dir);
  if (existing) return existing;

  const op = (async (): Promise<string> => {
    if (await isHealthyCache(dir)) {
      return dir; // 复用(Req 2.2 / 6.1)。
    }
    // 缺失或损坏 → 清理后重建(Req 6.3)。
    if (await pathExists(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    try {
      await cloneAndCheckout(src, dir);
    } catch (err) {
      // 失败时不留下半成品缓存。
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (err instanceof GitResolveError) throw err;
      throw new GitResolveError(src.url, src.ref, summarize(err instanceof Error ? err.message : String(err)));
    }
    return dir;
  })();

  inFlight.set(dir, op);
  return op.finally(() => {
    inFlight.delete(dir);
  });
}
