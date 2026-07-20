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
  provider: "ai-gateway",
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
