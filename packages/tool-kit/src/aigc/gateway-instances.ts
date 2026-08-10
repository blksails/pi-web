/**
 * 网关实例(图像侧视角)— 跨进程契约的只读解析(spec desktop-aigc-egress,任务 3.2)。
 *
 * ## ★ 为什么这里要有第二份解析器
 *
 * 本包(`@blksails/pi-web-tool-kit`)在依赖图上位于 `core` 的**下游**(实测
 * `package.json`:`core` 依赖 `tool-kit`,不是反过来),因此**不能** import
 * `@blksails/pi-web-adapters` 里那份 `resolveAiGatewaySessionSpecsFromEnv` —— 那会成环。
 *
 * 于是同一批 env 键有两个读者。这本身是风险:两份解析随时间漂移,就会出现「对话侧认得
 * 这个实例、图像侧认不出」的错位,而它只在真机上以「聊天能用、生图说没有该模型」的形态
 * 暴露。**防线是契约互锁测试**(`test/gateway-image-instance-contract-lock.test.ts`):
 * 同一份 env 喂给两个解析器,断言实例标识 / 基址 / 凭据三项一致。改本文件的解析规则时,
 * 那条测试会立刻报红 —— 不要绕过它,要么两侧同改,要么别改。
 *
 * ## 双入口边界
 *
 * 本模块只在 **runtime 层**被调用(`extension.ts`),那里允许读 `process.env`。但本模块
 * 自身**不在模块顶层读 env** —— env 一律由入参传入,使它在声明层被 import 也不会破坏
 * 浏览器 bundle(`tech.md` §双入口边界)。
 */

/** 图像路由所需的最小实例信息。 */
export interface GatewayImageInstance {
  /** 实例标识,同时是其模型条目的 provider 名。 */
  readonly instanceId: string;
  /**
   * **裸基址**(不含 `/v1`)。
   *
   * ⚠ 跨进程契约里存的是**已含 `/v1`** 的形态(装配侧 `computeAiGatewaySessionsSpawnEnv`
   * 统一补了 `/v1`,因为对话侧的 pi SDK 按 OpenAI `baseURL` 约定消费)。图像 provider 的
   * 占位符自己拼 `/v1`,故本解析器在还原时**剥回裸基址**,否则得到 `/v1/v1/images/...`。
   */
  readonly baseUrl: string;
  /**
   * 请求凭据。
   *
   * ⚠ 授予来源的实例,这里承载的是**桌面登录凭据**而非网关数据面密钥 —— 请求打到云端
   * 代理,由它换取真正的密钥。不要把这个值当作网关 key 去做任何本地持久化。
   */
  readonly apiKey: string;
  /**
   * 云端声明的可用图像模型 id。
   *
   * `undefined` = 未声明 → 消费方回退内置白名单(与本特性引入前一致);
   * 空数组 = 明确声明"一个都没有"。两者不可归一(Req 4.2)。
   */
  readonly imageModels?: readonly string[];
}

/** 多实例清单 env(与适配层同一个键)。 */
const SESSIONS_ENV = "PI_WEB_AI_GATEWAY_SESSIONS";
/** 单实例(存量扁平形态)三件套。 */
const FLAT_BASE_ENV = "PI_WEB_AI_GATEWAY_SESSION_BASE";
const FLAT_KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_KEY";
const FLAT_IMAGE_MODELS_ENV = "PI_WEB_AI_GATEWAY_SESSION_IMAGE_MODELS";
/** 扁平形态对应的缺省实例标识(与适配层 `AI_GATEWAY_PROVIDER_NAME` 一致)。 */
const DEFAULT_INSTANCE_ID = "ai-gateway";

/**
 * 实例标识 → env 名变形:大写 + 连字符转下划线。
 *
 * ★ 必须与适配层 `envSafeInstanceId` 逐字一致。不一致的后果不是报错,而是**该实例在图像
 *   侧静默消失** —— 键名对不上,读到 undefined,当作没配。
 */
function envSafeInstanceId(id: string): string {
  return id.toUpperCase().replace(/-/g, "_");
}

function instancePrefix(id: string): string {
  return `PI_WEB_AI_GATEWAY_SESSION_${envSafeInstanceId(id)}_`;
}

/** 剥掉末尾的 `/v1` 与尾斜杠,还原为裸基址。 */
function toBareBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/+$/, "");
}

/** 解析 JSON 字符串数组;非法/非数组 → `undefined`。 */
function parseIdList(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 与适配层同规:配置异常不抛,视为空清单。
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}

function resolveOne(
  env: NodeJS.ProcessEnv,
  instanceId: string,
  baseEnvName: string,
  keyEnvName: string,
  imageModelsEnvName: string,
): GatewayImageInstance | undefined {
  const rawBase = env[baseEnvName]?.trim();
  const apiKey = env[keyEnvName]?.trim();
  // 启用判据 = 基址 + 凭据齐备,与适配层逐字一致。图像清单缺席不影响启用。
  if (rawBase === undefined || rawBase.length === 0) return undefined;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const baseUrl = toBareBase(rawBase);
  if (baseUrl.length === 0) return undefined;
  const imageModels = parseIdList(env[imageModelsEnvName]);
  return {
    instanceId,
    baseUrl,
    apiKey,
    ...(imageModels !== undefined ? { imageModels } : {}),
  };
}

/**
 * 从 env 还原全部网关实例(图像侧)。
 *
 * - 多实例清单存在 → 逐个按 `PI_WEB_AI_GATEWAY_SESSION_<ID>_BASE/_KEY/_IMAGE_MODELS` 解析。
 * - 清单缺席 → 回落扁平三件套,合成缺省实例(存量兼容)。
 * - 某实例解析不出 → **只跳过它**(fail-soft),不影响其余实例,也不抛。
 */
export function resolveGatewayImageInstances(
  env: NodeJS.ProcessEnv,
): readonly GatewayImageInstance[] {
  const rawList = env[SESSIONS_ENV]?.trim();
  if (rawList === undefined || rawList.length === 0) {
    const flat = resolveOne(
      env,
      DEFAULT_INSTANCE_ID,
      FLAT_BASE_ENV,
      FLAT_KEY_ENV,
      FLAT_IMAGE_MODELS_ENV,
    );
    return flat === undefined ? [] : [flat];
  }
  const ids = rawList
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: GatewayImageInstance[] = [];
  for (const id of ids) {
    const prefix = instancePrefix(id);
    const inst = resolveOne(
      env,
      id,
      `${prefix}BASE`,
      `${prefix}KEY`,
      `${prefix}IMAGE_MODELS`,
    );
    if (inst !== undefined) out.push(inst);
  }
  return out;
}
