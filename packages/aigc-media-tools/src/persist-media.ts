/**
 * 泛化的媒体产物落库(image / video / audio)。
 *
 * 为何自写而非复用 tool-kit `persistPicked`:后者是 "Wave 1 image-only"——对 `video`/`audio`
 * 等 kind 直接返回 `[]`(见 vendor attachment/persist.ts 注释)。视频/音频工具要落库就得泛化。
 * 本函数与 `persistPicked` 同形:抓远程 URL / 本地解码 `data:` → `ctx.putOutput` → 稳定引用,
 * 只是把 kind 白名单扩到 video/audio 并按容器扩展名 + mime 处理。零改 vendor。
 *
 * runLocal(ffmpeg)产物没有远程 URL:hook 把输出字节编成 `data:` URI 交回,这里本地解码落库。
 * ponytail: data: URI 会把整段媒体 base64 驻留内存(~1.33×);大文件(>100MB)应升级为
 * file:// 直读或流式落库——现阶段 scaffold 够用,上限即此。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { PickedResult } from "@blksails/pi-web-tool-kit/runtime";
import type { MediaAsset, MediaKind } from "./media-types.js";

const log = createLogger({ namespace: "media-tools:persist" });

export interface PersistMediaResult {
  kind: MediaKind;
  assets: MediaAsset[];
}

interface PersistOptions {
  fetchImpl?: typeof fetch;
  namePrefix?: string;
}

/** 从 PickedResult 抽取 (kind, urls[])。返回 null = 无可落库产物(text/choices/raw)。 */
function pickedMedia(
  picked: PickedResult,
): { kind: MediaKind; urls: readonly string[] } | null {
  switch (picked.kind) {
    case "image":
      return { kind: "image", urls: [picked.url] };
    case "image-set":
      return { kind: "image", urls: picked.urls };
    case "video":
      return { kind: "video", urls: [picked.url] };
    case "video-set":
      return { kind: "video", urls: picked.urls };
    case "audio":
      return { kind: "audio", urls: [picked.url] };
    case "audio-set":
      return { kind: "audio", urls: picked.urls };
    default:
      return null;
  }
}

/**
 * 把 picked 中每个 URL 抓字节并经 `ctx.putOutput` 落库,返回稳定引用。
 * 任一失败即抛(无部分引用)。非媒体 kind 返回 `null`。
 */
export async function persistMedia(
  picked: PickedResult,
  ctx: AttachmentToolContext,
  opts: PersistOptions = {},
): Promise<PersistMediaResult | null> {
  const { fetchImpl = globalThis.fetch, namePrefix = "aigc" } = opts;
  const media = pickedMedia(picked);
  if (media === null) return null;

  const assets = await Promise.all(
    media.urls.map(async (url, i) => {
      let bytes: Uint8Array;
      let mimeType: string;
      if (url.startsWith("data:")) {
        ({ bytes, mimeType } = decodeDataUri(url));
      } else {
        const resp = await fetchImpl(url);
        if (!resp.ok) {
          throw new Error(`persistMedia: failed to fetch ${media.kind} at ${url}: ${resp.status}`);
        }
        mimeType = detectMimeType(resp, url, media.kind);
        bytes = new Uint8Array(await resp.arrayBuffer());
      }
      const ext = extFromMime(mimeType);
      const name = `${namePrefix}-${i}.${ext}`;
      const ref = await ctx.putOutput({ bytes, name, mimeType });
      log.debug("media persisted", { index: i, kind: media.kind, mimeType, bytes: bytes.length });
      return {
        attachmentId: ref.attachmentId,
        displayUrl: ref.displayUrl,
        mimeType: ref.mimeType,
        name: ref.name,
      };
    }),
  );

  return { kind: media.kind, assets };
}

// ── mime / 扩展名(覆盖 image / video / audio) ────────────────────────────────

function decodeDataUri(url: string): { bytes: Uint8Array; mimeType: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("persistMedia: malformed data URI");
  const mimeType = m[1] ?? "application/octet-stream";
  const body = m[3] ?? "";
  const buf = m[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  return { bytes: new Uint8Array(buf), mimeType };
}

function detectMimeType(resp: Response, url: string, kind: MediaKind): string {
  const ct = resp.headers.get("content-type");
  if (ct) {
    const base = ct.split(";")[0]?.trim();
    if (base && (base.startsWith("image/") || base.startsWith("video/") || base.startsWith("audio/"))) {
      return base;
    }
  }
  return mimeFromUrl(url, kind);
}

function mimeFromUrl(url: string, kind: MediaKind): string {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)/.exec(url);
    if (m?.[1]) return m[1].toLowerCase();
  }
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  // image
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".png")) return "image/png";
  // video
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  // audio
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  // fall back by declared kind
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  return "image/png";
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/bmp": return "bmp";
    case "image/png": return "png";
    case "video/mp4": return "mp4";
    case "video/webm": return "webm";
    case "video/quicktime": return "mov";
    case "audio/mpeg": return "mp3";
    case "audio/wav": return "wav";
    case "audio/aac": return "aac";
    case "audio/mp4": return "m4a";
    default: {
      const sub = mime.split("/")[1];
      return sub && /^[a-z0-9]+$/.test(sub) ? sub : "bin";
    }
  }
}
