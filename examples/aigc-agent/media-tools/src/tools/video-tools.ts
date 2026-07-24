/**
 * 视频生成工具注册(端口自 pi-labs 视频 category:text_to_video / image_to_video /
 * multimodal_reference_video / video_edit / digital_human_video)。
 *
 * 每个工具 execute 委托 {@link runMediaTool};多 provider(DashScope + Seedance)由 model 枚举选路。
 * 环境闸:需 DASHSCOPE_API_KEY / ARK_API_KEY,缺失时工具运行期报「能力不可用」。
 */
import { Type } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runMediaTool, buildModelsDescription, optionalModelEnum } from "../run-media-tool.js";
import type { InteractionParam, MediaRoute, MediaToolDetails } from "../media-types.js";
import {
  DASHSCOPE_T2V_ROUTES,
  DASHSCOPE_I2V_ROUTES,
  DASHSCOPE_R2V_ROUTES,
  DASHSCOPE_VIDEO_EDIT_ROUTES,
  DASHSCOPE_S2V_ROUTES,
} from "../providers/dashscope-video.js";
import { SEEDANCE_I2V_ROUTES, SEEDANCE_MULTIMODAL_ROUTES } from "../providers/ark-seedance.js";

type Emit = ((p: AgentToolResult<MediaToolDetails>) => void) | undefined;

const RESOLUTION = Type.Optional(
  Type.Union([Type.Literal("480p"), Type.Literal("720p"), Type.Literal("1080p")], {
    description: "分辨率,默认 720p(部分模型仅 720P/1080P)。",
  }),
);
const RATIO = Type.Optional(
  Type.Union(
    [Type.Literal("16:9"), Type.Literal("9:16"), Type.Literal("1:1"), Type.Literal("4:3"), Type.Literal("3:4"), Type.Literal("21:9")],
    { description: "画面比例,默认 16:9。部分新模型由首帧/参考决定,会忽略此字段。" },
  ),
);
const DURATION = Type.Optional(Type.Integer({ description: "时长秒,默认 5。" }));
const SEED = Type.Optional(Type.Integer({ description: "随机种子;-1/省略=随机。" }));
const NEGATIVE = Type.Optional(Type.String({ description: "负向提示(排除内容/风格)。" }));

function register(
  pi: ExtensionAPI,
  spec: {
    name: string;
    label: string;
    baseDescription: string;
    fields: Record<string, TSchema>;
    routes: readonly MediaRoute[];
    defaultModel: string;
    requiredParams: readonly InteractionParam[];
    imageInputFields?: readonly string[];
    urlInputFields?: readonly string[];
  },
): void {
  pi.registerTool({
    name: spec.name,
    label: spec.label,
    description: buildModelsDescription(spec.baseDescription, spec.routes, spec.defaultModel),
    parameters: Type.Object({ ...spec.fields, model: optionalModelEnum(spec.routes, spec.defaultModel) }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const emit = typeof onUpdate === "function" ? (onUpdate as Emit) : undefined;
      return runMediaTool(params, ctx, signal, emit, {
        toolName: spec.name,
        routes: spec.routes,
        defaultModel: spec.defaultModel,
        requiredParams: spec.requiredParams,
        imageInputFields: spec.imageInputFields,
        urlInputFields: spec.urlInputFields,
      });
    },
  });
}

// 不再对 model/prompt 弹 ctx.ui 模态:model 缺省走 defaultModel、由 pill 选;prompt 是 schema 必填由
// LLM 提供。此前每次视频工具调用都弹「选择生成模型」模态(且多工具时层叠),是 UX 噪声,移除。
const NO_MODALS: readonly InteractionParam[] = [];

export function registerTextToVideo(pi: ExtensionAPI): void {
  register(pi, {
    name: "text_to_video",
    label: "Text → video",
    baseDescription: "从文字 prompt 生成视频。返回视频 att_ 引用(以及可用的末帧,便于拼接更长视频)。",
    fields: {
      prompt: Type.String({ description: "画面/动作/运镜/情绪描述(用户原语言,勿翻译)。" }),
      negative_prompt: NEGATIVE,
      duration: DURATION,
      resolution: RESOLUTION,
      ratio: RATIO,
      seed: SEED,
    },
    routes: DASHSCOPE_T2V_ROUTES,
    defaultModel: "wan2.7-t2v-2026-04-25",
    requiredParams: NO_MODALS,
  });
}

export function registerImageToVideo(pi: ExtensionAPI): void {
  register(pi, {
    name: "image_to_video",
    label: "Image → video",
    baseDescription:
      "首帧(+可选尾帧)驱动生成视频。first_frame_url 传 att_ 引用或图 URL;返回视频 + 末帧(可作下次 first_frame_url 拼长视频)。",
    fields: {
      prompt: Type.String({ description: "动作/运镜/情绪描述。" }),
      first_frame_url: Type.String({ description: "首帧图:att_ 引用或图 URL。" }),
      last_frame_url: Type.Optional(Type.String({ description: "可选尾帧图(首→尾插值)。" })),
      negative_prompt: NEGATIVE,
      duration: DURATION,
      resolution: RESOLUTION,
      ratio: RATIO,
      seed: SEED,
    },
    routes: [...DASHSCOPE_I2V_ROUTES, ...SEEDANCE_I2V_ROUTES],
    defaultModel: "wan2.7-i2v-2026-04-25",
    requiredParams: NO_MODALS,
    imageInputFields: ["first_frame_url", "last_frame_url"],
  });
}

export function registerMultimodalReferenceVideo(pi: ExtensionAPI): void {
  register(pi, {
    name: "multimodal_reference_video",
    label: "Multimodal → video",
    baseDescription:
      "多模态参考(参考图/参考视频/参考音频)起手生成视频,无首/尾帧。至少提供一组参考。",
    fields: {
      prompt: Type.String({ description: "生成意图描述,可引用「图1/视频2」等。" }),
      reference_image_urls: Type.Optional(Type.Array(Type.String(), { description: "参考图 att_/URL 数组。" })),
      reference_video_urls: Type.Optional(Type.Array(Type.String(), { description: "参考视频 URL 数组。" })),
      reference_audio_urls: Type.Optional(Type.Array(Type.String(), { description: "参考音频/角色音色 URL 数组(每段 ≤15s)。" })),
      duration: DURATION,
      resolution: RESOLUTION,
      ratio: RATIO,
      seed: SEED,
    },
    routes: [...DASHSCOPE_R2V_ROUTES, ...SEEDANCE_MULTIMODAL_ROUTES],
    defaultModel: "wan2.7-r2v",
    requiredParams: NO_MODALS,
    imageInputFields: ["reference_image_urls"],
    urlInputFields: ["reference_video_urls", "reference_audio_urls"],
  });
}

export function registerVideoEdit(pi: ExtensionAPI): void {
  register(pi, {
    name: "video_edit",
    label: "Video edit",
    baseDescription:
      "对已有视频做指令编辑(风格/动作改写)或局部替换(给 reference_image_url)。720P,时长/比例由源视频决定。",
    fields: {
      prompt: Type.String({ description: "编辑指令。" }),
      video_url: Type.String({ description: "源视频:att_ 引用或视频 URL。" }),
      reference_image_url: Type.Optional(Type.String({ description: "可选参考图(局部替换用)。" })),
      seed: SEED,
    },
    routes: DASHSCOPE_VIDEO_EDIT_ROUTES,
    defaultModel: "wan2.7-videoedit",
    requiredParams: NO_MODALS,
    imageInputFields: ["reference_image_url"],
    urlInputFields: ["video_url"],
  });
}

export function registerDigitalHumanVideo(pi: ExtensionAPI): void {
  register(pi, {
    name: "digital_human_video",
    label: "Digital human",
    baseDescription:
      "人像图 + 驱动音频 → 对口型数字人视频。audio_url 可用 text_to_speech 的产物 att_。480P/720P。",
    fields: {
      image_url: Type.String({ description: "人像图:att_ 引用或图 URL(清晰单人正脸)。" }),
      audio_url: Type.String({ description: "驱动音频:att_ 引用或音频 URL。" }),
      resolution: Type.Optional(
        Type.Union([Type.Literal("480p"), Type.Literal("720p")], { description: "分辨率,默认 480p。" }),
      ),
    },
    routes: DASHSCOPE_S2V_ROUTES,
    defaultModel: "wan2.2-s2v",
    requiredParams: NO_MODALS,
    imageInputFields: ["image_url"],
    urlInputFields: ["audio_url"],
  });
}

/** 注册全部视频生成工具。 */
export function registerVideoTools(pi: ExtensionAPI): void {
  registerTextToVideo(pi);
  registerImageToVideo(pi);
  registerMultimodalReferenceVideo(pi);
  registerVideoEdit(pi);
  registerDigitalHumanVideo(pi);
}
