/**
 * ai-gateway(pi-web 专属网关)provider 工厂 — `@blksails/pi-web-tool-kit` 版
 * (spec ai-gateway-providers,design.md §3,Req Story 5)。
 *
 * ai-gateway 是 OpenAI `/images` 协议兼容网关,故本模块只是通用工厂
 * {@link createOpenAiCompatImage} / {@link createOpenAiCompatImageEdit} 的**薄封装**,
 * 与 `newapi.ts` / `sufy.ts` 同构:绑定 ai-gateway 的 base URL 与
 * `BLKSAILS_GATEWAY_API_KEY`,**零 quirks 特判**(网关侧已下沉,与 newapi 的
 * `omitResponseFormat` 等聚合网关差异特判不同)。共享的 buildBody / pickResult /
 * detectError 均在 `./openai-compat.ts`。
 *
 * 提供两类 model 路由项工厂(返回 {@link ImageRoute}):
 *  - createAiGatewayImage:     文生图,走 /v1/images/generations
 *  - createAiGatewayImageEdit: 图像编辑,走 /v1/images/edits(multipart FormData)
 *
 * `model` 为 LLM 可见路由键;`providerModel`(缺省 = model)为实际发往网关的 model 名。
 *
 * **双入口边界**(Req 6.2):本模块经 tool 声明从主入口(前端安全)导出,模块顶层**不得**读
 * `process.env`。base URL 走 `${BLKSAILS_GATEWAY_BASE_URL:-默认值}/v1` 占位符,key 走
 * `${BLKSAILS_GATEWAY_API_KEY}` 占位符,均在 runEndpoint 执行期经 var-resolver 展开
 * (未设/空 env 时回落默认字面量)。是否**注册**本模块产出的路由(`AI_GATEWAY_IMAGE_ROUTES`,
 * 见 `../tools/image-generation.ts`/`../tools/image-edit.ts`)由 runtime 层 `extension.ts`
 * 按网关 base URL env 存在与否条件并入——本模块自身仍是纯声明层,不参与该条件判断。
 */

import type { ImageRoute } from "../types.js";
import {
  createOpenAiCompatImage,
  createOpenAiCompatImageEdit,
  type OpenAiCompatConfig,
  type OpenAiCompatModelArgs,
} from "./openai-compat.js";

// ── 网关配置 ─────────────────────────────────────────────────────────────────

// ai-gateway base 为**占位符字符串字面量**(非 env 读取),与 pi-web server 侧
// `resolveAiGatewayConfig` 同名 env,便于运维一处配置两侧一致生效。默认回落本地开发
// 网关(`http://127.0.0.1:8080`)。
//
// ★为什么是 BLKSAILS_GATEWAY_* 而不是 AI_GATEWAY_*(pi-clouds 8.2 真机事故):
// `AI_GATEWAY_API_KEY` 是 pi-ai SDK 内建 **Vercel AI Gateway** 的官方凭据 env
// (env-api-keys.ts 的 envMap: "vercel-ai-gateway" → AI_GATEWAY_API_KEY)。本模块跑在
// pi 子进程内,该 env 一旦出现在进程环境里就会劫持**全部**模型调用去 Vercel(401),
// 而不只是影响图像工具。故运行时读的 env 名必须与 SDK 保留名分开。
// 旧名兼容由 runtime 层 `../extension.ts` 归一化(占位符语法不支持多变量回落)。
const AI_GATEWAY_CONFIG: OpenAiCompatConfig = {
  baseUrl: "${BLKSAILS_GATEWAY_BASE_URL:-http://127.0.0.1:8080}/v1",
  apiKeyVar: "BLKSAILS_GATEWAY_API_KEY",
  // 展示归属(不参与分发 —— 真实上游由上面的 baseUrl + apiKeyVar 决定)。
  // 2026-08-03 用户决策:本通路当前指向 Cloudflare AI Gateway 的 compat 端点,
  // 故归到 `cloudflare`,与 providers/cloudflare.ts 的原生图像通路同一 provider。
  // ⚠ 这把某个部署的配置写进了常量:BLKSAILS_GATEWAY_BASE_URL 可指向任何网关,
  //   若指向真正的自建网关,界面仍显示 cloudflare(已知取舍,见 model-catalog.ts 注释)。
  provider: "cloudflare",
  // 零 quirks(Req 5.1):不设 omitResponseFormat(缺省 false,与 NewAPI 一致显式发送
  // response_format),因为网关侧已统一承接协议差异,pi-web 侧不再特判。
};

// ── model 路由项工厂入参(向后兼容别名)──────────────────────────────────────────

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export type AiGatewayModelArgs = OpenAiCompatModelArgs;

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 ai-gateway 文生图路由项(走 /v1/images/generations)。
 */
export function createAiGatewayImage(
  args: AiGatewayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImage(AI_GATEWAY_CONFIG, args, extras);
}

/**
 * 创建 ai-gateway 图像编辑路由项(走 /v1/images/edits multipart)。
 */
export function createAiGatewayImageEdit(
  args: AiGatewayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImageEdit(AI_GATEWAY_CONFIG, args, extras);
}

// ── 按实例参数化(spec desktop-aigc-egress 任务 3.3)───────────────────────────

/**
 * 生成某网关实例的 {@link OpenAiCompatConfig}。
 *
 * 与上面那份写死的 {@link AI_GATEWAY_CONFIG} 的三处差别,每一处都是本任务要解决的问题:
 *
 * | | 写死版 | 按实例版 |
 * |---|---|---|
 * | `baseUrl` | env 占位符,全进程只有一个槽 | 该实例的裸基址 + `/v1`,多实例可并存 |
 * | `apiKeyVar` | 全局 `BLKSAILS_GATEWAY_API_KEY` | 该实例自己的 KEY env 名 |
 * | `provider` | 常量 `"cloudflare"`(部署配置写进了代码) | 实例标识 = 实际承接方(Req 5.1/5.2) |
 *
 * ⚠ **声明层不读 env**:`baseUrl` 用实例给的字面量(不再是 `${VAR:-default}` 占位符),
 *   `apiKeyVar` 仍是**变量名**而非值 —— 凭据在执行期由 var-resolver 从 env 取,凭据本身
 *   一步都不进入声明层。这条是双入口硬约束(`tech.md`),不能为省事改成直接传 key。
 */
export function gatewayInstanceImageConfig(input: {
  /** 实例标识,同时作为展示归属。 */
  readonly instanceId: string;
  /** 裸基址(不含 `/v1`)。 */
  readonly baseUrl: string;
  /** 承载该实例凭据的 env 变量名。 */
  readonly apiKeyVar: string;
}): OpenAiCompatConfig {
  return {
    baseUrl: `${input.baseUrl.replace(/\/+$/, "")}/v1`,
    apiKeyVar: input.apiKeyVar,
    provider: input.instanceId,
  };
}

/**
 * 网关实例请求失败的可读化(spec desktop-aigc-egress 任务 4.1,Req 7.1/7.2/7.5)。
 *
 * 三类必须**可区分**,因为使用者的下一步动作完全不同:
 *  - **401/403** → 凭据过期或无效 → 去重新登录;
 *  - **429/402** → 配额或计费问题 → 等待或充值,重新登录没用;
 *  - 其余 → 上游异常 → 通常是暂态。
 *
 * 若不分类,三者在界面上都是 `<url>: 4xx {...}`,使用者只能反复重试。
 *
 * ⚠ 文案**不含**凭据:入参里根本没有 key(它在请求头,不在这里),`body` 是上游响应体 ——
 *   为稳妥仍只取其前若干字符,且不回显任何请求头。
 */
export function gatewayTransportErrorMessage(info: {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly instanceId: string;
}): string | undefined {
  const { status, instanceId } = info;
  if (status === 401 || status === 403) {
    return `云端出口拒绝了本次请求(${status}):登录凭据已失效或无权访问「${instanceId}」。请重新登录后再试。`;
  }
  if (status === 402 || status === 429) {
    return `云端出口暂时不可用(${status}):「${instanceId}」的配额或计费额度不足。重新登录无助于此,请检查账户额度。`;
  }
  if (status >= 500) {
    return `云端出口上游异常(${status}):「${instanceId}」暂时不可用,请稍后重试。`;
  }
  // 其余状态码不接管,沿用默认文案(它带 url 与响应体,便于排查)。
  return undefined;
}

/** 用给定实例配置创建文生图路由项。 */
export function createGatewayInstanceImage(
  config: OpenAiCompatConfig,
  args: AiGatewayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return withGatewayErrorMapping(createOpenAiCompatImage(config, args, extras), config.provider);
}

/** 用给定实例配置创建图像编辑路由项。 */
export function createGatewayInstanceImageEdit(
  config: OpenAiCompatConfig,
  args: AiGatewayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return withGatewayErrorMapping(
    createOpenAiCompatImageEdit(config, args, extras),
    config.provider,
  );
}

/** 给路由挂上失败分类(不改其余行为)。 */
function withGatewayErrorMapping(route: ImageRoute, instanceId: string): ImageRoute {
  return {
    ...route,
    mapTransportError: (info) => gatewayTransportErrorMessage({ ...info, instanceId }),
  };
}
