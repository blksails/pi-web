/**
 * 媒体工具的进程内 ExtensionFactory —— 任意 pi-web agent 经 `AgentDefinition.extensions:[…]`
 * 装载即得到对应工具族。与 tool-kit `aigcExtension` 形态一致。
 *
 * 分族装载(按需):
 *  - {@link ffmpegToolsExtension}  本地 ffmpeg 后处理(含 audio_extract)—— 无 key、可离线。
 *  - {@link videoToolsExtension}   视频生成(DashScope + Seedance)—— 需 DASHSCOPE_API_KEY / ARK_API_KEY。
 *  - {@link ttsToolsExtension}     TTS(CosyVoice,scaffold 未接入 WS)。
 *  - {@link mediaToolsExtension}   全部 13 个工具,每个只注册一次。
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerFfmpegTools } from "./tools/ffmpeg-tools.js";
import { registerVideoTools } from "./tools/video-tools.js";
import { registerTextToSpeech } from "./tools/audio-tools.js";

/** 本地 ffmpeg 后处理:video_concat/clip/to-gif/extract-frame/with-audio/transcode + audio_extract。 */
export const ffmpegToolsExtension: ExtensionFactory = (pi) => {
  registerFfmpegTools(pi);
};

/** 视频生成:text_to_video / image_to_video / multimodal_reference_video / video_edit / digital_human_video。 */
export const videoToolsExtension: ExtensionFactory = (pi) => {
  registerVideoTools(pi);
};

/** TTS:text_to_speech(audio_extract 归 ffmpeg 族,避免重复注册)。 */
export const ttsToolsExtension: ExtensionFactory = (pi) => {
  registerTextToSpeech(pi);
};

/** 全部媒体工具(视频生成 + TTS + 本地 ffmpeg),每个工具只注册一次。 */
export const mediaToolsExtension: ExtensionFactory = (pi) => {
  registerVideoTools(pi);
  registerTextToSpeech(pi);
  registerFfmpegTools(pi);
};
