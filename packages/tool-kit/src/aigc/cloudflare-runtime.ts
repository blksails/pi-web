/**
 * Cloudflare 运行时凭据装配(release 桌面 / 无 .env.local)。
 *
 * 凭据以平台预置 env 为权威来源(CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AIG_GATEWAY_ID /
 * CLOUDFLARE_API_TOKEN);`<agentDir>/aigc.json` 读取仅兼容旧版设置面板落盘值
 * (env 优先;设置面板已移除这三项输入),每次启用/目录装配时 re-read。
 *
 * 纯函数 + 显式 fs 接缝,便于测试注入而不 bake。
 */
import fs from "node:fs";
import path from "node:path";
import {
  CLOUDFLARE_REQUIRED_ENV,
  isCloudflareConfigured,
  mergeCloudflareRuntimeEnv,
} from "./providers/cloudflare.js";
import { AIGC_TOOL_SETTINGS_FILE, resolveAgentDir } from "./model-config.js";

export type ReadFileSync = (file: string, encoding: "utf8") => string;

/**
 * 同步读 `<agentDir>/aigc.json` 为 plain object;缺失/坏 JSON → undefined(fail-soft)。
 */
export function readAigcConfigFile(
  agentDir: string,
  readFile: ReadFileSync = (f, enc) => fs.readFileSync(f, enc),
): Record<string, unknown> | undefined {
  const file = path.join(agentDir, AIGC_TOOL_SETTINGS_FILE);
  let raw: string;
  try {
    raw = readFile(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface ResolveCloudflareRuntimeEnvOptions {
  /** 进程 env 或测试 bag;缺省不读 global process(须显式传入以保持可测)。 */
  readonly env: Record<string, string | undefined>;
  /** agent 目录;缺省经 resolveAgentDir()(读 env 里的 PI_*_AGENT_DIR)。 */
  readonly agentDir?: string;
  /** 已解析的 aigc.json;传入则跳过磁盘读(测试/缓存)。 */
  readonly aigcConfig?: Record<string, unknown> | null;
  readonly readFile?: ReadFileSync;
}

/**
 * 解析当前可用的 Cloudflare env bag(每次调用可 re-read 磁盘)。
 * env 显式非空值优先于 aigc.json。
 */
export function resolveCloudflareRuntimeEnv(
  options: ResolveCloudflareRuntimeEnvOptions,
): Record<string, string | undefined> {
  const agentDir = options.agentDir ?? resolveAgentDir();
  const aigcConfig =
    options.aigcConfig !== undefined
      ? options.aigcConfig
      : readAigcConfigFile(agentDir, options.readFile);
  return mergeCloudflareRuntimeEnv(options.env, aigcConfig);
}

/** 便于 spawn:只抽出三项 CLOUDFLARE_* 非空键,供并入 runner env。 */
export function cloudflareSpawnEnvFragment(
  options: ResolveCloudflareRuntimeEnvOptions,
): Record<string, string> {
  const bag = resolveCloudflareRuntimeEnv(options);
  const out: Record<string, string> = {};
  for (const name of CLOUDFLARE_REQUIRED_ENV) {
    const v = (bag[name] ?? "").trim();
    if (v.length > 0) out[name] = v;
  }
  return out;
}

export function isCloudflareConfiguredAtRuntime(
  options: ResolveCloudflareRuntimeEnvOptions,
): boolean {
  return isCloudflareConfigured(resolveCloudflareRuntimeEnv(options));
}
