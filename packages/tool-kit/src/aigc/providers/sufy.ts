/**
 * sufy(七牛云 AI 推理 · OpenAI 兼容聚合网关)provider 工厂 — `@blksails/pi-web-tool-kit` 版。
 *
 * sufy 是 OpenAI `/images` 协议兼容网关(`兼容 OpenAI & Anthropic 接口`),故本模块只是通用工厂
 * {@link createOpenAiCompatImage} / {@link createOpenAiCompatImageEdit} 的**薄封装**:
 * 绑定 sufy 的 base URL 与 `SUFY_API_KEY`。共享的 buildBody / pickResult / detectError
 * 均在 `./openai-compat.ts`。
 *
 * 提供两类 model 路由项工厂(返回 {@link ImageRoute}):
 *  - createSufyImage:     文生图,走 /v1/images/generations
 *  - createSufyImageEdit: 图像编辑,走 /v1/images/edits(multipart FormData)
 *
 * `model` 为 LLM 可见路由键;`providerModel`(缺省 = model)为实际发往网关的 model 名——
 * sufy 上 gpt-image-2 的真实 id 带 `openai/` 前缀(`openai/gpt-image-2`)。
 * base URL 为编译期常量;key 走 `${SUFY_API_KEY}` 占位(var-resolver 运行时展开)。
 */

import type { ImageRoute } from "../types.js";
import {
  createOpenAiCompatImage,
  createOpenAiCompatImageEdit,
  type OpenAiCompatConfig,
  type OpenAiCompatModelArgs,
} from "./openai-compat.js";

// ── 网关配置 ─────────────────────────────────────────────────────────────────

// sufy OpenAI 兼容 base(`https://openai.sufy.com/v1`,七牛云 AIGC 网关,与 api.qnaigc.com 同源)。
// 编译期常量,勿读 env(双入口边界:主入口经浏览器 bundle,`process` 可能未定义)。
// 经 curl 冒烟实测:/images/generations 与 /images/edits(接受 image[] 多图字段)均出图;
// 模型 id 必须带 openai/ 前缀(见 providerModel),不带前缀返回 502 upstream_error。
// omitResponseFormat:sufy 严格拒绝 response_format 参数
// ("[BadRequestError] Unknown parameter: 'response_format'" → 400),故文生图不发该字段;
// gpt-image 系列默认已返回 b64_json,省略不损失 persistPicked 的 b64 内联优化。
const SUFY_CONFIG: OpenAiCompatConfig = {
  baseUrl: "https://openai.sufy.com/v1",
  apiKeyVar: "SUFY_API_KEY",
  omitResponseFormat: true,
  provider: "sufy",
};

// ── model 路由项工厂入参(别名)────────────────────────────────────────────────

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export type SufyModelArgs = OpenAiCompatModelArgs;

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 sufy 文生图路由项(走 /aitoken/v1/images/generations)。
 */
export function createSufyImage(
  args: SufyModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImage(SUFY_CONFIG, args, extras);
}

/**
 * 创建 sufy 图像编辑路由项(走 /aitoken/v1/images/edits multipart)。
 */
export function createSufyImageEdit(
  args: SufyModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return createOpenAiCompatImageEdit(SUFY_CONFIG, args, extras);
}
