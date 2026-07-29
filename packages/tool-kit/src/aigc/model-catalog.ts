/**
 * model-catalog — AIGC 图像模型的**纯展示元数据目录**(aigc-tool-settings)。
 *
 * 单一事实源:每个图像模型的 `{ model, label, provider }` 三元组,供 /settings 的「模型开关」
 * 面板列举(该页无会话态,拿不到 aigcExtension 运行期下发的 `aigc.models`)。
 *
 * ⚠ **零 import / 零 pi SDK**:本模块经 tool-kit **主入口**(前端安全)+ 专用子路径导出,供
 * server / Next 路由直接 import 而不把 pi SDK 拖进 bundle(否则 dev 路由崩 node:fs)。
 * 与 provider ROUTES 的一致性由 `test/aigc/model-catalog.test.ts` 的 sync 断言守卫(防漂移)。
 *
 * 顺序与 `publishAigcCatalog` 的 gen∪edit 并集去重序一致(生成路由在前,编辑独有在后)。
 *
 * `AI_GATEWAY_AIGC_CATALOG`(model-catalog spec,AI_GATEWAY_AIGC_CATALOG 边界):网关图像
 * 静态目录,与 `AI_GATEWAY_IMAGE_ROUTES` ∪ `AI_GATEWAY_IMAGE_EDIT_ROUTES` 的**最终**路由键
 * 去重集对齐(同款 sync 断言守卫);同样零 import / 零 env 读取(双入口纪律)。
 */
export interface AigcCatalogEntry {
  /** LLM 可见 model 值 + 路由键。 */
  readonly model: string;
  /** 展示标签。 */
  readonly label: string;
  /** 归属 provider(供字母徽章)。 */
  readonly provider:
    | "openrouter"
    | "newapi"
    | "sufy"
    | "dashscope"
    /** BlackSail 自建网关,**不是** Cloudflare。 */
    | "ai-gateway"
    /** Cloudflare AI Gateway(spec cloudflare-aigc-provider)。 */
    | "cloudflare";
}

export const AIGC_MODEL_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2", label: "GPT Image 2 · NewAPI", provider: "newapi" },
  { model: "gemini-3.1-flash-image-newapi", label: "Gemini 3.1 Flash Image · NewAPI", provider: "newapi" },
  { model: "gpt-image-2-sufy", label: "GPT Image 2 · sufy", provider: "sufy" },
  { model: "gemini-3.1-flash-lite-image-sufy", label: "Gemini 3.1 Flash Lite Image · sufy", provider: "sufy" },
  { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image · OpenRouter", provider: "openrouter" },
  { model: "gemini-3-pro-image", label: "Gemini 3 Pro Image · OpenRouter", provider: "openrouter" },
  { model: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image · OpenRouter", provider: "openrouter" },
  { model: "gpt-5-image", label: "GPT-5 Image · OpenRouter", provider: "openrouter" },
  { model: "gpt-5-image-mini", label: "GPT-5 Image Mini · OpenRouter", provider: "openrouter" },
  { model: "gpt-5.4-image-2", label: "GPT-5.4 Image 2 · OpenRouter", provider: "openrouter" },
  { model: "wan2.7-image-pro", label: "Wan 2.7 Image Pro", provider: "dashscope" },
  { model: "wan2.7-image-pro-bailian", label: "Wan 2.7 Image Pro · token plan", provider: "dashscope" },
  { model: "qwen-image-edit-max", label: "Qwen Image Edit Max · sync", provider: "dashscope" },
  { model: "wan2.7-image-edit-bailian", label: "Wan 2.7 Image Edit · token plan", provider: "dashscope" },
];

/**
 * 网关图像静态目录 — `AI_GATEWAY_IMAGE_ROUTES` ∪ `AI_GATEWAY_IMAGE_EDIT_ROUTES` 的路由键
 * 去重序(生成路由在前,编辑独有在后;当前两表键集相同)。⚠ gpt-image-2 条目在路由表经
 * extras 覆盖了路由键为 `gpt-image-2-ai-gateway`,目录对齐**最终**键值。
 */
export const AI_GATEWAY_AIGC_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-1", label: "GPT Image 1 · ai-gateway", provider: "ai-gateway" },
  { model: "gpt-image-2-ai-gateway", label: "GPT Image 2 · ai-gateway", provider: "ai-gateway" },
  { model: "qwen-image", label: "Qwen Image · ai-gateway", provider: "ai-gateway" },
];

/**
 * Cloudflare AI Gateway 图像静态目录(spec cloudflare-aigc-provider,Req 4.1/4.2)。
 *
 * 与 `CLOUDFLARE_IMAGE_ROUTES` ∪ `CLOUDFLARE_IMAGE_EDIT_ROUTES` 的路由键去重集对齐
 * (生成路由在前,编辑独有在后;当前两表键集相同),由 `test/aigc/model-catalog.test.ts`
 * 的第三组 sync 断言守卫。同样零 import / 零 env 读取(双入口纪律)。
 *
 * ⚠ `provider: "cloudflare"` 指 **Cloudflare AI Gateway**,与上面的 `"ai-gateway"`
 * (BlackSail 自建网关)是两条不同通路,勿混。
 */
export const CLOUDFLARE_AIGC_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2-cf", label: "GPT Image 2 · Cloudflare", provider: "cloudflare" },
  { model: "gpt-image-1.5-cf", label: "GPT Image 1.5 · Cloudflare", provider: "cloudflare" },
  { model: "imagen-4-cf", label: "Imagen 4 · Cloudflare", provider: "cloudflare" },
  { model: "nano-banana-2-cf", label: "Nano Banana 2 · Cloudflare", provider: "cloudflare" },
  { model: "nano-banana-pro-cf", label: "Nano Banana Pro · Cloudflare", provider: "cloudflare" },
  { model: "flux-2-pro-cf", label: "FLUX.2 Pro · Cloudflare", provider: "cloudflare" },
  // ⚠ Workers AI 原生模型(flux-1-schnell-cf / lucid-origin-cf)已验证可用但**暂不入目录**:
  // 它们不走 Unified 统一计费,吃每日 10,000 neurons 免费额度,耗尽即 429。
  // 见 tools/image-generation.ts 的 CLOUDFLARE_WORKERS_AI_ROUTES 说明。
];
