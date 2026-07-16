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

// ── 网关配置 ─────────────────────────────────────────────────────────────────

// NewAPI 网关 base 为**编译期常量**:本模块经 tool 声明从主入口(前端安全)导出,
// 模块顶层**不得**读 `process.env`(浏览器 bundle eval 时 `process` 可能未定义,破坏双入口
// 边界 / Req 6.1)。如需可配置 base,后续经 var-resolver `${VAR}` 占位在运行时解析。
const NEWAPI_CONFIG: OpenAiCompatConfig = {
  baseUrl: "https://www.apiservices.top/v1",
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
