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
 *
 * `provider`(multi-gateway-providers spec 任务 4.2,Req 2.4)由封闭字面量联合放宽为
 * `string`:新增一个 AIGC provider 只需在目录里追加一条,不必再改本文件的类型定义。
 * `input`/`output`(同任务,Req 4.1/4.3)是本产品自有的模态取值域(与 core 的
 * `Modality` 同值域;此处**不 import** core —— 本文件的零 import 纪律见上,故自持
 * 一份同构的字面量类型,而非跨包引入)。
 */
export type AigcModality = "text" | "image" | "video" | "audio";

export interface AigcCatalogEntry {
  /** LLM 可见 model 值 + 路由键。 */
  readonly model: string;
  /** 展示标签。 */
  readonly label: string;
  /**
   * 归属 provider(供字母徽章)。放宽为 `string`(Req 2.4):新增 provider 是加配置,
   * 不是改代码。常见取值仍含 `openrouter` / `newapi` / `sufy` / `dashscope` /
   * `ai-gateway`(BlackSail 自建网关,**不是** Cloudflare)/ `cloudflare`
   * (Cloudflare AI Gateway,spec cloudflare-aigc-provider),但不再是穷举。
   */
  readonly provider: string;
  /**
   * 输入类型集合(Req 4.1)。图像生成/编辑工具均可吃文本提示,部分支持以图生图,
   * 故本目录统一声明为 `["text", "image"]`(design.md「输入/输出取值域」表:
   * 「AIGC 静态目录 | `["text","image"]`」)。
   */
  readonly input?: readonly AigcModality[];
  /**
   * 输出类型集合(Req 4.1)。本目录全部条目均为图像生成/编辑模型,统一声明为
   * `["image"]`(design.md 同表)。
   */
  readonly output?: readonly AigcModality[];
}

/** 本目录条目的统一模态声明(Req 4.1/4.3):全部条目均为「可读图 + 生图」。 */
const AIGC_ENTRY_MODALITY: {
  readonly input: readonly AigcModality[];
  readonly output: readonly AigcModality[];
} = {
  input: ["text", "image"],
  output: ["image"],
};

export const AIGC_MODEL_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2", label: "GPT Image 2 · NewAPI", provider: "newapi", ...AIGC_ENTRY_MODALITY },
  { model: "gemini-3.1-flash-image-newapi", label: "Gemini 3.1 Flash Image · NewAPI", provider: "newapi", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-image-2-sufy", label: "GPT Image 2 · sufy", provider: "sufy", ...AIGC_ENTRY_MODALITY },
  { model: "gemini-3.1-flash-lite-image-sufy", label: "Gemini 3.1 Flash Lite Image · sufy", provider: "sufy", ...AIGC_ENTRY_MODALITY },
  { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "gemini-3-pro-image", label: "Gemini 3 Pro Image · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-5-image", label: "GPT-5 Image · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-5-image-mini", label: "GPT-5 Image Mini · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-5.4-image-2", label: "GPT-5.4 Image 2 · OpenRouter", provider: "openrouter", ...AIGC_ENTRY_MODALITY },
  { model: "wan2.7-image-pro", label: "Wan 2.7 Image Pro", provider: "dashscope", ...AIGC_ENTRY_MODALITY },
  { model: "wan2.7-image-pro-bailian", label: "Wan 2.7 Image Pro · token plan", provider: "dashscope", ...AIGC_ENTRY_MODALITY },
  { model: "qwen-image-edit-max", label: "Qwen Image Edit Max · sync", provider: "dashscope", ...AIGC_ENTRY_MODALITY },
  { model: "wan2.7-image-edit-bailian", label: "Wan 2.7 Image Edit · token plan", provider: "dashscope", ...AIGC_ENTRY_MODALITY },
];

/**
 * 网关图像静态目录 — `AI_GATEWAY_IMAGE_ROUTES` ∪ `AI_GATEWAY_IMAGE_EDIT_ROUTES` 的路由键
 * 去重序(生成路由在前,编辑独有在后;当前两表键集相同)。⚠ gpt-image-2 条目在路由表经
 * extras 覆盖了路由键为 `gpt-image-2-ai-gateway`,目录对齐**最终**键值。
 *
 * ## provider 归属 = `cloudflare`(2026-08-03 用户决策)
 *
 * 本组走的是**网关的 OpenAI-compat 端点**(`BLKSAILS_GATEWAY_BASE_URL`),而
 * {@link CLOUDFLARE_AIGC_CATALOG} 走 Cloudflare 的**原生图像 API**(`CLOUDFLARE_*`)——
 * 两条不同通路,但当前部署下**同一个上游**,故归到同一个 provider 标识 `cloudflare`,
 * label 以 ` · Cloudflare compat` 与原生组区分(两组 model id 本就不重,不会撞键)。
 *
 * ⚠ **这是把某个部署的配置写进了产品常量**(该决策已知并被接受):`BLKSAILS_GATEWAY_BASE_URL`
 * 本身可以指向任何网关。若某部署把它指向真正的 BlackSail 自建网关,界面上仍会显示
 * `cloudflare` —— 名实不符。要让归属跟着配置走,需把此处常量改为读 env 声明
 * (与对话侧多实例 `PI_WEB_GATEWAYS` 同一原则),那是另一次改动。
 */
export const AI_GATEWAY_AIGC_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-1", label: "GPT Image 1 · Cloudflare compat", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-image-2-ai-gateway", label: "GPT Image 2 · Cloudflare compat", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "qwen-image", label: "Qwen Image · Cloudflare compat", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
];

/**
 * Cloudflare AI Gateway 图像静态目录(spec cloudflare-aigc-provider,Req 4.1/4.2)。
 *
 * 与 `CLOUDFLARE_IMAGE_ROUTES` ∪ `CLOUDFLARE_IMAGE_EDIT_ROUTES` 的路由键去重集对齐
 * (生成路由在前,编辑独有在后;当前两表键集相同),由 `test/aigc/model-catalog.test.ts`
 * 的第三组 sync 断言守卫。同样零 import / 零 env 读取(双入口纪律)。
 *
 * ⚠ 本组与上面的 {@link AI_GATEWAY_AIGC_CATALOG} 现在**同属** `provider: "cloudflare"`,
 * 但仍是两条不同通路:本组走 Cloudflare 原生图像 API(`CLOUDFLARE_*` 三项凭据),上面那组走
 * 网关的 OpenAI-compat 端点(`BLKSAILS_GATEWAY_BASE_URL`)。两组 model id 不重叠,
 * label 以 ` · Cloudflare`(原生)/ ` · Cloudflare compat`(兼容端点)区分。
 */
export const CLOUDFLARE_AIGC_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2-cf", label: "GPT Image 2 · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "gpt-image-1.5-cf", label: "GPT Image 1.5 · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "imagen-4-cf", label: "Imagen 4 · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "nano-banana-2-cf", label: "Nano Banana 2 · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "nano-banana-pro-cf", label: "Nano Banana Pro · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  { model: "flux-2-pro-cf", label: "FLUX.2 Pro · Cloudflare", provider: "cloudflare", ...AIGC_ENTRY_MODALITY },
  // ⚠ Workers AI 原生模型(flux-1-schnell-cf / lucid-origin-cf)已验证可用但**暂不入目录**:
  // 它们不走 Unified 统一计费,吃每日 10,000 neurons 免费额度,耗尽即 429。
  // 见 tools/image-generation.ts 的 CLOUDFLARE_WORKERS_AI_ROUTES 说明。
];
