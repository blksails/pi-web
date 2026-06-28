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
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { PickedResult } from "../engine/types.js";

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
      const resp = await fetchImpl(url);
      if (!resp.ok) {
        throw new Error(`persistPicked: failed to fetch image at ${url}: ${resp.status}`);
      }
      const mimeType = detectMimeType(resp, url);
      const ext = extFromMime(mimeType);
      const name = `${namePrefix}-${i}.${ext}`;
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ref = await ctx.putOutput({ bytes, name, mimeType });
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
): PersistedAsset[] {
  const urls = pickedImageUrls(picked);
  if (urls === null) return [];
  return urls.map((url, i) => {
    const mimeType = mimeFromUrl(url);
    const ext = extFromMime(mimeType);
    return {
      attachmentId: "",
      displayUrl: url,
      mimeType,
      name: `${namePrefix}-${i}.${ext}`,
    };
  });
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
