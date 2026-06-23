/**
 * `image_edit` ToolSpec 声明 — 图像编辑(对齐 OpenAI Images `/v1/images/edits`)。
 *
 * 纯数据声明,无值导入运行时库:可从主入口安全导出(守 webpack externals 边界)。
 *
 * model 路由(本轮):
 *  - `gpt-image-2`         NewAPI(默认)—— OpenAI 兼容 edits(整图改写),经验证可用
 *  - `qwen-image-edit-max` DashScope —— 最高保真,支持 mask 局部重绘
 *
 * 参数对齐 OpenAI Images edits:`image`/`prompt`(必填)+ `mask`/`n`/`size`/`response_format`;
 * 另保留 `reference_images`(DashScope 风格/角色一致)。`image`/`mask`/`reference_images` 的
 * `att_` 前缀引用由编译器在发往 provider 前解析为 data URI。`model` 由编译器据 models 注入。
 */

import type { ToolSpec } from "../../engine/types.js";
import {
  createDashscopeImageEdit,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createNewApiImageEdit } from "../providers/newapi.js";

export const imageEdit: ToolSpec = {
  name: "image_edit",
  label: "Image edit",
  description:
    "Edit an existing image based on a text prompt. " +
    "Supports inpainting (mask-aware) via DashScope and whole-image rewrite via NewAPI. " +
    "Provide image and prompt; optionally provide mask (B/W, white = repaint region) and reference_images. " +
    "IMPORTANT: pass `prompt` in the user's original language verbatim; do NOT translate it to English.",

  inputSchema: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description:
          "Attachment id (att_...) or URL of the image to edit. " +
          "Attachment ids are resolved to data URIs before being sent to the provider.",
        mediaKind: "image",
      },
      prompt: {
        type: "string",
        description:
          "What to change, in the user's original language (do NOT translate to English). " +
          "Concrete descriptions work better than abstract ones.",
        examples: [
          "把背景换成夕阳下的海滩",
          "去掉文字水印,保持背景一致",
          "将整体风格改为吉卜力动画",
          "把白天改成夜晚,加上星空",
        ],
      },
      mask: {
        type: "string",
        description:
          "Optional B/W mask: white = region to redraw, black = keep. " +
          "When provided the edit runs in inpaint mode (DashScope models).",
        mediaKind: "image",
      },
      n: {
        type: "integer",
        description: "Number of images to generate (1–10).",
      },
      size: {
        type: "string",
        description: "Output image size, e.g. 1024x1024 (model-dependent).",
      },
      reference_images: {
        type: "array",
        description:
          "Optional reference images for style/character consistency. " +
          "Main image + mask + reference images must total ≤ 3 (DashScope limit).",
        items: {
          type: "string",
          mediaKind: "image",
        },
        mediaKind: "image",
      },
      response_format: {
        type: "string",
        enum: ["url", "b64_json"],
        description: "Output format. OpenAI models only.",
      },
    },
    required: ["image", "prompt"],
    additionalProperties: false,
  },

  defaultModel: "gpt-image-2",

  // 业务必选项:缺失时经 ctx.ui 交互补全(model/size 选择,prompt 输入)。
  requiredParams: [
    { param: "model", via: "select", title: "选择编辑模型", options: ["$models"] },
    {
      param: "size",
      via: "select",
      title: "选择输出尺寸",
      options: ["1024x1024", "1536x1024", "1024x1536", "auto"],
      fallback: "auto",
    },
    {
      param: "prompt",
      via: "input",
      title: "输入编辑指令",
      placeholder: "用你的语言描述要做的修改(不会被翻译)",
    },
  ],

  models: [
    // ── NewAPI(OpenAI 兼容 edits;整图改写;默认,经验证可用)──────────────────
    createNewApiImageEdit(
      {
        model: "gpt-image-2",
        label: "GPT Image 2 · NewAPI",
        description:
          "OpenAI-compatible gpt-image editing via NewAPI gateway. Whole-image rewrite. Needs NEWAPI_API_KEY.",
      },
      { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
    ),

    // ── DashScope mask-aware(局部重绘精准)────────────────────────────────────
    createDashscopeImageEdit(
      {
        model: "qwen-image-edit-max",
        label: "Qwen Image Edit Max · sync",
        description:
          "Best edit fidelity; supports mask inpainting and reference images. Needs DASHSCOPE_API_KEY.",
        providerModel: DASHSCOPE_MODELS.qwenImageEditMax,
      },
      { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
    ),
  ],
};
