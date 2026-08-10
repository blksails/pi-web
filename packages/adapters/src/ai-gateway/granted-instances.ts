/**
 * 云端授予 → 网关实例(spec desktop-aigc-egress,任务 1.3;Req 1.1/4.1/5.1/8.1/8.2)。
 *
 * 桌面登录态下,云端签发的网关接入授予在此被转换为一个与 env 来源**同构**的
 * {@link GatewayInstanceConfig}。同构是关键:下游三个消费点(模型目录聚合 / 网关转发路由 /
 * 本地会话下发)因此**无法分辨**实例来自 env 还是来自授予,一行都不用改。
 *
 * ## ★ 裸基址不变式(本模块存在的首要理由)
 *
 * 授予里的地址与实例配置里的地址,`/v1` 的归属**正好相反**:
 *
 * | 来源 | 例 | 谁拼 `/v1` |
 * |---|---|---|
 * | `CapabilityGatewayGrant.baseUrl` | `…/api/desktop/egress/v1` | 已含(pi SDK `baseURL` 约定) |
 * | `GatewayInstanceConfig.baseUrl` | `…/api/desktop/egress` | **消费方自己拼** |
 *
 * 消费方确实各自在拼:目录聚合拼 `${baseUrl}/v1/models`(`model-catalog.ts`),AIGC 图像
 * provider 拼 `${…}/v1`(`tool-kit` 的 `providers/ai-gateway.ts`)。所以授予地址不剥 `/v1`
 * 就会打到 `…/egress/v1/v1/models` —— 404,且错误信息完全不指向根因。
 *
 * 归一**只在本模块做一次**。不要在消费方各剥一次:同一个不变式散落在多处,就是它失守的
 * 方式(pi-clouds 侧为此把裸基址与数据面基址分成了两个函数,正是同一教训)。
 *
 * ## ★ `apiKey` 承载的是桌面凭据,不是网关密钥
 *
 * 字段名沿用 `apiKey` 只是为了与 env 来源同构。它的值是**桌面登录凭据**,云端出口据此
 * 验签并换取真正的 `sk-gw-*` 数据面密钥 —— 后者始终不出云端(Req 8.1)。任何把这个字段
 * 当成网关密钥来处理的代码(例如写入本地配置文件、或直接发往网关)都是错的。
 */
import {
  validateProviderId,
  type ProviderId,
} from "@blksails/pi-web-core/model-catalog/provider-identity.js";
import type { CapabilityGatewayGrant } from "@blksails/pi-web-core/capability/types.js";

export type { CapabilityGatewayGrant };
import { DEFAULT_CATALOG_TTL_MS, DEFAULT_TIMEOUT_MS } from "./config.js";
import type { GatewayInstanceConfig } from "./instances.js";

/**
 * 授予实例的默认标识。
 *
 * 取 `blksails-cloud` 而非 `ai-gateway`:后者是 env 单实例来源的缺省标识
 * ({@link DEFAULT_GATEWAY_INSTANCE_ID}),两者同名会让「本地配了网关」与「登录拿到云端出口」
 * 互相覆盖,而这两件事本应共存(Req 6.1 的前提)。
 */
export const GRANTED_GATEWAY_INSTANCE_ID = "blksails-cloud";

/** {@link grantedGatewayInstance} 的入参。 */
export interface GrantedInstanceInput {
  /** 云端能力快照里的网关授予;缺席时调用方不应调用本函数。 */
  readonly grant: CapabilityGatewayGrant;
  /**
   * 桌面登录凭据。**不是**网关数据面密钥,见本文件头部说明。
   */
  readonly credential: string;
  /** 实例标识;缺省 {@link GRANTED_GATEWAY_INSTANCE_ID}。 */
  readonly instanceId?: string;
}

/**
 * 把授予地址归一为**裸基址**:剥掉末尾的 `/v1`(可带尾斜杠)与多余尾斜杠。
 *
 * 只剥**末尾**的那一段。路径中间出现的 `v1`(如 `…/api/v1/desktop/egress`)不动 ——
 * 那是部署方的路径结构,不是 OpenAI 约定的版本段。
 *
 * @param raw 授予地址(可含或不含尾部 `/v1`)。
 * @returns 裸基址;输入不是合法绝对 URL 时返回 `undefined`。
 */
export function toBareGatewayBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  // 先去尾斜杠,再剥末尾 `/v1`,再去一次尾斜杠(`…/egress/v1/` 这类形态)。
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  const bare = withoutTrailing.replace(/\/v1$/i, "").replace(/\/+$/, "");
  return bare.length > 0 ? bare : undefined;
}

/**
 * 由授予构造网关实例配置。
 *
 * **失败即返回 `undefined`,不抛**(Req 1.2 的降级语义):能力端口的约定是「不可用」以缺失
 * 表达、由消费方降级,而非让装配崩掉。凭据为空、地址非法、标识不合法都属「这项能力这次
 * 用不了」,不是部署配置错误 —— 后者才该 fail-fast(env 来源的 `resolveGatewayInstances`
 * 就是那样做的,两者刻意不同)。
 */
export function grantedGatewayInstance(
  input: GrantedInstanceInput,
): GatewayInstanceConfig | undefined {
  const credential = input.credential.trim();
  if (credential.length === 0) return undefined;

  const baseUrl = toBareGatewayBaseUrl(input.grant.baseUrl);
  if (baseUrl === undefined) return undefined;

  const validation = validateProviderId(input.instanceId ?? GRANTED_GATEWAY_INSTANCE_ID);
  if (!validation.ok) return undefined;

  return {
    id: validation.id as ProviderId,
    baseUrl,
    // ⚠ 桌面凭据,非 sk-gw。见文件头部。
    apiKey: credential,
    // 云端出口暴露哪些上游归属,由网关按该账号的可见性决定,本地无从预知,二次收窄只会
    // 把目录滤成空。故传**空集** —— `createGatewayCatalogs` 把它当作「不按归属过滤」的
    // 哨兵(见该处注释:`filterByOwner` 对 undefined 放行、对空集全滤,语义相反;而 env
    // 路径的 `parseProviderAllowlist` 永不产出空集,故这个哨兵不与既有行为冲突)。
    allowedOwners: new Set<string>(),
    ttlMs: DEFAULT_CATALOG_TTL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
