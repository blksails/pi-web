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
  /**
   * 取消信号(spec aigc-tool-abort,Req 1.2)。
   *
   * ★ 此前落盘下载调 `fetchImpl(url)` **不传 init**,signal 无从进入 —— 用户点停止后只能
   * 干等 {@link PERSIST_TIMEOUT_MS}(下载与 arrayBuffer 各一个 30s 窗口,最坏 60s)。而这
   * 恰是「图已生成、正在取回」的阶段,是最容易想按停止的时刻之一。
   *
   * 与 `withTimeout` 是**互补**关系:signal 面向「用户主动取消」,超时面向「对端无响应」。
   * 未传 signal 的调用方行为完全不变,仍受超时兜底保护(Req 4.2)。
   */
  signal?: AbortSignal;
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
  const { fetchImpl = globalThis.fetch, namePrefix = "aigc", signal } = opts;

  const urls = pickedImageUrls(picked);
  // Wave 1: non-image kinds (video, audio, text, choices, raw) are not persisted.
  if (urls === null) return [];

  // ── 阶段一:并行**下载**全部字节(可中断)──────────────────────────────────────
  //
  // Parallel fetch. Serial download made the per-image latency stack up, so the tool's
  // completion lagged well behind the provider actually returning the images.
  // Promise.all keeps result order aligned with input order (stable naming index).
  //
  // ★ 为什么下载与入库要**拆成两阶段**(spec aigc-tool-abort D2,Req 3.2):
  // 原实现在同一个 map 里「下完一张就入库一张」。多图并行时,用户在第 2 张下载中点停止,
  // 第 1 张可能**已经入库**了 —— 留下不属于任何一次成功调用的孤儿附件。拆开后,只要
  // 终止发生在下载期,阶段一整体抛出,一张都不会入库。
  //
  // ★ 内存上界(免得后人误以为这里疏忽了):所有图片字节会同时驻留内存。单图受
  // MAX_PAYLOAD_BYTES = 4MiB 约束、n 上限 10,最坏约 40MB —— 可接受。
  const downloaded = await Promise.all(
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
        // ★ 第二参 init 是本次修复的关键:signal 由此进入下载,使停止立即生效
        // 而不是干等 PERSIST_TIMEOUT_MS。withTimeout 保留作为无 signal 时的兜底。
        const resp = await withTimeout(fetchImpl(url, { signal }), PERSIST_TIMEOUT_MS, `fetch[${i}]`);
        if (!resp.ok) {
          throw new Error(`persistPicked: failed to fetch image at ${url}: ${resp.status}`);
        }
        mimeType = detectMimeType(resp, url);
        // fetch 被 abort 时 body 流随之中断,arrayBuffer() 会 reject —— 无需额外接 signal。
        bytes = new Uint8Array(
          await withTimeout(resp.arrayBuffer(), PERSIST_TIMEOUT_MS, `arrayBuffer[${i}]`),
        );
      }
      log.debug("image downloaded", {
        index: i,
        source: inline ? "inline" : "download",
        mimeType,
        bytes: bytes.length,
        ms: Date.now() - startedAt,
      });
      return { bytes, mimeType, index: i };
    }),
  );

  // 下载全部完成后统一检查一次:覆盖「最后一张刚下完、用户此刻点停止」的窗口。
  if (signal?.aborted === true) {
    throw new DOMException("persistPicked aborted before persist", "AbortError");
  }

  // ── 阶段二:统一入库(不再响应 abort)────────────────────────────────────────
  //
  // ★ 这一段刻意**不**检查 signal(spec aigc-tool-abort D5):putOutput 是本地操作、
  // 毫秒级,中途打断反而更容易留下半态。窗口极短,语义收益低于风险。
  // 任一 putOutput 失败仍会整体抛出 → 上层 fail-soft → 不返回部分引用(Req 3.1)。
  return Promise.all(
    downloaded.map(async ({ bytes, mimeType, index }) => {
      const ext = extFromMime(mimeType);
      const name = `${namePrefix}-${index}.${ext}`;
      const ref = await withTimeout(
        ctx.putOutput({ bytes, name, mimeType }),
        PERSIST_TIMEOUT_MS,
        `putOutput[${index}]`,
      );
      log.debug("image persisted", { index, mimeType, bytes: bytes.length });
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
