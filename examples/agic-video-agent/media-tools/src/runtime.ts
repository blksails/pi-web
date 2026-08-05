/**
 * `@aigc-agent/media-tools/runtime` 子入口 —— **执行层(node-only)**。
 *
 * 含 pi SDK 值导入(Type / ExtensionAPI)与 node-only 执行(ffmpeg 子进程、attachment store),
 * 仅经此子入口加载,不进前端 bundle。agent 经 `extensions:[…]` 装载扩展工厂即可。
 */

// ── 扩展工厂(装载入口)────────────────────────────────────────────────────────
export {
  ffmpegToolsExtension,
  videoToolsExtension,
  ttsToolsExtension,
  mediaToolsExtension,
} from "./extensions.js";

// ── 逐工具注册函数(需要挑选子集时)──────────────────────────────────────────────
export {
  registerFfmpegTools,
  registerAudioExtract,
  registerVideoConcat,
  registerVideoClip,
  registerVideoToGif,
  registerVideoExtractFrame,
  registerVideoWithAudio,
  registerVideoTranscode,
} from "./tools/ffmpeg-tools.js";
export {
  registerVideoTools,
  registerTextToVideo,
  registerImageToVideo,
  registerMultimodalReferenceVideo,
  registerVideoEdit,
  registerDigitalHumanVideo,
} from "./tools/video-tools.js";
export { registerTextToSpeech } from "./tools/audio-tools.js";

// ── 编排器 + 落库(供自定义媒体工具复用)────────────────────────────────────────
export { runMediaTool, buildModelsDescription, optionalModelEnum } from "./run-media-tool.js";
export type { RunMediaToolOptions } from "./run-media-tool.js";
export { persistMedia } from "./persist-media.js";
export type { PersistMediaResult } from "./persist-media.js";

// ── provider 路由表(供组装自定义工具)──────────────────────────────────────────
export {
  DASHSCOPE_T2V_ROUTES,
  DASHSCOPE_I2V_ROUTES,
  DASHSCOPE_R2V_ROUTES,
  DASHSCOPE_VIDEO_EDIT_ROUTES,
  DASHSCOPE_S2V_ROUTES,
} from "./providers/dashscope-video.js";
export { SEEDANCE_I2V_ROUTES, SEEDANCE_MULTIMODAL_ROUTES } from "./providers/ark-seedance.js";
export { DASHSCOPE_TTS_ROUTES } from "./providers/dashscope-audio.js";
export { ffmpegRoute, ffmpegRunLocal } from "./providers/local-ffmpeg.js";

// ── 类型 ─────────────────────────────────────────────────────────────────────
export type {
  MediaProviderId,
  MediaKind,
  MediaRoute,
  MediaAsset,
  MediaToolDetails,
  InteractionParam,
} from "./media-types.js";
