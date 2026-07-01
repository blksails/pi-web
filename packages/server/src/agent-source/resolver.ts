/**
 * AgentSourceResolver — 公共入口(Req 4.5, 5.8, 7.3, 8.3, 9.3)。
 *
 * 管道:identify → (git ensure | plugin) → probe → decideMode → trustPolicy → applyTrust → assemble。
 * 任一阶段错误即早退,不产出 spawnSpec。严禁 spawn 子进程或载入/执行用户入口代码。
 * 错误信息中不含 env 敏感值(由各错误类型保证)。
 */
import path from "node:path";
import { createLogger } from "@blksails/pi-web-logger";
import { assemble } from "./assemble-spawn.js";
import { probeEntry } from "./entry-probe.js";
import { ensureGitSource } from "./git-clone.js";
import { decideMode } from "./mode-decide.js";
import { identify } from "./source-type.js";
import { applyTrust } from "./trust-apply.js";
import { resolveTrustPolicy } from "./trust-policy.js";
import { AgentSourceError } from "./errors.js";
import {
  BUILTIN_DEFAULT_AGENT_SOURCE,
  defaultAgentEntryPath,
} from "../builtin-agents/entry-path.js";
import type { ResolveOptions, ResolvedSource } from "./types.js";

// 命名空间 agent:resolve —— 源解析/模式判定/信任生命周期(server 侧,落 stderr,默认关)。
const resolveLog = createLogger({ namespace: "agent:resolve" });

/**
 * 内置 agent 解析(`builtin:<name>`):入口文件随包发布(defaultAgentEntryPath),
 * **cwd 用用户工作目录**(opts.cwd,非入口所在的包内目录)→ 走 custom 模式,runner 期特性
 * (auto-title 等)全生效。目前仅支持 `default-agent`;入口解析不到 → 抛错(上层可回退)。
 */
function resolveBuiltin(
  name: string,
  policySource: string,
  opts: ResolveOptions,
): ResolvedSource {
  if (name !== "default-agent") {
    resolveLog.error("resolve failed", { code: "UNKNOWN_BUILTIN_AGENT", source: policySource });
    throw new AgentSourceError("UNKNOWN_BUILTIN_AGENT", `Unknown built-in agent: ${name}`);
  }
  const entryPath = defaultAgentEntryPath();
  if (entryPath === undefined) {
    resolveLog.error("resolve failed", { code: "BUILTIN_AGENT_NOT_FOUND", source: policySource });
    throw new AgentSourceError(
      "BUILTIN_AGENT_NOT_FOUND",
      "Built-in default agent entry could not be located.",
    );
  }
  const cwd = opts.cwd ?? process.cwd();
  const trust = resolveTrustPolicy(opts)({
    dir: cwd,
    source: policySource,
    requestTrust: opts.requestTrust,
  });
  const fragment = applyTrust("custom", trust);
  const spawnSpec = assemble({ mode: "custom", cwd, entryPath }, fragment, opts);
  return { mode: "custom", spawnSpec, cwd: spawnSpec.cwd, trust };
}

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
    case "builtin":
      // 不可达:resolve() 在调用 toLocalDir 前已拦截 builtin(其入口在包内、不映射本地目录)。
      resolveLog.error("resolve failed", { code: "UNKNOWN_BUILTIN_AGENT", source });
      throw new AgentSourceError("UNKNOWN_BUILTIN_AGENT", `Built-in source must be resolved earlier: ${identified.name}`);
  }
}

/**
 * 单次调用把 source 解析为 ResolvedSource。
 */
export async function resolve(
  source: string | undefined,
  opts: ResolveOptions = {},
): Promise<ResolvedSource> {
  resolveLog.info("resolve start", { source });

  // 内置 agent(`builtin:<name>`)走独立路径:入口在包内、cwd 用用户目录,直接 custom 模式。
  const identified = identify(source, opts);
  if (identified.kind === "builtin") {
    const builtin = resolveBuiltin(identified.name, source ?? BUILTIN_DEFAULT_AGENT_SOURCE, opts);
    resolveLog.info("resolve done", {
      name: identified.name,
      mode: builtin.mode,
      localDir: builtin.cwd,
    });
    return builtin;
  }

  const { dir, policySource } = await toLocalDir(source, opts);

  const entry = await probeEntry(dir);
  const mode = decideMode(entry);

  const trust = resolveTrustPolicy(opts)({
    dir,
    source: policySource,
    requestTrust: opts.requestTrust,
  });
  const fragment = applyTrust(mode, trust);

  const spawnSpec =
    mode === "custom" && entry.kind === "entry"
      ? assemble({ mode: "custom", cwd: dir, entryPath: entry.path }, fragment, opts)
      : assemble({ mode: "cli", cwd: dir }, fragment, opts);

  resolveLog.info("resolve done", { name: policySource, mode, localDir: dir });
  return { mode, spawnSpec, cwd: spawnSpec.cwd, trust };
}

/** AgentSourceResolver 实例(稳定的单一对外入口)。 */
export const AgentSourceResolver = { resolve } as const;
