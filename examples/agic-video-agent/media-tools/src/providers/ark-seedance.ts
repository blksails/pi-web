/**
 * Volcengine Ark Seedance 视频 provider —— 端口自 pi-labs `providers/ark-seedance/*`。
 * 与 DashScope 形成双 provider(i2v / multimodal-reference)。环境闸:需 `ARK_API_KEY`。
 */
import type { AsyncSpec, PickedResult } from "@blksails/pi-web-tool-kit/runtime";
import type { MediaRoute } from "../media-types.js";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const HEADERS = { authorization: "Bearer ${ARK_API_KEY}" };
const REQUIRED_VARS = ["ARK_API_KEY"] as const;
const MAX_IMAGE_BLOCKS = 9;

const SEEDANCE_MODELS = {
  flagship: "doubao-seedance-2-0-260128",
  pro: "doubao-seedance-1-0-pro-250528",
} as const;

type Submit = { id: string };
type Status = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  content?: { video_url?: string; last_frame_url?: string };
  error?: { code?: string; message?: string };
};

function pickResult(r: unknown): PickedResult {
  const content = (r as Status).content;
  const url = content?.video_url;
  if (!url) return { kind: "raw", value: r };
  return content?.last_frame_url ? { kind: "video", url, lastFrameUrl: content.last_frame_url } : { kind: "video", url };
}

function detectError(r: unknown): string | undefined {
  const st = (r as Status).status;
  if (st === "failed" || st === "cancelled" || st === "expired") {
    return (r as Status).error?.message ?? `task ${st}`;
  }
  return undefined;
}

const taskUrl = (s: unknown) => `${ARK_URL}/${(s as Submit).id}`;
const POLLING: AsyncSpec = {
  statusUrl: taskUrl,
  responseUrl: taskUrl,
  isComplete: (s: unknown) => (s as Status).status === "succeeded",
  isFailed: (s: unknown) => {
    const st = (s as Status).status;
    return st === "failed" || st === "cancelled" || st === "expired";
  },
  pollMs: 10_000,
  timeoutMs: 30 * 60_000,
};

interface SharedArgs { prompt: string; duration?: number; resolution?: string; ratio?: string; seed?: number; }
interface I2VArgs extends SharedArgs { first_frame_url: string; last_frame_url?: string; reference_image_urls?: string[]; }
interface MMArgs extends SharedArgs { reference_image_urls?: string[]; reference_video_urls?: string[]; reference_audio_urls?: string[]; }

function wrapParameters(model: string, content: unknown[], a: SharedArgs) {
  return {
    model,
    content,
    duration: a.duration ?? 5,
    ...(a.resolution ? { resolution: a.resolution } : {}),
    ...(a.ratio ? { ratio: a.ratio } : {}),
    ...(typeof a.seed === "number" && a.seed >= 0 ? { seed: a.seed } : {}),
    watermark: false,
  };
}

function buildImageToVideoBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as I2VArgs;
    const refs = a.reference_image_urls ?? [];
    const total = 1 + (a.last_frame_url ? 1 : 0) + refs.length;
    if (total > MAX_IMAGE_BLOCKS) throw new Error(`Seedance 图像块超限:${total}(最多 ${MAX_IMAGE_BLOCKS})。`);
    const content: Record<string, unknown>[] = [
      { type: "image_url", image_url: { url: a.first_frame_url }, role: "first_frame" },
    ];
    if (a.last_frame_url) content.push({ type: "image_url", image_url: { url: a.last_frame_url }, role: "last_frame" });
    for (const url of refs) content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    content.push({ type: "text", text: a.prompt });
    return wrapParameters(model, content, a);
  };
}

function buildMultimodalBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as MMArgs;
    const refImgs = a.reference_image_urls ?? [];
    const refVids = a.reference_video_urls ?? [];
    const refAuds = a.reference_audio_urls ?? [];
    if (refImgs.length === 0 && refVids.length === 0 && refAuds.length === 0) {
      throw new Error("multimodal_reference_video 至少需要一个参考素材。");
    }
    if (refImgs.length > MAX_IMAGE_BLOCKS) throw new Error(`Seedance reference_image 超限:${refImgs.length}。`);
    const content: Record<string, unknown>[] = [];
    for (const url of refImgs) content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    for (const url of refVids) content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
    for (const url of refAuds) content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
    content.push({ type: "text", text: a.prompt });
    return wrapParameters(model, content, a);
  };
}

interface RouteMeta { model: string; label: string; description: string; }
function seedanceRoute(meta: RouteMeta, buildBody: (model: string) => (args: Record<string, unknown>) => unknown): MediaRoute {
  return {
    model: meta.model,
    label: meta.label,
    description: meta.description,
    provider: "ark",
    url: ARK_URL,
    headers: HEADERS,
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildBody(meta.model),
    async: POLLING,
    pickResult,
    detectError,
  };
}

export const SEEDANCE_I2V_ROUTES: readonly MediaRoute[] = [
  seedanceRoute({ model: SEEDANCE_MODELS.flagship, label: "Seedance 2.0 Flagship · I2V", description: "首/尾帧 + 参考图,效果最稳,Up to 1080p。" }, buildImageToVideoBody),
  seedanceRoute({ model: SEEDANCE_MODELS.pro, label: "Seedance 1.0 Pro · I2V", description: "性价比最高,单帧驱动(不支持多帧参考)。" }, buildImageToVideoBody),
];

export const SEEDANCE_MULTIMODAL_ROUTES: readonly MediaRoute[] = [
  seedanceRoute({ model: SEEDANCE_MODELS.flagship, label: "Seedance 2.0 · Multimodal", description: "纯参考素材(图/视频/音频)起手生成,无首/尾帧。" }, buildMultimodalBody),
];
