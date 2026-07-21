/**
 * 本地 ffmpeg 后处理工具注册(端口自 pi-labs 6 个 ffmpeg category + audio_extract)。
 *
 * 每个工具 = 一个单一 `local-ffmpeg` route(无 model 选择),execute 委托 {@link runMediaTool}。
 * 无外部 provider key、纯本机执行 → 这一族是整个包最可离线验证的锚点。
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runMediaTool } from "../run-media-tool.js";
import type { MediaRoute, MediaToolDetails } from "../media-types.js";
import { ffmpegRoute, ffmpegRunLocal } from "../providers/local-ffmpeg.js";

type Emit = ((p: AgentToolResult<MediaToolDetails>) => void) | undefined;

/** 单 route 本地工具的通用注册:装配 parameters + execute → runMediaTool。 */
function registerLocalTool(
  pi: ExtensionAPI,
  spec: {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    route: MediaRoute;
    /** att_→本地路径解析的音视频字段(ffmpeg 本地消费)。 */
    localFileFields: readonly string[];
  },
): void {
  pi.registerTool({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
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
        routes: [spec.route],
        defaultModel: spec.route.model,
        requiredParams: [],
        localFileFields: spec.localFileFields,
      });
    },
  });
}

const VIDEO_URL = Type.String({
  description: "源视频 URL(http/https)或对话中的 [attachment id=att_…] 引用,逐字复制。",
});

export function registerAudioExtract(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "audio_extract",
    label: "Audio extract",
    description:
      "从已有视频提取音轨为可播放音频(mp3/aac/wav)。整段提取、仅第一条音轨;不支持时间区间外的多轨分离、不做 ASR。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      format: Type.Optional(
        Type.Union([Type.Literal("mp3"), Type.Literal("aac"), Type.Literal("wav")], {
          description: "输出格式,默认 mp3(192kbps)。",
        }),
      ),
      clip_seconds: Type.Optional(
        Type.Integer({ description: "截取前 N 秒;0/省略=整段。上限 300。" }),
      ),
    }),
    route: ffmpegRoute("ffmpeg-extract-audio", "本地 ffmpeg · 音轨提取", "本机 ffmpeg 子进程,mp3/aac/wav 整段提取。", ffmpegRunLocal.audioExtract),
    localFileFields: ["video_url"],
  });
}

export function registerVideoConcat(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_concat",
    label: "Video concat",
    description:
      "按顺序拼接多段视频(demuxer copy 模式,要求同 codec/timebase)。2–9 段,输出 mp4。",
    parameters: Type.Object({
      video_urls: Type.Array(Type.String(), {
        description: "待拼接的视频 URL / att_ 引用数组(顺序即拼接顺序),2–9 个。",
      }),
    }),
    route: ffmpegRoute("ffmpeg-concat", "本地 ffmpeg · 视频拼接", "demuxer copy,零编码最快。", ffmpegRunLocal.videoConcat),
    localFileFields: ["video_urls"],
  });
}

export function registerVideoClip(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_clip",
    label: "Video clip",
    description: "截取视频时间区间(stream copy,秒级精度),输出 mp4。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      start_seconds: Type.Optional(Type.Integer({ description: "起始秒,默认 0。" })),
      duration_seconds: Type.Optional(Type.Integer({ description: "时长秒,默认 10,上限 600。" })),
    }),
    route: ffmpegRoute("ffmpeg-clip", "本地 ffmpeg · 区间截取", "stream copy 秒级截取。", ffmpegRunLocal.videoClip),
    localFileFields: ["video_url"],
  });
}

export function registerVideoToGif(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_to_gif",
    label: "Video → GIF",
    description: "把视频区间转 GIF(lanczos 缩放)。默认前 5s / 10fps / 480 宽。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      start_seconds: Type.Optional(Type.Integer({ description: "起始秒,默认 0。" })),
      duration_seconds: Type.Optional(Type.Integer({ description: "时长秒,默认 5,上限 30。" })),
      fps: Type.Optional(Type.Integer({ description: "帧率,默认 10,上限 30。" })),
      width: Type.Optional(Type.Integer({ description: "宽度像素,默认 480,高度按比例。" })),
    }),
    route: ffmpegRoute("ffmpeg-to-gif", "本地 ffmpeg · 转 GIF", "区间 + fps/宽度限制。", ffmpegRunLocal.videoToGif),
    localFileFields: ["video_url"],
  });
}

export function registerVideoExtractFrame(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_extract_frame",
    label: "Extract frame",
    description: "截取任意时间点的静帧为 PNG(精确 seek,近无损)。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      timestamp_seconds: Type.Optional(Type.Number({ description: "截帧时间点(秒),默认 0。" })),
    }),
    route: ffmpegRoute("ffmpeg-extract-frame", "本地 ffmpeg · 截帧", "单帧 PNG,q:v 2。", ffmpegRunLocal.videoExtractFrame),
    localFileFields: ["video_url"],
  });
}

export function registerVideoWithAudio(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_with_audio",
    label: "Video + audio",
    description: "给视频套音轨:replace(换轨,默认)或 mix(混音)。视频零编码,音轨转 aac。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      audio_url: Type.String({ description: "音频 URL / att_ 引用。" }),
      mode: Type.Optional(
        Type.Union([Type.Literal("replace"), Type.Literal("mix")], { description: "replace(默认)/ mix。" }),
      ),
    }),
    route: ffmpegRoute("ffmpeg-with-audio", "本地 ffmpeg · 套音轨", "replace/mix 两模式。", ffmpegRunLocal.videoWithAudio),
    localFileFields: ["video_url", "audio_url"],
  });
}

export function registerVideoTranscode(pi: ExtensionAPI): void {
  registerLocalTool(pi, {
    name: "video_transcode",
    label: "Video transcode",
    description: "压缩/转码:resolution(keep/480p/720p/1080p)+ codec(libx264/libx265/libvpx-vp9)+ crf(18–28)。",
    parameters: Type.Object({
      video_url: VIDEO_URL,
      resolution: Type.Optional(
        Type.Union([Type.Literal("keep"), Type.Literal("480p"), Type.Literal("720p"), Type.Literal("1080p")], {
          description: "目标分辨率,默认 keep。",
        }),
      ),
      codec: Type.Optional(
        Type.Union([Type.Literal("libx264"), Type.Literal("libx265"), Type.Literal("libvpx-vp9")], {
          description: "编码器,默认 libx264;vp9 输出 webm。",
        }),
      ),
      crf: Type.Optional(Type.Integer({ description: "质量因子 18–28,越小越清晰,默认 23。" })),
    }),
    route: ffmpegRoute("ffmpeg-transcode", "本地 ffmpeg · 转码", "resolution/codec/crf。", ffmpegRunLocal.videoTranscode),
    localFileFields: ["video_url"],
  });
}

/** 注册全部本地 ffmpeg 工具。 */
export function registerFfmpegTools(pi: ExtensionAPI): void {
  registerAudioExtract(pi);
  registerVideoConcat(pi);
  registerVideoClip(pi);
  registerVideoToGif(pi);
  registerVideoExtractFrame(pi);
  registerVideoWithAudio(pi);
  registerVideoTranscode(pi);
}
