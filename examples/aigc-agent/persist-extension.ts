/**
 * aigcPersistExtension — 生成产物落库 + 台账(P0-B B5 · 子进程侧,零改 vendor)。
 *
 * vendor aigcExtension 的 image_generation/image_edit 内部把图落 attachment(会话画廊已工作),
 * 但**不落业务持久层**(aigc_assets 素材库 / aigc_generations 台账)。SDK 的 `tool_execution_end`
 * 事件在工具结束时带 `result.details.assets`(见 tool-kit buildImageResult:{attachmentId,displayUrl,
 * mimeType,name} + model),正是承接 seam:成功 → 每张 putAsset + 记一条台账;失败 → 记 error 台账。
 *
 * 经 @aigc-agent/platform-client 走回调(父进程持 Supabase);sessionId 由父进程从回调 token 的
 * sid 兜底,故此处无需知会话 id。平台不可用(无 token / stub / 离线)则整体静默跳过。
 * 一切 best-effort:绝不 throw 进 agent loop(落库失败比中断生成更可接受)。
 */
import { getPlatformContext } from "./platform-client.js";

/** 工具名 → 台账 category(与 pi-labs 命名一致)。含 vendor 图像工具 + @aigc-agent/media-tools 全族。 */
const CATEGORY: Record<string, string> = {
  // vendor tool-kit 图像
  image_generation: "text_to_image",
  image_edit: "image_edit",
  // @aigc-agent/media-tools:视频生成 / TTS / 本地 ffmpeg —— 落库 kind 取 details.kind。
  text_to_video: "text_to_video",
  image_to_video: "image_to_video",
  multimodal_reference_video: "multimodal_reference_video",
  video_edit: "video_edit",
  digital_human_video: "digital_human_video",
  text_to_speech: "text_to_speech",
  audio_extract: "audio_extract",
  video_concat: "video_concat",
  video_clip: "video_clip",
  video_to_gif: "video_to_gif",
  video_extract_frame: "video_extract_frame",
  video_with_audio: "video_with_audio",
  video_transcode: "video_transcode",
};

interface ToolEndEvent {
  readonly toolName: string;
  readonly isError: boolean;
  readonly result?: {
    readonly details?: {
      readonly ok?: boolean;
      readonly model?: string;
      /** media-tools 结果携带产出类别(image/video/audio);vendor 图像工具无此字段 → 默认 image。 */
      readonly kind?: "image" | "video" | "audio";
      readonly assets?: ReadonlyArray<{
        readonly attachmentId?: string;
        readonly displayUrl?: string;
        readonly mimeType?: string;
        readonly name?: string;
      }>;
    };
  };
}

/** 只需 `on("tool_execution_end", …)`;用最小结构避免引入 SDK 重类型。 */
interface PiLike {
  on(event: string, handler: (ev: ToolEndEvent) => void): void;
}

export function aigcPersistExtension(pi: PiLike): void {
  pi.on("tool_execution_end", (ev) => {
    const category = CATEGORY[ev.toolName];
    if (category === undefined) return; // 只关心 AIGC 图像工具

    const platform = getPlatformContext();
    if (!platform.available) return; // 无回调 token → 静默跳过(现状会话画廊仍工作)

    const details = ev.result?.details;
    const variant =
      typeof details?.model === "string" ? details.model : ev.toolName;

    if (ev.isError || details?.ok !== true) {
      void platform
        .recordGeneration({ category, variant, status: "error", outputCount: 0 })
        .catch(() => {});
      return;
    }

    const kind = details.kind === "video" || details.kind === "audio" ? details.kind : "image";
    const assets = Array.isArray(details.assets) ? details.assets : [];
    for (const a of assets) {
      if (typeof a?.attachmentId !== "string" || typeof a?.displayUrl !== "string") {
        continue;
      }
      void platform
        .putAsset({
          attachmentId: a.attachmentId,
          displayUrl: a.displayUrl,
          kind,
          meta: {
            model: variant,
            category,
            variant,
            ...(typeof a.name === "string" ? { name: a.name } : {}),
            ...(typeof a.mimeType === "string" ? { mimeType: a.mimeType } : {}),
          },
        })
        .catch(() => {});
    }
    void platform
      .recordGeneration({
        category,
        variant,
        status: "success",
        outputCount: assets.length,
      })
      .catch(() => {});
  });
}
