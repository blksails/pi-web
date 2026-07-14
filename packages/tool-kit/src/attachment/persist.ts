/**
 * Attachment persistence adapter for AIGC tool outputs.
 *
 * `persistPicked`       — fetch remote image URLs → `ctx.putOutput` → return stable refs.
 * `resolveInputToDataUri` — `ctx.resolve(id)` → bytes → `data:<mime>;base64,<b64>` string.
 *
 * Wave 1 only handles `image` and `image-set` kinds; other kinds are
 * type-exhaustive-safe and return an empty array to avoid breaking new variants
 * that may not yet produce imagery.
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { PickedResult } from "../engine/endpoint-types.js";

// 命名空间 toolkit:persist —— 每张图落库:inline(本地解码)还是 download(远程下载)+ 耗时。
const log = createLogger({ namespace: "toolkit:persist" });

/**
 * 超时兜底(sandbox-attachment-store spec A4,Req R7)——给可能挂起的 Promise(远程 fetch /
 * `ctx.putOutput` 经 `RemoteAttachmentStore` 打回 cloud 等)加超时,超时抛可读错误而非无限挂起。
 * `putOutput` 自身在 `RemoteAttachmentStore` 内已有 30s HTTP 超时,这里是**双保险**——覆盖
 * `fetchImpl`/`arrayBuffer` 等不经 `RemoteAttachmentStore` 的下载路径,防止任何未来新增挂起点。
 */
const PERSIST_TIMEOUT_MS = 30_000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`persistPicked: timed out after ${ms}ms at ${label}`)), ms),
    ),
  ]);
}

/** Stable reference to a persisted generation asset. */
export interface PersistedAsset {
  attachmentId: string;
  displayUrl: string;
  mimeType: string;
  name: string;
}

interface PersistOptions {
  fetchImpl?: typeof fetch;
  namePrefix?: string;
}

/**
 * For each image URL in `picked`, fetch the bytes and persist them via
 * `ctx.putOutput`.  Returns one {@link PersistedAsset} per stored image.
 *
 * Failure in any `putOutput` call throws immediately — no partial refs are
 * returned (Req 3.1: "no partial references").
 */
export async function persistPicked(
  picked: PickedResult,
  ctx: AttachmentToolContext,
  opts: PersistOptions = {},
): Promise<PersistedAsset[]> {
  const { fetchImpl = globalThis.fetch, namePrefix = "aigc" } = opts;

  const urls = pickedImageUrls(picked);
  // Wave 1: non-image kinds (video, audio, text, choices, raw) are not persisted.
  if (urls === null) return [];

  // Parallel fetch + persist. Serial download made the per-image latency stack up,
  // so the tool's completion lagged well behind the provider actually returning the
  // images. Promise.all keeps result order aligned with input order (stable naming
  // index); any rejection fails the whole call → caught by runExecute's top-level
  // try/catch → no partial references are returned (Req 3.1).
  return Promise.all(
    urls.map(async (url, i) => {
      // Inline `data:` images (e.g. gpt-image `b64_json`) decode locally — no second
      // network round-trip. Providers that hand back a remote URL (DashScope, or
      // OpenAI `response_format:url`) still get one fetch here; that download is the
      // window where the tool lagged behind the gateway's already-returned response.
      const startedAt = Date.now();
      let bytes: Uint8Array;
      let mimeType: string;
      const inline = url.startsWith("data:");
      if (inline) {
        ({ bytes, mimeType } = decodeDataUri(url));
      } else {
        const resp = await withTimeout(fetchImpl(url), PERSIST_TIMEOUT_MS, `fetch[${i}]`);
        if (!resp.ok) {
          throw new Error(`persistPicked: failed to fetch image at ${url}: ${resp.status}`);
        }
        mimeType = detectMimeType(resp, url);
        bytes = new Uint8Array(
          await withTimeout(resp.arrayBuffer(), PERSIST_TIMEOUT_MS, `arrayBuffer[${i}]`),
        );
      }
      const ext = extFromMime(mimeType);
      const name = `${namePrefix}-${i}.${ext}`;
      const ref = await withTimeout(
        ctx.putOutput({ bytes, name, mimeType }),
        PERSIST_TIMEOUT_MS,
        `putOutput[${i}]`,
      );
      log.debug("image persisted", {
        index: i,
        source: inline ? "inline" : "download",
        mimeType,
        bytes: bytes.length,
        ms: Date.now() - startedAt,
      });
      return {
        attachmentId: ref.attachmentId,
        displayUrl: ref.displayUrl,
        mimeType: ref.mimeType,
        name: ref.name,
      };
    }),
  );
}

/**
 * Optimistic-preview assets built straight from a picked result — the raw gateway
 * URLs, BEFORE download + persist. Lets a tool emit a preliminary frame so the UI
 * shows the freshly-generated image immediately while persistence runs in the
 * background. The final {@link persistPicked} assets (signed `/api` displayUrls)
 * replace these on completion.
 *
 * `attachmentId` is empty (not stored yet); `mimeType`/`name` are guessed from the
 * URL. Returns `[]` for non-image kinds (nothing to preview).
 */
export function previewAssetsFromPicked(
  picked: PickedResult,
  namePrefix = "aigc",
  opts: { includeDataUri?: boolean } = {},
): PersistedAsset[] {
  const urls = pickedImageUrls(picked);
  if (urls === null) return [];
  return (
    urls
      // 非流式:只预览远程 URL——`data:` URI 已在手(persist 本地解码,无需填补空窗),
      // 把多 MB base64 塞进 preliminary SSE 帧是纯浪费,默认过滤。
      // 流式(includeDataUri):图**先于** persist 到达且只有 data URI 形态,「图早弹」正是要
      // 提前把这张 data URI 显出来(尤其 gemini 图在首帧),故此时保留 data URI。
      .filter((url) => opts.includeDataUri || !url.startsWith("data:"))
      .map((url, i) => {
        const mimeType = mimeFromUrl(url);
        const ext = extFromMime(mimeType);
        return {
          attachmentId: "",
          displayUrl: url,
          mimeType,
          name: `${namePrefix}-${i}.${ext}`,
        };
      })
  );
}

/**
 * Resolve an attachment id to a `data:<mime>;base64,<b64>` URI.
 * Used for image_edit: providers cannot reach `localhost` display URLs, so we
 * inline the bytes directly.
 */
export async function resolveInputToDataUri(
  attachmentId: string,
  ctx: AttachmentToolContext,
): Promise<string> {
  const handle = await ctx.resolve(attachmentId);
  const bytes = await handle.bytes();
  const mime = handle.meta.mimeType ?? "image/png";
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Flatten a picked result to its image-URL list, or `null` for non-image kinds.
 * Single source of truth for "which kinds carry persistable imagery", shared by
 * {@link persistPicked} and {@link previewAssetsFromPicked}.
 */
function pickedImageUrls(picked: PickedResult): ReadonlyArray<string> | null {
  switch (picked.kind) {
    case "image":
      return [picked.url];
    case "image-set":
      return picked.urls;
    default:
      return null;
  }
}

/** Decode a `data:<mime>;base64,<b64>` (or percent-encoded) URI to bytes + mime, locally. */
function decodeDataUri(url: string): { bytes: Uint8Array; mimeType: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("persistPicked: malformed data URI");
  const mimeType = m[1] ?? "image/png";
  const body = m[3] ?? "";
  const buf = m[2]
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf8");
  return { bytes: new Uint8Array(buf), mimeType };
}

function detectMimeType(resp: Response, url: string): string {
  const ct = resp.headers.get("content-type");
  if (ct) {
    // Strip charset / quality params: "image/jpeg; charset=..."
    const base = ct.split(";")[0]?.trim();
    if (base && base.startsWith("image/")) return base;
  }
  return mimeFromUrl(url);
}

function mimeFromUrl(url: string): string {
  // data URI:mime 就写在前缀里(`data:image/png;base64,…`)。
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)/.exec(url);
    if (m?.[1]) return m[1].toLowerCase();
  }
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif":  return "gif";
    case "image/bmp":  return "bmp";
    default:           return "png";
  }
}
