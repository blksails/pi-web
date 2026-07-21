/**
 * `@aigc-agent/media-tools` 主入口 —— **声明层(前端安全)**。
 *
 * 仅导出纯数据/类型:禁止从此入口直接/间接顶层 import pi SDK(Type/ExtensionAPI)、undici、
 * node-only API——执行层(extensions / runMediaTool / providers)一律走 `./runtime` 子入口,
 * 守住前端 bundle 边界(与 tool-kit 同款分层)。
 */
import type { SlashCompletionDecl } from "@blksails/pi-web-agent-kit";

export type {
  MediaProviderId,
  MediaKind,
  MediaRoute,
  MediaAsset,
  MediaToolDetails,
  InteractionParam,
} from "./media-types.js";

/** 本包提供的全部工具名(供宿主 UI 枚举 / 渲染器判别 / 文档)。 */
export const MEDIA_TOOL_NAMES = [
  // 视频生成
  "text_to_video",
  "image_to_video",
  "multimodal_reference_video",
  "video_edit",
  "digital_human_video",
  // TTS
  "text_to_speech",
  // 本地 ffmpeg 后处理
  "audio_extract",
  "video_concat",
  "video_clip",
  "video_to_gif",
  "video_extract_frame",
  "video_with_audio",
  "video_transcode",
] as const;

export type MediaToolName = (typeof MEDIA_TOOL_NAMES)[number];

/** slash 补全候选:选中只填入不执行,由 systemPrompt 驱动 LLM 调对应工具。 */
export const mediaSlashCompletions: SlashCompletionDecl[] = [
  { name: "t2v", description: "文生视频(text_to_video)", insertText: "/t2v " },
  { name: "i2v", description: "图生视频:首帧驱动(image_to_video)", insertText: "/i2v " },
  { name: "tts", description: "文本转语音(text_to_speech)", insertText: "/tts " },
  { name: "gif", description: "视频转 GIF(video_to_gif)", insertText: "/gif " },
  { name: "clip", description: "截取视频区间(video_clip)", insertText: "/clip " },
];
