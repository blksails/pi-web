/**
 * 自动标题扩展的配置解析(纯逻辑,**不 import** pi SDK 运行时)。
 *
 * 由扩展壳在加载时调用,从子进程环境变量解析行为参数。所有取值均带默认值与非法值兜底:
 * 任何缺失或非法项都回退到默认且**不抛错**(Req 6.6),保证自动标题永不阻塞会话。
 *
 * 注意:总开关 `PI_WEB_AUTO_TITLE` 不在此解析 —— 它由服务端(pi-handler)权威门控「是否
 * 下发扩展入口」,关闭时扩展根本不注入,故扩展内只关心已注入后的细粒度行为参数。
 */

/** 触发模式:`once` 首轮总结一次;`refresh` 每轮更新。 */
export type AutoTitleMode = "once" | "refresh";

/** 生成策略:`llm` 模型总结(兜底 heuristic);`heuristic` 仅启发式。 */
export type AutoTitleStrategy = "llm" | "heuristic";

/** 解析后的自动标题配置。 */
export interface AutoTitleConfig {
  /** 触发模式,默认 `once`。 */
  mode: AutoTitleMode;
  /** 生成策略,默认 `llm`。 */
  strategy: AutoTitleStrategy;
  /** 总结所用模型 id;`undefined` 表示用会话当前模型(`ctx.model`)。 */
  model: string | undefined;
  /** 标题字数上限(正整数),默认 24。 */
  maxLen: number;
}

/** 默认配置(用户决策:默认开 + once;策略 llm 带启发式兜底)。 */
export const DEFAULT_AUTO_TITLE_CONFIG: AutoTitleConfig = {
  mode: "once",
  strategy: "llm",
  model: undefined,
  maxLen: 24,
};

function parseMode(raw: string | undefined): AutoTitleMode {
  return raw === "refresh" || raw === "once"
    ? raw
    : DEFAULT_AUTO_TITLE_CONFIG.mode;
}

function parseStrategy(raw: string | undefined): AutoTitleStrategy {
  return raw === "heuristic" || raw === "llm"
    ? raw
    : DEFAULT_AUTO_TITLE_CONFIG.strategy;
}

function parseMaxLen(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_AUTO_TITLE_CONFIG.maxLen;
  const n = Number.parseInt(raw, 10);
  // 非数字、非正、或 NaN 一律回退默认(Req 4.2 / 6.6)。
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AUTO_TITLE_CONFIG.maxLen;
}

function parseModel(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 从环境变量映射解析自动标题配置。纯函数:无副作用、不读全局 `process.env`(由调用方注入),
 * 任何非法/缺失项回退默认且不抛错。
 */
export function parseAutoTitleConfig(
  env: NodeJS.ProcessEnv,
): AutoTitleConfig {
  return {
    mode: parseMode(env.PI_WEB_AUTO_TITLE_MODE),
    strategy: parseStrategy(env.PI_WEB_AUTO_TITLE_STRATEGY),
    model: parseModel(env.PI_WEB_AUTO_TITLE_MODEL),
    maxLen: parseMaxLen(env.PI_WEB_AUTO_TITLE_MAX_LEN),
  };
}
