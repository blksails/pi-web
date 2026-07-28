/**
 * NewAPI(OpenAI 兼容聚合网关)provider 工厂 — `@blksails/pi-web-tool-kit` 版。
 *
 * NewAPI 是 OpenAI `/images` 协议兼容网关,故本模块只是通用工厂
 * {@link createOpenAiCompatImage} / {@link createOpenAiCompatImageEdit} 的**薄封装**:
 * 绑定 NewAPI 的 base URL 与 `NEWAPI_API_KEY`。共享的 buildBody / pickResult / detectError
 * 均在 `./openai-compat.ts`。
 *
 * 提供两类 model 路由项工厂(返回 {@link ImageRoute}):
 *  - createNewApiImage:     文生图,走 /v1/images/generations
 *  - createNewApiImageEdit: 图像编辑,走 /v1/images/edits(multipart FormData)
 *
 * `model` 为 LLM 可见路由键;`providerModel`(缺省 = model)为实际发往网关的 model 名。
 * base URL 为编译期常量;key 走 `${NEWAPI_API_KEY}` 占位(var-resolver 运行时展开)。
 * 国内网关**不挂 proxy**,避免增加延迟或触发安全策略。
 */

import type { ImageRoute } from "../types.js";
import {
  createOpenAiCompatImage,
  createOpenAiCompatImageEdit,
  type OpenAiCompatConfig,
  type OpenAiCompatModelArgs,
} from "./openai-compat.js";
import {
  createGeminiRelayImage,
  createGeminiRelayImageEdit,
  type GeminiRelayConfig,
  type GeminiRelayModelArgs,
} from "./gemini-relay.js";

// ── 网关配置 ─────────────────────────────────────────────────────────────────

// NewAPI 网关 base 为**编译期字符串字面量**:本模块经 tool 声明从主入口(前端安全)导出,
// 模块顶层**不得**读 `process.env`(浏览器 bundle eval 时 `process` 可能未定义,破坏双入口
// 边界 / Req 6.1)。base 走 `${NEWAPI_BASE_URL:-默认值}` 占位,在 runEndpoint 执行期经
// var-resolver 展开(未设/空 env 时回落默认字面量,Req 5.1/5.2/5.3)。
const NEWAPI_CONFIG: OpenAiCompatConfig = {
  baseUrl: "${NEWAPI_BASE_URL:-https://www.apiservices.top/v1}",
  apiKeyVar: "NEWAPI_API_KEY",
  provider: "newapi",
  // 该网关与 sufy 同样严格拒绝 response_format(400 Unknown parameter,2026-07-16 实测);
  // gpt-image 系列默认即返回 b64_json,省略不损失内联优化。
  omitResponseFormat: true,
};

// ── model 路由项工厂入参(向后兼容别名)──────────────────────────────────────────

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export type NewApiModelArgs = OpenAiCompatModelArgs;

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 NewAPI 文生图路由项(走 /v1/images/generations)。
 */
export function createNewApiImage(
  args: NewApiModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImage(NEWAPI_CONFIG, args, extras);
}

/**
 * 创建 NewAPI 图像编辑路由项(走 /v1/images/edits multipart)。
 */
export function createNewApiImageEdit(
  args: NewApiModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImageEdit(NEWAPI_CONFIG, args, extras);
}

// ── Gemini relay(与上面的 OpenAI 兼容面**并存的第二条协议**)──────────────────

/**
 * NewAPI 的 Gemini 原生 relay 配置(`/v1beta/models/<model>:generateContent`)。
 *
 * ★为什么 Gemini 系不能走上面的 `createNewApiImage`(2026-07-28 真机实测):
 *   - `/v1/images/generations` → `not supported model for image generation, only imagen
 *     models are supported`;
 *   - `/v1/chat/completions`   → 挂满 180s 无响应;
 *   - `/v1beta/models/<model>:generateContent` → 出图(1024×1024 JPEG,约 170s)。
 *
 * base 独立成 `NEWAPI_GEMINI_BASE_URL` 占位而非从 `NEWAPI_BASE_URL` 推导:后者是 `${VAR}`
 * 占位符、在 var-resolver 展开前无法做 `/v1`→`/v1beta` 的字符串替换。默认值指向同一网关。
 */
const NEWAPI_GEMINI_CONFIG: GeminiRelayConfig = {
  baseUrl: "${NEWAPI_GEMINI_BASE_URL:-https://www.apiservices.top/v1beta}",
  apiKeyVar: "NEWAPI_API_KEY",
  provider: "newapi",
};

/** 工厂入参别名(与 {@link NewApiModelArgs} 同形,分开命名以示协议不同)。 */
export type NewApiGeminiModelArgs = GeminiRelayModelArgs;

/** 创建 NewAPI 上的 Gemini relay 文生图路由项。 */
export function createNewApiGeminiImage(
  args: NewApiGeminiModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createGeminiRelayImage(NEWAPI_GEMINI_CONFIG, args, extras);
}

/** 创建 NewAPI 上的 Gemini relay 图像编辑路由项(同端点,输入图经 inlineData 提交)。 */
export function createNewApiGeminiImageEdit(
  args: NewApiGeminiModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createGeminiRelayImageEdit(NEWAPI_GEMINI_CONFIG, args, extras);
}
