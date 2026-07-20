/**
 * model-config — AIGC 图像工具的「模型开关」持久设置解析与纯过滤(aigc-tool-settings)。
 *
 * 关模型走**装配期读取的持久配置**:aigcExtension 在工具注册前调 `resolveAigcToolSettings()`
 * 同步读 config 域 `aigc` 的落盘文件 `<agentDir>/aigc.json`(形态
 * `{ disabledModels: string[], enablePromptOptimization: boolean }`,由 /settings 经 `/api/config/aigc`
 * 读写),得到被禁模型集合 + 提示词优化开关;再用 `filterRoutes()` 过滤
 * `IMAGE_GENERATION_ROUTES` / `IMAGE_EDIT_ROUTES`,使被禁模型同时从 LLM 可见枚举与下发清单移除。
 *
 * fail-soft:文件缺失 / 坏 JSON / 字段非法 → 视为「无模型被禁」(空集),装配继续(Req 1.5/1.6)。
 * 纯函数 `filterRoutes` 无副作用:全禁时保留默认模型对应 route(Req 2.5),不重排、不改
 * label/provider(Req 2.6),未知模型 id 自然忽略(Req 1.6)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImageRoute } from "./types.js";

/** 解析所得的 AIGC 工具设置。 */
export interface AigcToolSettings {
  /** 被禁用的模型稳定 id 集合(以 `model` 为键,不依赖 label)。 */
  readonly disabledModels: ReadonlySet<string>;
  /** 是否开启提示词优化(装配期 publish 到会话状态供 run-image-tool 读取)。 */
  readonly enablePromptOptimization: boolean;
}

/**
 * 持久设置文件名 = config 域 `aigc` 的落盘文件 `<agentDir>/aigc.json`。
 * ⚠ 与 protocol config 域 `aigc` + server DOMAIN_SCHEMAS 契约一致:/settings 经 `/api/config/aigc`
 * 读写同文件,形态 `{ disabledModels: string[], enablePromptOptimization: boolean }`。
 */
export const AIGC_TOOL_SETTINGS_FILE = "aigc.json";

/** 图像工具注册选项:装配期被禁模型集合(缺省 = 空集,全量)。 */
export interface RegisterImageToolOptions {
  readonly disabledModels?: ReadonlySet<string>;
  /**
   * 装配期按 env 条件并入的额外路由组(ai-gateway-providers spec,design.md §3,Req 5.2/5.3):
   * 例如 `AI_GATEWAY_IMAGE_ROUTES`,由 runtime 层 `extension.ts` 按
   * `process.env.BLKSAILS_GATEWAY_BASE_URL` 存在与否决定是否传入——未启用套件时缺省
   * `undefined`,与今天行为逐字节一致。与内置静态 `ROUTES` 拼接后统一走
   * `filterRoutes`(Req 5.4:disabledModels 对两套 provider 的路由统一生效,不区分来源)。
   */
  readonly extraRoutes?: readonly ImageRoute[];
}

/** 空被禁集合(缺省参数复用,避免每次新建)。 */
export const EMPTY_DISABLED: ReadonlySet<string> = new Set<string>();

/**
 * 解析 agent 目录:`PI_WEB_AGENT_DIR`(pi-web 覆盖)> `PI_CODING_AGENT_DIR`(pi 原生)>
 * `~/.pi/agent`。与 server / runner 侧一致(memory:agentDir env 是 PI_CODING_AGENT_DIR)。
 */
export function resolveAgentDir(): string {
  const override = process.env.PI_WEB_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR;
  if (typeof override === "string" && override !== "") return override;
  return path.join(os.homedir(), ".pi", "agent");
}

const EMPTY_SETTINGS: AigcToolSettings = {
  disabledModels: new Set(),
  enablePromptOptimization: false,
};

/** 从原始 JSON 提取设置(坏结构 / 非法项 → 安全默认)。 */
function parseSettings(parsed: unknown): AigcToolSettings {
  if (typeof parsed !== "object" || parsed === null) return EMPTY_SETTINGS;
  const obj = parsed as { disabledModels?: unknown; enablePromptOptimization?: unknown };
  const disabled = new Set<string>();
  if (Array.isArray(obj.disabledModels)) {
    for (const m of obj.disabledModels) {
      if (typeof m === "string" && m !== "") disabled.add(m);
    }
  }
  return {
    disabledModels: disabled,
    enablePromptOptimization: obj.enablePromptOptimization === true,
  };
}

/**
 * 装配期同步读取持久设置(config 域 aigc 的 `<agentDir>/aigc.json`)。任何读取 / 解析失败均
 * 降级为安全默认(空禁用集 + 优化关),不抛。`agentDir` 缺省经 {@link resolveAgentDir} 解析。
 */
export function resolveAigcToolSettings(agentDir?: string): AigcToolSettings {
  const dir = agentDir ?? resolveAgentDir();
  const file = path.join(dir, AIGC_TOOL_SETTINGS_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return EMPTY_SETTINGS; // 缺失 / 不可读 → 安全默认
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SETTINGS; // 坏 JSON → 安全默认(不使装配失败)
  }
  return parseSettings(parsed);
}

/**
 * 按被禁集合过滤路由。纯函数,不改动入参:
 *  - 剔除 `disabled` 命中的 route;
 *  - 若过滤后为空且输入非空,则保留默认模型对应 route(Req 2.5:全禁保留默认,工具仍可执行);
 *  - 不重排、不改 label/provider(Req 2.6);未知模型 id 因不命中任何 route 自然忽略(Req 1.6)。
 */
export function filterRoutes<R extends { model: string }>(
  routes: readonly R[],
  disabled: ReadonlySet<string>,
  defaultModel: string,
): readonly R[] {
  if (disabled.size === 0) return routes;
  const active = routes.filter((r) => !disabled.has(r.model));
  if (active.length > 0) return active;
  // 全部被禁:保留默认模型对应 route;默认也不在列表则退回首项,保证非空。
  const fallback = routes.find((r) => r.model === defaultModel) ?? routes[0];
  return fallback !== undefined ? [fallback] : routes;
}
