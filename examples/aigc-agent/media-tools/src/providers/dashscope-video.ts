/**
 * DashScope 视频 provider —— 端口自 pi-labs `providers/dashscope/{endpoints,parsers,bodies,factories}.ts`
 * 的视频子集,收敛到本包 {@link MediaRoute}(= vendor EndpointBehavior + 路由元)。
 *
 * 端点三族(async video-synthesis / image2video s2v):提交返回 task_id → poll /tasks/<id>。
 * 引擎(runEndpoint)负责轮询;这里只声明 url/headers/buildBody/pickResult/async。
 * 环境闸:需 `DASHSCOPE_API_KEY`(缺失时 runMediaTool 报「能力不可用」)。
 */
import type { AsyncSpec, PickedResult } from "@blksails/pi-web-tool-kit/runtime";
import type { MediaRoute } from "../media-types.js";
import { DASHSCOPE_VIDEO_MODELS } from "./dashscope-models.js";

const BASE = "https://dashscope.aliyuncs.com/api/v1";
const ASYNC_VIDEO_URL = `${BASE}/services/aigc/video-generation/video-synthesis`;
const S2V_VIDEO_URL = `${BASE}/services/aigc/image2video/video-synthesis`;
const ASYNC_HEADERS = { authorization: "Bearer ${DASHSCOPE_API_KEY}", "x-dashscope-async": "enable" };
const REQUIRED_VARS = ["DASHSCOPE_API_KEY"] as const;
const TASK_URL = (taskId: string) => `${BASE}/tasks/${taskId}`;

type Submit = { output: { task_id: string } };
type AsyncStatus = {
  output: {
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    results?: { url?: string; video_url?: string }[] | { video_url?: string };
    video_url?: string;
    last_frame_url?: string;
    code?: string;
    message?: string;
  };
};

const taskUrl = (s: unknown) => TASK_URL((s as Submit).output.task_id);

const taskPolling = {
  statusUrl: taskUrl,
  responseUrl: taskUrl,
  isComplete: (s: unknown) => (s as AsyncStatus).output.task_status === "SUCCEEDED",
  isFailed: (s: unknown) => (s as AsyncStatus).output.task_status === "FAILED",
};

const VIDEO_POLL: AsyncSpec = { ...taskPolling, pollMs: 8_000, timeoutMs: 300_000 };
const VIDEO_POLL_WAN27: AsyncSpec = { ...taskPolling, pollMs: 10_000, timeoutMs: 360_000 };
const VIDEO_POLL_EDIT: AsyncSpec = { ...taskPolling, pollMs: 15_000, timeoutMs: 1_800_000 };

function pickAsyncVideo(r: unknown): PickedResult {
  const out = (r as AsyncStatus).output;
  const results = out?.results;
  const fromArray = Array.isArray(results) ? results[0]?.url ?? results[0]?.video_url : results?.video_url;
  const url = out?.video_url ?? fromArray;
  if (!url) return { kind: "raw", value: r };
  return out?.last_frame_url ? { kind: "video", url, lastFrameUrl: out.last_frame_url } : { kind: "video", url };
}

const detectAsyncError = (r: unknown) => {
  const out = (r as AsyncStatus).output;
  if (out?.task_status === "FAILED") return out.message ?? out.code ?? "task failed";
  return undefined;
};

// ── size / ratio 工具 ────────────────────────────────────────────────────────

function even(n: number): number {
  return Math.round(n / 2) * 2;
}
function ratioToWanSize(ratio: string | undefined, resolution: string | undefined): string {
  const base = resolution === "1080p" ? 1080 : resolution === "480p" ? 480 : 720;
  switch (ratio) {
    case "9:16": return `${even((base * 9) / 16)}*${base}`;
    case "1:1": return `${base}*${base}`;
    case "4:3": return `${even((base * 4) / 3)}*${base}`;
    case "3:4": return `${base}*${even((base * 4) / 3)}`;
    case "21:9": return `${even((base * 21) / 9)}*${base}`;
    default: return `${even((base * 16) / 9)}*${base}`;
  }
}

const seed = (a: { seed?: number }) =>
  typeof a.seed === "number" && a.seed >= 0 ? { seed: a.seed } : {};

// ── body builders(端口自 pi-labs bodies.ts 视频子集)───────────────────────────

interface T2VArgs { prompt: string; negative_prompt?: string; duration?: number; resolution?: string; ratio?: string; seed?: number; }
interface I2VArgs extends T2VArgs { first_frame_url: string; last_frame_url?: string; }
interface R2VArgs extends T2VArgs { reference_image_urls?: string[]; reference_video_urls?: string[]; reference_audio_urls?: string[]; }
interface VideoEditArgs { prompt: string; video_url: string; reference_image_url?: string; seed?: number; }
interface S2VArgs { image_url: string; audio_url: string; resolution?: string; }

function buildWanVideoBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as T2VArgs;
    return {
      model,
      input: { prompt: a.prompt, ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}) },
      parameters: { size: ratioToWanSize(a.ratio, a.resolution), duration: a.duration ?? 5, ...seed(a) },
    };
  };
}

function buildWan27T2VBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as T2VArgs;
    const reso = (a.resolution ?? "720p").toLowerCase();
    return {
      model,
      input: { prompt: a.prompt, ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}) },
      parameters: { resolution: reso === "1080p" ? "1080P" : "720P", ratio: a.ratio ?? "16:9", duration: a.duration ?? 5, prompt_extend: true, watermark: false, ...seed(a) },
    };
  };
}

function buildWanI2VBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as I2VArgs;
    return {
      model,
      input: {
        img_url: a.first_frame_url,
        prompt: a.prompt,
        ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}),
        ...(a.last_frame_url ? { last_image_url: a.last_frame_url } : {}),
      },
      parameters: { size: ratioToWanSize(a.ratio, a.resolution), duration: a.duration ?? 5, ...seed(a) },
    };
  };
}

function buildWan27I2VBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as I2VArgs;
    const media: { type: string; url: string }[] = [{ type: "first_frame", url: a.first_frame_url }];
    if (a.last_frame_url) media.push({ type: "last_frame", url: a.last_frame_url });
    const reso = (a.resolution ?? "720p").toLowerCase();
    return {
      model,
      input: { ...(a.prompt ? { prompt: a.prompt } : {}), ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}), media },
      parameters: { resolution: reso === "1080p" ? "1080P" : "720P", duration: a.duration ?? 5, prompt_extend: true, watermark: false, ...seed(a) },
    };
  };
}

function buildWan27R2VBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as R2VArgs;
    const refImgs = a.reference_image_urls ?? [];
    const refVids = a.reference_video_urls ?? [];
    const refAuds = a.reference_audio_urls ?? [];
    if (refImgs.length === 0 && refVids.length === 0) {
      throw new Error("Wan 2.7 r2v 至少需要一个 reference_image_url 或 reference_video_url。");
    }
    const media: { type: string; url: string; reference_voice?: string }[] = [];
    let voiceIdx = 0;
    for (const url of refImgs) {
      const entry: { type: string; url: string; reference_voice?: string } = { type: "reference_image", url };
      if (voiceIdx < refAuds.length) entry.reference_voice = refAuds[voiceIdx++];
      media.push(entry);
    }
    for (const url of refVids) {
      const entry: { type: string; url: string; reference_voice?: string } = { type: "reference_video", url };
      if (voiceIdx < refAuds.length) entry.reference_voice = refAuds[voiceIdx++];
      media.push(entry);
    }
    const reso = (a.resolution ?? "720p").toLowerCase();
    return {
      model,
      input: { prompt: a.prompt, ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}), media },
      parameters: { resolution: reso === "1080p" ? "1080P" : "720P", ratio: a.ratio ?? "16:9", duration: a.duration ?? 5, prompt_extend: true, watermark: false, ...seed(a) },
    };
  };
}

function buildWan27VideoEditBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as VideoEditArgs;
    const media: { type: string; url: string }[] = [{ type: "video", url: a.video_url }];
    if (a.reference_image_url) media.push({ type: "reference_image", url: a.reference_image_url });
    return {
      model,
      input: { prompt: a.prompt, media },
      parameters: { resolution: "720P", prompt_extend: true, watermark: false, ...seed(a) },
    };
  };
}

// s2v 数字人:pi-labs 有 best-effort 人像合规预检(proxyFetch + sharp),这里 scaffold 略去,
// ponytail: 预检是 best-effort(失败也放行),缺它不改主流程语义;要补时提上游或加内部路由。
function buildS2VBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as S2VArgs;
    if (!a.image_url || !a.audio_url) {
      throw new Error("digital_human_video: image_url(人像)与 audio_url(驱动音频)均必填。");
    }
    const reso = String(a.resolution ?? "480P").toUpperCase() === "720P" ? "720P" : "480P";
    return { model, input: { image_url: a.image_url, audio_url: a.audio_url }, parameters: { resolution: reso } };
  };
}

// ── route 工厂 ───────────────────────────────────────────────────────────────

interface RouteMeta { model: string; label: string; description: string; }

function videoRoute(
  meta: RouteMeta,
  buildBody: (model: string) => (args: Record<string, unknown>) => unknown,
  async: AsyncSpec,
  opts: { url?: string; pick?: (r: unknown) => PickedResult } = {},
): MediaRoute {
  return {
    model: meta.model,
    label: meta.label,
    description: meta.description,
    provider: "dashscope",
    url: opts.url ?? ASYNC_VIDEO_URL,
    headers: ASYNC_HEADERS,
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildBody(meta.model),
    async,
    pickResult: opts.pick ?? pickAsyncVideo,
    detectError: detectAsyncError,
  };
}

const M = DASHSCOPE_VIDEO_MODELS;

export const DASHSCOPE_T2V_ROUTES: readonly MediaRoute[] = [
  videoRoute({ model: M.wan27T2V, label: "Wan 2.7 T2V", description: "万相 2.7 文生视频(720P/1080P)。" }, buildWan27T2VBody, VIDEO_POLL_WAN27),
  videoRoute({ model: M.wan26T2V, label: "Wan 2.6 T2V", description: "万相 2.6 文生视频。" }, buildWanVideoBody, VIDEO_POLL),
  videoRoute({ model: M.wanx21T2V, label: "Wanx 2.1 T2V Turbo", description: "万相 2.1 turbo 文生视频,便宜快出。" }, buildWanVideoBody, VIDEO_POLL),
];

export const DASHSCOPE_I2V_ROUTES: readonly MediaRoute[] = [
  videoRoute({ model: M.wan27I2V, label: "Wan 2.7 I2V", description: "万相 2.7 图生视频(首/尾帧 media[])。" }, buildWan27I2VBody, VIDEO_POLL_WAN27),
  videoRoute({ model: M.wan26I2V, label: "Wan 2.6 I2V", description: "万相 2.6 图生视频(首帧 + 可选尾帧)。" }, buildWanI2VBody, VIDEO_POLL),
  videoRoute({ model: M.wan22I2VPlus, label: "Wan 2.2 I2V Plus", description: "万相 2.2 plus 图生视频。" }, buildWanI2VBody, VIDEO_POLL),
];

export const DASHSCOPE_R2V_ROUTES: readonly MediaRoute[] = [
  videoRoute({ model: M.wan27R2V, label: "Wan 2.7 R2V", description: "万相 2.7 多模态参考生视频(reference_image/video + 角色音色)。" }, buildWan27R2VBody, VIDEO_POLL_WAN27),
];

export const DASHSCOPE_VIDEO_EDIT_ROUTES: readonly MediaRoute[] = [
  videoRoute({ model: M.wan27VideoEdit, label: "Wan 2.7 Video Edit", description: "万相 2.7 视频编辑(指令改写 / 局部替换),720P。" }, buildWan27VideoEditBody, VIDEO_POLL_EDIT),
];

export const DASHSCOPE_S2V_ROUTES: readonly MediaRoute[] = [
  videoRoute(
    { model: M.wan22S2V, label: "Wan 2.2 S2V · 数字人对口型", description: "人像图 + 驱动音频 → 对口型视频(480P/720P)。" },
    buildS2VBody,
    VIDEO_POLL,
    { url: S2V_VIDEO_URL },
  ),
];
