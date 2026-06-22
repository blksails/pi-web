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
import type { AttachmentToolContext } from "@pi-web/agent-kit";
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

  // Normalise to a flat list of URLs for the kinds we handle in Wave 1.
  let urls: ReadonlyArray<string>;
  switch (picked.kind) {
    case "image":
      urls = [picked.url];
      break;
    case "image-set":
      urls = picked.urls;
      break;
    // Wave 1: other kinds (video, audio, text, choices, raw) are not persisted.
    default:
      return [];
  }

  const assets: PersistedAsset[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i] as string;
    const resp = await fetchImpl(url);
    if (!resp.ok) {
      throw new Error(`persistPicked: failed to fetch image at ${url}: ${resp.status}`);
    }

    const mimeType = detectMimeType(resp, url);
    const ext = extFromMime(mimeType);
    const name = `${namePrefix}-${i}.${ext}`;

    const bytes = new Uint8Array(await resp.arrayBuffer());
    const ref = await ctx.putOutput({ bytes, name, mimeType });

    assets.push({
      attachmentId: ref.attachmentId,
      displayUrl: ref.displayUrl,
      mimeType: ref.mimeType,
      name: ref.name,
    });
  }

  return assets;
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
