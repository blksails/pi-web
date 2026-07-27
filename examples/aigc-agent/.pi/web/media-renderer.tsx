/**
 * agents/aigc 媒体工具渲染器(Tier2)——渲染 @aigc-agent/media-tools 的 13 个工具产物。
 *
 * ★ 卡壳取本源 `./tool-card`(自绘 ToolShell:可折叠头 + 状态徽章 + 明细区,DOM/data-* 锚点与
 *   vendor PiToolPart 一致),媒体网格渲染在壳内。`.pi/web` 不得依赖 `@blksails/pi-web-ui`
 *   ——非宿主 import map 单例,bundle 进扩展既违纪律又(streamdown → katex 字体)构建失败。
 * 结果 `details = { ok, kind, assets:[{attachmentId,displayUrl,mimeType,name}] }`;details 不到前端时
 * 从 content 的 `![name](displayUrl)` 兜底解析,kind 再由 mimeType/扩展名判定。
 * video → <video controls>;audio → <audio controls>;image(gif/截帧亦然)→ <img> + 点击进画布。
 * 媒体永远以 displayUrl 引用,绝不进 base64。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import {
  MediaGrid,
  ToolShell,
  extractAssets,
  phaseOf,
  plainText,
  type PartLike,
} from "./tool-card.js";

function AigcMediaRenderer({ part }: { part: PartLike; message?: unknown }): React.JSX.Element {
  const phase = phaseOf(part);
  const assets = React.useMemo(
    () => (phase === "end" || phase === "update" ? extractAssets(part.output) : []),
    [part.output, phase],
  );
  const text = plainText(part.output);
  const errText = typeof part.errorText === "string" ? part.errorText : "";
  const details = (part.output as { details?: unknown } | null | undefined)?.details;

  return (
    <ToolShell part={part} testId="aigc-media-card">
      {phase === "error" ? (
        <div className="text-xs">{errText || text || "失败"}</div>
      ) : (
        <div className="space-y-2">
          {/* 有产物 → 媒体网格;无产物但有文本(如「生成失败:…」)→ 显示文本 */}
          {assets.length > 0 ? (
            <MediaGrid assets={assets} />
          ) : text !== "" ? (
            <div className="text-xs text-[hsl(var(--foreground))]">{text}</div>
          ) : null}
          {details !== undefined ? (
            <details className="text-[11px]">
              <summary className="cursor-pointer select-none text-[hsl(var(--muted-foreground))]">
                详情
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 font-mono text-[10px]">
                {JSON.stringify(details, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      )}
    </ToolShell>
  );
}

/** 本包 13 个工具名 → 同一媒体渲染器。 */
const MEDIA_TOOL_NAMES = [
  "text_to_video",
  "image_to_video",
  "multimodal_reference_video",
  "video_edit",
  "digital_human_video",
  "text_to_speech",
  "audio_extract",
  "video_concat",
  "video_clip",
  "video_to_gif",
  "video_extract_frame",
  "video_with_audio",
  "video_transcode",
] as const;

const toolRenderers: Record<string, unknown> = {};
for (const name of MEDIA_TOOL_NAMES) toolRenderers[name] = AigcMediaRenderer as never;

/** 仅渲染器面(renderers.tools),供源自身 web.config 合并。 */
export const mediaRendererExtension = defineWebExtension({
  manifestId: "aigc-media-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: toolRenderers as never,
  },
});
