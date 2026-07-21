/**
 * agents/aigc 媒体工具渲染器(Tier2)——渲染 @aigc-agent/media-tools 的 13 个工具产物。
 *
 * ★ 复用 **vendor 工具卡壳**(ToolHeader + ToolContent + Card 式外框:可折叠头 + Completed 状态徽章),
 *   媒体网格渲染在壳内——不再自建卡片/自定义折叠+tab(承接用户诉求:产出物保留 vendor 卡壳)。
 * 结果 `details = { ok, kind, assets:[{attachmentId,displayUrl,mimeType,name}] }`;details 不到前端时
 * 从 content 的 `![name](displayUrl)` 兜底解析,kind 再由 mimeType/扩展名判定。
 * video → <video controls>;audio → <audio controls>;image(gif/截帧亦然)→ <img> + 点击进画布。
 * 媒体永远以 displayUrl 引用,绝不进 base64。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import { ToolHeader, ToolContent, type ToolPhase } from "@blksails/pi-web-ui";

type Kind = "image" | "video" | "audio";

interface Asset {
  readonly name: string;
  readonly src: string;
  readonly mimeType: string;
  readonly attId: string | undefined;
  readonly kind: Kind;
}

const IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function attIdFromUrl(url: string): string | undefined {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}

function kindFromMime(mime: string, url: string): Kind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov)$/.test(lower)) return "video";
  if (/\.(mp3|wav|aac|m4a|ogg)$/.test(lower)) return "audio";
  return "image";
}

/** 从 tool part 抽出资产:优先 details.assets(带 mimeType),兜底解析 content 的 markdown。 */
function extractAssets(output: unknown): Asset[] {
  if (output && typeof output === "object") {
    const details = (output as { details?: unknown }).details as { assets?: unknown } | undefined;
    if (details && Array.isArray(details.assets)) {
      const out: Asset[] = [];
      for (const a of details.assets) {
        const x = a as { name?: unknown; displayUrl?: unknown; mimeType?: unknown; attachmentId?: unknown };
        if (typeof x.displayUrl !== "string") continue;
        const mime = typeof x.mimeType === "string" ? x.mimeType : "";
        out.push({
          name: typeof x.name === "string" ? x.name : "",
          src: x.displayUrl,
          mimeType: mime,
          attId: typeof x.attachmentId === "string" && x.attachmentId ? x.attachmentId : attIdFromUrl(x.displayUrl),
          kind: kindFromMime(mime, x.displayUrl),
        });
      }
      if (out.length > 0) return out;
    }
  }
  const text = extractText(output);
  const out: Asset[] = [];
  IMG_MD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_MD_RE.exec(text)) !== null) {
    const src = (m[2] ?? "").trim();
    if (src === "") continue;
    out.push({ name: m[1] ?? "", src, mimeType: "", attId: attIdFromUrl(src), kind: kindFromMime("", src) });
  }
  return out;
}

function joinTextParts(parts: ReadonlyArray<unknown>): string {
  return parts
    .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}
function extractText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return joinTextParts(output);
  if (output && typeof output === "object") {
    const o = output as { content?: unknown };
    if (o.content !== undefined) return extractText(o.content);
  }
  return "";
}
/** 剥掉图片 markdown 后的纯文本(headline / 错误信息)。 */
function plainText(output: unknown): string {
  return extractText(output).replace(IMG_MD_RE, "").replace(/\n{2,}/g, "\n").trim();
}

function openInCanvas(attId: string | undefined): void {
  if (attId === undefined) return;
  document.dispatchEvent(new CustomEvent("aigc-open-canvas-asset", { detail: { attachmentId: attId } }));
}

async function downloadOne(src: string, name: string): Promise<void> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name !== "" ? name : "media";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(src, "_blank", "noreferrer");
  }
}

function MediaCell({ asset }: { asset: Asset }): React.JSX.Element {
  return (
    <div className="aigc-imgcard-cell">
      {asset.kind === "video" ? (
        <video src={asset.src} controls preload="metadata" style={{ maxWidth: "100%", borderRadius: 6, display: "block" }} />
      ) : asset.kind === "audio" ? (
        <audio src={asset.src} controls preload="metadata" style={{ width: "100%" }} />
      ) : (
        <img
          src={asset.src}
          alt={asset.name}
          loading="lazy"
          decoding="async"
          title={asset.attId !== undefined ? "点击在画布打开" : asset.name}
          onClick={() => openInCanvas(asset.attId)}
          style={{ maxWidth: "100%", borderRadius: 6, display: "block", cursor: asset.attId ? "pointer" : "default" }}
          {...(asset.attId !== undefined ? { "data-att-id": asset.attId } : {})}
        />
      )}
      <div className="aigc-imgcard-acts">
        {asset.kind === "image" && asset.attId !== undefined ? (
          <button type="button" onClick={() => openInCanvas(asset.attId)} title="在画布打开">画布</button>
        ) : null}
        <button type="button" onClick={() => void downloadOne(asset.src, asset.name)} title="下载">下载</button>
      </div>
      {asset.name !== "" ? (
        <span className="aigc-imgcard-name" title={asset.name}>{asset.name}</span>
      ) : null}
    </div>
  );
}

// ── phase / name 推导(与 vendor pi-tool-part 同逻辑;未从 ui 主入口导出,本地复刻)──────
type PartLike = {
  readonly type?: unknown;
  readonly state?: unknown;
  readonly output?: unknown;
  readonly errorText?: unknown;
  readonly preliminary?: unknown;
  readonly toolName?: unknown;
  readonly [k: string]: unknown;
};

function phaseOf(part: PartLike): ToolPhase {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "start";
    case "output-error":
      return "error";
    case "output-available":
      return part.preliminary === true ? "update" : "end";
    default:
      return "start";
  }
}
function nameOf(part: PartLike): string {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : "tool";
  return typeof part.type === "string" ? part.type.slice("tool-".length) : "tool";
}

function AigcMediaRenderer({ part }: { part: PartLike; message?: unknown }): React.JSX.Element {
  const phase = phaseOf(part);
  const name = nameOf(part);
  const isError = phase === "error";
  const contentId = React.useId();
  // 终态/流式默认展开;用户手动切换后接管(与 vendor PiToolPart 同款)。
  const autoOpen = phase === "update" || phase === "end" || phase === "error";
  const [override, setOverride] = React.useState<boolean | null>(null);
  const open = override ?? autoOpen;

  const assets = React.useMemo(() => (phase === "end" || phase === "update" ? extractAssets(part.output) : []), [part.output, phase]);
  const text = plainText(part.output);
  const errText = typeof part.errorText === "string" ? part.errorText : "";
  const details = (part.output as { details?: unknown } | null | undefined)?.details;

  return (
    <div
      className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]"
      data-pi-tool
      data-pi-tool-phase={phase}
      data-pi-tool-name={name}
      data-testid="aigc-media-card"
    >
      <ToolHeader
        name={name}
        phase={phase}
        open={open}
        contentId={contentId}
        onToggle={() => setOverride(!open)}
        timerLabel={null}
      />
      <ToolContent id={contentId} open={open} isError={isError}>
        {isError ? (
          <div className="text-xs text-[hsl(var(--destructive))]">{errText || text || "失败"}</div>
        ) : (
          <div className="space-y-2">
            {/* 有产物 → 媒体网格;无产物但有文本(如「生成失败:…」)→ 显示文本 */}
            {assets.length > 0 ? (
              <div className="aigc-imgcard">
                <div className="aigc-imgcard-grid">
                  {assets.map((a, i) => (
                    <MediaCell key={`${i}-${a.src.slice(-24)}`} asset={a} />
                  ))}
                </div>
              </div>
            ) : text !== "" ? (
              <div className="text-xs text-[hsl(var(--foreground))]">{text}</div>
            ) : null}
            {details !== undefined ? (
              <details className="text-[11px]">
                <summary className="cursor-pointer select-none text-[hsl(var(--muted-foreground))]">详情</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 font-mono text-[10px]">
                  {JSON.stringify(details, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        )}
      </ToolContent>
    </div>
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
