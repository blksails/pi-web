/**
 * aigc-proxy · provider 登记表(静态映射,Req 2.2)。
 *
 * 已登记 provider 到「上游 base + 真实 key 的宿主 env 变量名」的静态映射。真实 key
 * 本身**不**在此模块读取或缓存——本模块只提供 keyEnv 名与按 id 查表的能力,请求期
 * 从宿主 `process.env[keyEnv]` 读取真实 key 是 proxy-routes(任务 3.1)的职责,与本地
 * 直连时的 env 读取语义一致(不缓存,每请求即时读)。
 *
 * 登记表写死、`:provider` 不参与 URL 拼接(仅用于查表命中项)——无 SSRF 面
 * (design.md Security Considerations)。
 *
 * ⚠️ upstreamBase 必须与 `packages/tool-kit/src/aigc/providers/*.ts` 里对应 provider 的
 * base URL 占位默认字面量逐字一致(revalidation trigger:两处同改,任一处改动都需要
 * 同步核对另一处,否则代理转发的上游地址会与本地直连场景的默认地址产生分歧)。
 */

/** 已登记的 provider id。 */
export type AigcProxyProviderId = "newapi" | "sufy" | "dashscope";

/** provider 登记表条目:上游 base 与真实 key 的宿主 env 变量名。 */
export interface AigcProxyProviderEntry {
  /** 上游网关 base URL(不含尾斜杠),须与 tool-kit 对应 provider 的默认字面量逐字一致。 */
  readonly upstreamBase: string;
  /** 宿主进程持有真实 key 的环境变量名;请求期即时读取,不在本模块缓存。 */
  readonly keyEnv: string;
}

/**
 * provider 静态登记表。
 *
 * 三项 upstreamBase 与 tool-kit 占位默认字面量逐字一致(revalidation trigger,两处同改):
 * - newapi → `packages/tool-kit/src/aigc/providers/newapi.ts` 的 `NEWAPI_CONFIG.baseUrl`
 * - sufy → `packages/tool-kit/src/aigc/providers/sufy.ts` 的对应 baseUrl
 * - dashscope → `packages/tool-kit/src/aigc/providers/dashscope.ts` 的 `BASE`
 */
const PROVIDER_REGISTRY: Readonly<Record<AigcProxyProviderId, AigcProxyProviderEntry>> = {
  newapi: {
    upstreamBase: "https://www.apiservices.top/v1",
    keyEnv: "NEWAPI_API_KEY",
  },
  sufy: {
    upstreamBase: "https://openai.sufy.com/v1",
    keyEnv: "SUFY_API_KEY",
  },
  dashscope: {
    upstreamBase: "https://dashscope.aliyuncs.com/api/v1",
    keyEnv: "DASHSCOPE_API_KEY",
  },
};

/**
 * 按 provider id 查表。
 *
 * @param id 任意字符串(通常来自请求路径的 `:provider` 段);未登记 id 返回 `undefined`,
 * 不抛——由调用方(proxy-routes)据此短路映射 404。
 */
export function lookupProvider(id: string): AigcProxyProviderEntry | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDER_REGISTRY, id)
    ? PROVIDER_REGISTRY[id as AigcProxyProviderId]
    : undefined;
}
