/**
 * 本地 ffmpeg provider —— 端口自 pi-labs `providers/local-ffmpeg{,-video}.ts`,适配 pi-web
 * `EndpointBehavior.runLocal` 契约:
 *  - 进度回调是 `(stage: RunStage) => void`(pi-labs 传 `{stage,elapsedMs}` 对象 → 改传 stage 串)。
 *  - **不自上传**:pi-labs 走自有 `uploadMedia`;这里读输出字节 → 编 `data:` URI 交回,由
 *    编排器的 {@link persistMedia} 落 attachment store(单一落库口,provenance 权威在宿主)。
 *  - `runLocal` 的 ctx 无 sessionId(vendor 引擎只透传 signal/onProgress),本地处理也不需要。
 *
 * 每个工具 = 一个带 `runLocal` 的 {@link MediaRoute};ffmpeg args 由纯函数构造(便于单测)。
 */
import { spawn } from "node:child_process";
import { createWriteStream, unlink, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { PickedResult, RunStage } from "@blksails/pi-web-tool-kit/runtime";
import type { MediaRoute } from "../media-types.js";

type OnStage = ((stage: RunStage) => void) | undefined;

// ── 并发闸(与 pi-labs 同款:同机 ffmpeg 进程数受限)────────────────────────────

let inFlight = 0;
const waiters: Array<() => void> = [];

function concurrencyLimit(): number {
  const raw = Number.parseInt(process.env.LOCAL_FFMPEG_CONCURRENCY ?? "", 10);
  if (!Number.isFinite(raw)) return 2;
  return raw <= 0 ? 1 : raw;
}

async function acquireSlot(onStage: OnStage, signal?: AbortSignal): Promise<void> {
  if (inFlight < concurrencyLimit()) {
    inFlight++;
    return;
  }
  if (signal?.aborted) throw new Error("已取消");
  onStage?.("queued");
  await new Promise<void>((resolve, reject) => {
    const slot = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      const i = waiters.indexOf(slot);
      if (i !== -1) waiters.splice(i, 1);
      cleanup();
      reject(new Error("已取消"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    waiters.push(slot);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  inFlight--;
}

// ── ffmpeg 子进程 ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const SIGKILL_GRACE_MS = 5_000;
const HEARTBEAT_MS = 5_000;

export function classifyFfmpegError(input: { stderr: string; code?: string }): string {
  const { stderr, code } = input;
  if (code === "ENOENT") return "运行时缺失 ffmpeg";
  if (stderr.includes("does not contain any stream") || stderr.includes("matches no streams")) {
    return "源视频无音轨";
  }
  if (
    stderr.includes("moov atom not found") ||
    stderr.includes("Invalid data") ||
    stderr.includes("Error opening input")
  ) {
    return "视频损坏或格式不支持";
  }
  return `ffmpeg 处理失败: ${stderr.slice(-200)}`;
}

export async function runFfmpeg(
  args: string[],
  onStage: OnStage,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    const stderrChunks: string[] = [];
    let settled = false;
    let pendingReason: "abort" | "timeout" | null = null;
    let pendingKillTimer: ReturnType<typeof setTimeout> | null = null;

    function terminate(reason: "abort" | "timeout") {
      if (settled) return;
      child.kill("SIGTERM");
      pendingReason = reason;
      pendingKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, SIGKILL_GRACE_MS);
    }

    const heartbeat = setInterval(() => {
      if (!settled) onStage?.("running");
    }, HEARTBEAT_MS);
    const timeout = setTimeout(() => terminate("timeout"), timeoutMs);
    const onAbort = () => terminate("abort");
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    function cleanup() {
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (pendingKillTimer !== null) clearTimeout(pendingKillTimer);
      signal?.removeEventListener("abort", onAbort);
    }

    child.stderr?.on("data", (c: Buffer | string) => stderrChunks.push(c.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(new Error(err.code === "ENOENT" ? "运行时缺失 ffmpeg" : `ffmpeg 启动失败: ${err.message}`));
    });
    child.on("close", (code: number | null) => {
      cleanup();
      const stderr = stderrChunks.join("");
      if (pendingReason === "timeout") return reject(new Error("ffmpeg 处理超时"));
      if (pendingReason === "abort") return reject(new Error("已取消"));
      resolve({ exitCode: code ?? 0, stderr });
    });
  });
}

// ── 输入取回(http/https 下载 · data: 解码 · file://或本地路径 直用)──────────────

export const MAX_INPUT_BYTES = 500 * 1024 * 1024;

function toMB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** 把输入(URL / data: / 本地路径)物化到 `tmpDir` 下一个本地文件,返回绝对路径。 */
export async function fetchToTmp(src: string, tmpDir: string, signal?: AbortSignal): Promise<string> {
  // data: —— 本地解码落盘。
  if (src.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
    if (!m) throw new Error("无效 data URI");
    const buf = m[2] ? Buffer.from(m[3] ?? "", "base64") : Buffer.from(decodeURIComponent(m[3] ?? ""), "utf8");
    if (buf.byteLength > MAX_INPUT_BYTES) throw new Error(`输入超过 500 MB 上限（${toMB(buf.byteLength)} MB）`);
    const out = join(tmpDir, "input.bin");
    await writeFile(out, buf);
    return out;
  }

  // file:// 或裸本地路径 —— 拷贝进 tmpDir(隔离,避免 ffmpeg 写坏原文件)。
  let localPath: string | undefined;
  if (src.startsWith("file://")) localPath = fileURLToPath(src);
  else if (!/^https?:\/\//i.test(src) && existsSync(src)) localPath = src;
  if (localPath) {
    const out = join(tmpDir, localPath.split(/[\\/]/).pop() || "input.bin");
    await copyFile(localPath, out);
    return out;
  }

  // http/https —— 两段式体积校验 + 流式下载(端口自 pi-labs)。
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    throw new Error(`输入 URL 无效: ${src}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`输入 URL 协议不支持(仅 http/https): ${parsed.protocol}`);
  }
  try {
    const head = await fetch(src, { method: "HEAD", signal });
    if (head.ok) {
      const len = head.headers.get("content-length");
      if (len && Number(len) > MAX_INPUT_BYTES) {
        throw new Error(`输入超过 500 MB 上限（声明 ${toMB(Number(len))} MB）`);
      }
    }
  } catch (err) {
    if (err instanceof Error && /500 MB/.test(err.message)) throw err;
    // HEAD 失败 → 落到 GET 流式校验。
  }

  const res = await fetch(src, { method: "GET", signal });
  if (!res.ok || !res.body) throw new Error(`输入 URL 无法访问: HTTP ${res.status}`);
  const basename = parsed.pathname.split("/").pop()?.replace(/\?.*$/, "") || "input.bin";
  const out = join(tmpDir, basename);
  const ws = createWriteStream(out);
  let cumulative = 0;
  const reader = res.body.getReader();
  const node = Readable.from(
    (async function* () {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            cumulative += value.byteLength;
            if (cumulative > MAX_INPUT_BYTES) throw new Error(`输入超过 500 MB 上限（下载到 ${toMB(cumulative)} MB）`);
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
    })(),
  );
  try {
    await pipeline(node, ws);
  } catch (err) {
    unlink(out, () => {});
    throw err instanceof Error ? err : new Error(String(err));
  }
  return out;
}

// ── 共享执行壳:semaphore → tmpdir → 取输入 → build args → ffmpeg → data URI ────

export interface FfmpegRunSpec {
  inputs: Record<string, string>;
  buildArgs: (ctx: { paths: Record<string, string>; tmpDir: string; outputPath: string }) => Promise<string[]> | string[];
  outputExt: string;
  kind: "video" | "image" | "audio";
  contentType: string;
  caption?: string;
  timeoutMs?: number;
}

export async function runFfmpegTool(
  spec: FfmpegRunSpec,
  onStage: OnStage,
  signal?: AbortSignal,
): Promise<PickedResult> {
  await acquireSlot(onStage, signal);
  const tmpDir = await mkdtemp(join(tmpdir(), "aigc-ffmpeg-"));
  try {
    onStage?.("submitting");
    const paths: Record<string, string> = {};
    for (const [role, src] of Object.entries(spec.inputs)) {
      paths[role] = await fetchToTmp(src, tmpDir, signal);
    }
    const outputPath = join(tmpDir, `out.${spec.outputExt}`);
    const args = await spec.buildArgs({ paths, tmpDir, outputPath });
    const { exitCode, stderr } = await runFfmpeg(args, onStage, signal, spec.timeoutMs);
    if (exitCode !== 0) throw new Error(classifyFfmpegError({ stderr }));
    const bytes = await readFile(outputPath);
    const url = `data:${spec.contentType};base64,${bytes.toString("base64")}`;
    onStage?.("complete");
    return { kind: spec.kind, url, caption: spec.caption };
  } finally {
    releaseSlot();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── 参数解析小工具 ───────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function clampInt(raw: unknown, min: number, max: number, def: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return def;
  const n = Math.floor(raw);
  return n < min ? min : n > max ? max : n;
}
function strArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

// ── ffmpeg args 构造(纯函数)─────────────────────────────────────────────────

export function audioExtractArgs(input: string, output: string, format: "mp3" | "aac" | "wav", clipSeconds: number): string[] {
  const clip = clipSeconds > 0 ? ["-t", String(clipSeconds)] : [];
  switch (format) {
    case "mp3": return ["-y", "-i", input, "-vn", ...clip, "-c:a", "libmp3lame", "-b:a", "192k", output];
    case "aac": return ["-y", "-i", input, "-vn", ...clip, "-c:a", "aac", "-b:a", "192k", output];
    case "wav": return ["-y", "-i", input, "-vn", ...clip, "-c:a", "pcm_s16le", "-ar", "44100", output];
  }
}

export function videoConcatArgs(listPath: string, output: string): string[] {
  return ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output];
}

export function videoToGifArgs(input: string, output: string, o: { start: number; duration: number; fps: number; width: number }): string[] {
  return ["-y", "-ss", String(o.start), "-t", String(o.duration), "-i", input, "-vf", `fps=${o.fps},scale=${o.width}:-1:flags=lanczos`, output];
}

export function videoExtractFrameArgs(input: string, output: string, ts: number): string[] {
  return ["-y", "-i", input, "-ss", String(ts), "-frames:v", "1", "-q:v", "2", output];
}

export function videoWithAudioArgs(video: string, audio: string, output: string, mode: "replace" | "mix"): string[] {
  if (mode === "mix") {
    return ["-y", "-i", video, "-i", audio, "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=2[aout]", "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", output];
  }
  return ["-y", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", output];
}

export function videoTranscodeArgs(input: string, output: string, o: { resolution: "keep" | "480p" | "720p" | "1080p"; codec: "libx264" | "libx265" | "libvpx-vp9"; crf: number }): string[] {
  const scaleH = o.resolution === "1080p" ? 1080 : o.resolution === "720p" ? 720 : o.resolution === "480p" ? 480 : null;
  const vf = scaleH !== null ? ["-vf", `scale=-2:${scaleH}`] : [];
  const audio = o.codec === "libvpx-vp9" ? ["-c:a", "libopus", "-b:a", "96k"] : ["-c:a", "aac", "-b:a", "128k"];
  return ["-y", "-i", input, "-c:v", o.codec, "-crf", String(o.crf), ...vf, ...audio, output];
}

export function videoClipArgs(input: string, output: string, o: { start: number; duration: number }): string[] {
  return ["-y", "-ss", String(o.start), "-i", input, "-t", String(o.duration), "-c", "copy", "-avoid_negative_ts", "make_zero", output];
}

// ── runLocal 执行器(供 tools 复用;每个返回一个 PickedResult)────────────────────

function normFormat(raw: unknown): "mp3" | "aac" | "wav" {
  return raw === "aac" || raw === "wav" ? raw : "mp3";
}

const FORMAT_CT: Record<string, string> = { mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav" };

export const ffmpegRunLocal = {
  audioExtract: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const url = str(args["video_url"]);
    if (!url) throw new Error("video_url 必填");
    const format = normFormat(args["format"]);
    const clipSeconds = clampInt(args["clip_seconds"], 0, 300, 0);
    return runFfmpegTool(
      {
        inputs: { video: url },
        buildArgs: ({ paths, outputPath }) => audioExtractArgs(paths.video!, outputPath, format, clipSeconds),
        outputExt: format,
        kind: "audio",
        contentType: FORMAT_CT[format]!,
        caption: clipSeconds > 0 ? `extracted audio (first ${clipSeconds}s)` : "extracted audio",
      },
      onStage,
      signal,
    );
  },

  videoConcat: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const urls = strArray(args["video_urls"]);
    if (urls.length < 2) throw new Error("video_concat 需要 ≥2 个 video_urls");
    if (urls.length > 9) throw new Error("video_concat 单次最多 9 段");
    const inputs: Record<string, string> = {};
    urls.forEach((u, i) => (inputs[`v${i}`] = u));
    return runFfmpegTool(
      {
        inputs,
        buildArgs: async ({ paths, tmpDir, outputPath }) => {
          const list = urls.map((_, i) => `file '${paths[`v${i}`]!.replace(/'/g, "'\\''")}'`).join("\n");
          const listPath = join(tmpDir, "concat-list.txt");
          await writeFile(listPath, list, "utf8");
          return videoConcatArgs(listPath, outputPath);
        },
        outputExt: "mp4",
        kind: "video",
        contentType: "video/mp4",
        caption: `concat of ${urls.length} clips`,
      },
      onStage,
      signal,
    );
  },

  videoToGif: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const url = str(args["video_url"]);
    if (!url) throw new Error("video_url 必填");
    const start = clampInt(args["start_seconds"], 0, 3600, 0);
    const duration = clampInt(args["duration_seconds"], 1, 30, 5);
    const fps = clampInt(args["fps"], 1, 30, 10);
    const width = clampInt(args["width"], 64, 1920, 480);
    return runFfmpegTool(
      {
        inputs: { video: url },
        buildArgs: ({ paths, outputPath }) => videoToGifArgs(paths.video!, outputPath, { start, duration, fps, width }),
        outputExt: "gif",
        kind: "image",
        contentType: "image/gif",
        caption: `gif (${start}s +${duration}s, ${fps}fps, ${width}w)`,
      },
      onStage,
      signal,
    );
  },

  videoExtractFrame: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const url = str(args["video_url"]);
    if (!url) throw new Error("video_url 必填");
    const raw = args["timestamp_seconds"];
    const ts = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
    return runFfmpegTool(
      {
        inputs: { video: url },
        buildArgs: ({ paths, outputPath }) => videoExtractFrameArgs(paths.video!, outputPath, ts),
        outputExt: "png",
        kind: "image",
        contentType: "image/png",
        caption: `frame at ${ts}s`,
        timeoutMs: 5 * 60_000,
      },
      onStage,
      signal,
    );
  },

  videoWithAudio: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const video = str(args["video_url"]);
    const audio = str(args["audio_url"]);
    if (!video) throw new Error("video_url 必填");
    if (!audio) throw new Error("audio_url 必填");
    const mode: "replace" | "mix" = args["mode"] === "mix" ? "mix" : "replace";
    return runFfmpegTool(
      {
        inputs: { video, audio },
        buildArgs: ({ paths, outputPath }) => videoWithAudioArgs(paths.video!, paths.audio!, outputPath, mode),
        outputExt: "mp4",
        kind: "video",
        contentType: "video/mp4",
        caption: `video + audio (${mode})`,
      },
      onStage,
      signal,
    );
  },

  videoTranscode: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const url = str(args["video_url"]);
    if (!url) throw new Error("video_url 必填");
    const resolution: "keep" | "480p" | "720p" | "1080p" =
      args["resolution"] === "480p" || args["resolution"] === "720p" || args["resolution"] === "1080p"
        ? (args["resolution"] as "480p" | "720p" | "1080p")
        : "keep";
    const codec: "libx264" | "libx265" | "libvpx-vp9" =
      args["codec"] === "libx265" || args["codec"] === "libvpx-vp9" ? (args["codec"] as "libx265" | "libvpx-vp9") : "libx264";
    const crf = clampInt(args["crf"], 18, 28, 23);
    const outputExt = codec === "libvpx-vp9" ? "webm" : "mp4";
    const contentType = codec === "libvpx-vp9" ? "video/webm" : "video/mp4";
    return runFfmpegTool(
      {
        inputs: { video: url },
        buildArgs: ({ paths, outputPath }) => videoTranscodeArgs(paths.video!, outputPath, { resolution, codec, crf }),
        outputExt,
        kind: "video",
        contentType,
        caption: `transcoded: ${resolution} / ${codec} / crf=${crf}`,
      },
      onStage,
      signal,
    );
  },

  videoClip: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal): Promise<PickedResult> => {
    const url = str(args["video_url"]);
    if (!url) throw new Error("video_url 必填");
    const start = clampInt(args["start_seconds"], 0, 36_000, 0);
    const duration = clampInt(args["duration_seconds"], 1, 600, 10);
    return runFfmpegTool(
      {
        inputs: { video: url },
        buildArgs: ({ paths, outputPath }) => videoClipArgs(paths.video!, outputPath, { start, duration }),
        outputExt: "mp4",
        kind: "video",
        contentType: "video/mp4",
        caption: `clip (${start}s +${duration}s)`,
      },
      onStage,
      signal,
    );
  },
} satisfies Record<string, (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal) => Promise<PickedResult>>;

/** 把一个 ffmpeg runLocal 执行器包成 {@link MediaRoute}(供 runMediaTool 路由)。 */
export function ffmpegRoute(
  model: string,
  label: string,
  description: string,
  exec: (args: Record<string, unknown>, onStage: OnStage, signal?: AbortSignal) => Promise<PickedResult>,
): MediaRoute {
  return {
    model,
    label,
    description,
    provider: "local-ffmpeg",
    runLocal: (args, ctx) => exec(args, ctx.onProgress, ctx.signal),
  };
}
