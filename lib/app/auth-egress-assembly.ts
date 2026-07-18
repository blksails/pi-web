/**
 * desktop-cloud-login · 云端登录 egress 装配(design.md §Components/auth-egress-assembly,
 * Req 3.1/3.5/4.2/7.3)。
 *
 * 纯函数,装配处(pi-handler)调用:
 *  - `resolveCloudLoginConfig(env)`:启用门控 + egress 配置解析。判别项 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE`
 *    未设 → `undefined`(功能整体关闭,无登录入口,行为与今日一致,Req 4.2)。设置但非法(URL/JSON/
 *    超时)→ 抛 `CloudLoginConfigError`(fail-fast,含字段名,Req 7.3)。
 *  - `computeAuthEgressSpawnEnv(config, credential)`:仅在**已启用 + 有有效凭据**时,产出注入 runner
 *    的 env(凭据 + egress base + 模型清单)。runner 侧据这些 env 注入内存 ModelRegistry(见
 *    egress-model-source)。未登录/未启用 → 空对象(runner 走本地默认,Req 4.1)。
 *
 * runner 侧读取的 env 键(跨进程契约,Revalidation Trigger):
 *  - `PI_WEB_DESKTOP_CREDENTIAL` — 桌面凭据明文(作 egress Bearer)
 *  - `PI_WEB_CLOUD_EGRESS_BASE`  — egress OpenAI 兼容根
 *  - `PI_WEB_CLOUD_EGRESS_MODELS`— egress 模型清单(JSON)
 */
import type { EgressModel } from "@blksails/pi-web-server";

/** 服务端配置 env(启用判别 = base)。 */
export const CLOUD_LOGIN_EGRESS_BASE_ENV = "PI_WEB_CLOUD_LOGIN_EGRESS_BASE";
/** egress 模型清单 env(JSON 数组:字符串 id 或 `{id,name,...}` 对象)。 */
export const CLOUD_LOGIN_MODELS_ENV = "PI_WEB_CLOUD_LOGIN_MODELS";
/** 请求超时覆盖 env(毫秒)。 */
export const CLOUD_LOGIN_TIMEOUT_MS_ENV = "PI_WEB_CLOUD_LOGIN_TIMEOUT_MS";

/** runner 侧读取的凭据 env。 */
export const RUNNER_CREDENTIAL_ENV = "PI_WEB_DESKTOP_CREDENTIAL";
/** runner 侧读取的 egress base env。 */
export const RUNNER_EGRESS_BASE_ENV = "PI_WEB_CLOUD_EGRESS_BASE";
/** runner 侧读取的 egress 模型清单 env(JSON)。 */
export const RUNNER_EGRESS_MODELS_ENV = "PI_WEB_CLOUD_EGRESS_MODELS";

/**
 * 请求超时下限(毫秒):不短于云端网关首字(30s)/空闲(60s)上限,避免长响应被本地提前
 * 中断(Req 3.5)。默认取 90s。
 */
export const CLOUD_LOGIN_MIN_TIMEOUT_MS = 90_000;

/** 解析后的云端登录 egress 配置。 */
export interface CloudLoginConfig {
  /** egress OpenAI 兼容根(去尾斜杠)。 */
  readonly egressBaseUrl: string;
  /** egress 暴露的模型清单。 */
  readonly models: ReadonlyArray<EgressModel>;
  /** 请求超时毫秒(≥ {@link CLOUD_LOGIN_MIN_TIMEOUT_MS})。 */
  readonly timeoutMs: number;
}

/** 装配期配置不合法时抛出(fail-fast,Req 7.3)。 */
export class CloudLoginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudLoginConfigError";
  }
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseModels(raw: string | undefined): ReadonlyArray<EgressModel> {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new CloudLoginConfigError(
      `${CLOUD_LOGIN_MODELS_ENV} 不是合法 JSON:"${raw}"。应为模型清单数组(字符串 id 或 {id,name,...} 对象)。`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new CloudLoginConfigError(
      `${CLOUD_LOGIN_MODELS_ENV} 必须是 JSON 数组,实际:"${raw}"。`,
    );
  }
  const models: EgressModel[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (entry.trim().length === 0) continue;
      models.push({ id: entry.trim() });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const id = obj.id;
      if (typeof id !== "string" || id.trim().length === 0) {
        throw new CloudLoginConfigError(
          `${CLOUD_LOGIN_MODELS_ENV} 数组项缺少合法字符串 id:${JSON.stringify(entry)}。`,
        );
      }
      const model: EgressModel = { id: id.trim() };
      if (typeof obj.name === "string") (model as { name?: string }).name = obj.name;
      if (typeof obj.contextWindow === "number")
        (model as { contextWindow?: number }).contextWindow = obj.contextWindow;
      if (typeof obj.maxTokens === "number")
        (model as { maxTokens?: number }).maxTokens = obj.maxTokens;
      if (typeof obj.reasoning === "boolean")
        (model as { reasoning?: boolean }).reasoning = obj.reasoning;
      if (Array.isArray(obj.input)) {
        const input = obj.input.filter(
          (x): x is "text" | "image" => x === "text" || x === "image",
        );
        if (input.length > 0) (model as { input?: ("text" | "image")[] }).input = input;
      }
      models.push(model);
      continue;
    }
    throw new CloudLoginConfigError(
      `${CLOUD_LOGIN_MODELS_ENV} 数组项类型非法:${JSON.stringify(entry)}。`,
    );
  }
  return models;
}

/**
 * 启用门控 + egress 配置解析。
 *
 * @param env 环境变量来源(装配处传 `process.env`;测试可注入)。
 * @returns 未启用(base 未设)→ `undefined`;启用且合法 → 配置;启用但非法 → 抛 `CloudLoginConfigError`。
 */
export function resolveCloudLoginConfig(
  env: NodeJS.ProcessEnv,
): CloudLoginConfig | undefined {
  const rawBase = env[CLOUD_LOGIN_EGRESS_BASE_ENV]?.trim();
  if (rawBase === undefined || rawBase.length === 0) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new CloudLoginConfigError(
      `${CLOUD_LOGIN_EGRESS_BASE_ENV} 不是合法 URL:"${rawBase}"。请改正,或移除该变量以关闭云端登录。`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CloudLoginConfigError(
      `${CLOUD_LOGIN_EGRESS_BASE_ENV} 必须是 http/https 地址,实际协议 "${parsed.protocol}"。`,
    );
  }

  const models = parseModels(env[CLOUD_LOGIN_MODELS_ENV]);

  let timeoutMs = CLOUD_LOGIN_MIN_TIMEOUT_MS;
  const rawTimeout = env[CLOUD_LOGIN_TIMEOUT_MS_ENV]?.trim();
  if (rawTimeout !== undefined && rawTimeout.length > 0) {
    const n = Number(rawTimeout);
    if (!Number.isInteger(n) || n <= 0) {
      throw new CloudLoginConfigError(
        `${CLOUD_LOGIN_TIMEOUT_MS_ENV} 必须是正整数(毫秒),实际:"${rawTimeout}"。`,
      );
    }
    // 采用不短于下限的超时,避免长响应被本地提前中断(Req 3.5)。
    timeoutMs = Math.max(n, CLOUD_LOGIN_MIN_TIMEOUT_MS);
  }

  return { egressBaseUrl: stripTrailingSlashes(rawBase), models, timeoutMs };
}

/**
 * 计算注入 runner 的 egress env(仅登录态)。
 *
 * @param config 已解析配置;`undefined`(未启用)→ 空对象。
 * @param credential 当前有效凭据明文;`undefined`(未登录/已过期)→ 空对象。
 * @returns 登录且启用 → runner-facing env 三件套;否则 `{}`(runner 走本地默认)。
 */
export function computeAuthEgressSpawnEnv(
  config: CloudLoginConfig | undefined,
  credential: string | undefined,
): Record<string, string> {
  if (config === undefined) return {};
  if (credential === undefined || credential.trim().length === 0) return {};
  return {
    [RUNNER_CREDENTIAL_ENV]: credential.trim(),
    [RUNNER_EGRESS_BASE_ENV]: config.egressBaseUrl,
    [RUNNER_EGRESS_MODELS_ENV]: JSON.stringify(config.models),
  };
}
