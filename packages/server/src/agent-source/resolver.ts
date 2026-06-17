/**
 * AgentSourceResolver — 公共入口(Req 4.5, 5.8, 7.3, 8.3, 9.3)。
 *
 * 管道:identify → (git ensure | plugin) → probe → decideMode → trustPolicy → applyTrust → assemble。
 * 任一阶段错误即早退,不产出 spawnSpec。严禁 spawn 子进程或载入/执行用户入口代码。
 * 错误信息中不含 env 敏感值(由各错误类型保证)。
 */
import path from "node:path";
import { assemble } from "./assemble-spawn.js";
import { probeEntry } from "./entry-probe.js";
import { ensureGitSource } from "./git-clone.js";
import { decideMode } from "./mode-decide.js";
import { identify } from "./source-type.js";
import { applyTrust } from "./trust-apply.js";
import { resolveTrustPolicy } from "./trust-policy.js";
import type { ResolveOptions, ResolvedSource } from "./types.js";

/** 解析后的本地工作目录 + 表示该来源的用于信任策略的 source 字符串。 */
interface LocalTarget {
  dir: string;
  /** 传给 trustPolicy 的来源标识(原始 source 或缺省 cwd)。 */
  policySource: string;
}

async function toLocalDir(
  source: string | undefined,
  opts: ResolveOptions,
): Promise<LocalTarget> {
  const identified = identify(source, opts);
  switch (identified.kind) {
    case "default": {
      const dir = opts.cwd ?? process.cwd();
      return { dir, policySource: dir };
    }
    case "dir":
      return { dir: identified.path, policySource: source ?? identified.path };
    case "git": {
      const dir = await ensureGitSource(identified.git, opts.gitCacheRoot);
      return { dir, policySource: source ?? identified.git.url };
    }
    case "plugin": {
      const { localDir } = await identified.plugin.resolve(identified.source, opts);
      const abs = path.isAbsolute(localDir)
        ? localDir
        : path.resolve(opts.cwd ?? process.cwd(), localDir);
      return { dir: abs, policySource: identified.source };
    }
  }
}

/**
 * 单次调用把 source 解析为 ResolvedSource。
 */
export async function resolve(
  source: string | undefined,
  opts: ResolveOptions = {},
): Promise<ResolvedSource> {
  const { dir, policySource } = await toLocalDir(source, opts);

  const entry = await probeEntry(dir);
  const mode = decideMode(entry);

  const trust = resolveTrustPolicy(opts)(policySource);
  const fragment = applyTrust(mode, trust);

  const spawnSpec =
    mode === "custom" && entry.kind === "entry"
      ? assemble({ mode: "custom", cwd: dir, entryPath: entry.path }, fragment, opts)
      : assemble({ mode: "cli", cwd: dir }, fragment, opts);

  return { mode, spawnSpec, cwd: spawnSpec.cwd, trust };
}

/** AgentSourceResolver 实例(稳定的单一对外入口)。 */
export const AgentSourceResolver = { resolve } as const;
