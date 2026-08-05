/**
 * `runMediaTool` — 媒体工具(视频生成 / TTS / 本地 ffmpeg)的运行时编排器。
 *
 * 与 tool-kit `runImageTool` 同骨架,但:
 *  - kind-aware:结果文案与 details 按 image/video/audio 生成(runImageTool 写死「X 张图像」)。
 *  - 媒体输入分两类:`imageInputFields`(att_→dataURI→图像归一化,如视频首/尾帧)与
 *    `urlInputFields`(att_→可 fetch 展示 URL;https 原样透传,如 video_url/audio_url)——
 *    图像归一化只能用于图像,音视频输入过它会损坏(这正是不能直接复用 runImageTool 的原因)。
 *  - 落库走本包泛化的 {@link persistMedia}(video/audio 亦落库)。
 *
 * 复用 vendor 引擎:runEndpoint(HTTP 同步/异步轮询/runLocal 分发) + attachment seam。零改 vendor。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { Type } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import {
  runEndpoint,
  checkRequiredVars,
  getAttachmentToolContext,
  resolveInputToDataUri,
  normalizeImageDataUri,
} from "@blksails/pi-web-tool-kit/runtime";
import type { InteractionParam, MediaAsset, MediaKind, MediaRoute, MediaToolDetails } from "./media-types.js";
import { persistMedia } from "./persist-media.js";

const log = createLogger({ namespace: "media-tools:run" });

type ExecuteResult = AgentToolResult<MediaToolDetails>;

export interface RunMediaToolOptions {
  /** 工具名(产物命名前缀 + 日志维度)。 */
  toolName: string;
  /** model 路由表(非空)。 */
  routes: readonly MediaRoute[];
  /** 无 model 指定时的默认 model(必须存在于 routes)。 */
  defaultModel: string;
  /** 业务必选项交互补全声明(顺序即补全顺序)。 */
  requiredParams: readonly InteractionParam[];
  /** att_→dataURI + 图像归一化的**图像**字段(视频生成首/尾/参考帧)。 */
  imageInputFields?: readonly string[];
  /** att_→可 fetch 展示 URL、https 透传的**音视频**字段(远程 provider 消费:video_url/audio_url…)。 */
  urlInputFields?: readonly string[];
  /** att_→**本地绝对路径**(handle.localPath())的字段(本地 ffmpeg 消费;非 att_ 原样,https 由 fetchToTmp 下载)。 */
  localFileFields?: readonly string[];
  /** 注入依赖(测试用)。 */
  deps?: { getCtx?: () => AttachmentToolContext; fetchImpl?: typeof fetch };
}

/** 工具 description:基础说明 + 可用 model 列表。 */
export function buildModelsDescription(
  base: string,
  routes: readonly MediaRoute[],
  defaultModel: string,
): string {
  const lines = routes.map((m) => {
    const star = m.model === defaultModel ? " (default)" : "";
    const desc = m.description ? ` — ${m.description}` : "";
    return `- \`${m.model}\`${star}: ${m.label}${desc}`;
  });
  return [
    base.trim(),
    "",
    'Available models (pass `model: "<id>"` to choose; omit for default):',
    ...lines,
  ].join("\n");
}

/** 可选 `model` 枚举参数(enum = 各 route 的 model)。 */
export function optionalModelEnum(routes: readonly MediaRoute[], defaultModel: string): TSchema {
  const models = routes.map((m) => m.model);
  const desc =
    `Model to use. OMIT unless the user explicitly names a model. ` +
    `Default: ${defaultModel}. Options: ${models.join(" | ")}`;
  const first = models[0];
  if (first === undefined) return Type.Optional(Type.String({ description: desc }));
  const base: TSchema =
    models.length === 1
      ? Type.Literal(first, { description: desc })
      : Type.Union(
          models.map((m) => Type.Literal(m, { description: m })) as unknown as [TSchema, TSchema, ...TSchema[]],
          { description: desc },
        );
  return Type.Optional(base);
}

// ── 路由选择 ─────────────────────────────────────────────────────────────────

function selectRoute(
  routes: readonly MediaRoute[],
  defaultModel: string,
  modelArg: string | undefined,
  toolName: string,
): MediaRoute {
  if (modelArg) {
    const found = routes.find((m) => m.model === modelArg);
    if (found) return found;
    log.warn("unknown model; falling back to default", { tool: toolName, model: modelArg });
  }
  const def = routes.find((m) => m.model === defaultModel);
  if (def) return def;
  const first = routes[0];
  if (!first) throw new Error(`Tool "${toolName}" has no routes`);
  return first;
}

// ── 必选项交互补全 ───────────────────────────────────────────────────────────

type ResolveOutcome = { ok: true } | { ok: false; error: string };

function expandOptions(spec: InteractionParam, routes: readonly MediaRoute[]): string[] {
  const out: string[] = [];
  for (const o of spec.options ?? []) {
    if (o === "$models") out.push(...routes.map((m) => m.model));
    else out.push(o);
  }
  return out;
}

async function resolveRequiredParams(
  specs: readonly InteractionParam[],
  routes: readonly MediaRoute[],
  defaultModel: string,
  merged: Record<string, unknown>,
  ext: ExtensionContext | undefined,
): Promise<ResolveOutcome> {
  if (specs.length === 0) return { ok: true };
  const hasUI = ext?.hasUI === true && ext.ui != null;

  for (const spec of specs) {
    const cur = merged[spec.param];
    if (cur !== undefined && cur !== null && cur !== "") continue;

    if (hasUI) {
      const value =
        spec.via === "select"
          ? await ext!.ui.select(spec.title, expandOptions(spec, routes))
          : await ext!.ui.input(spec.title, spec.placeholder);
      if (value === undefined || value === "") {
        return { ok: false, error: `已取消:未提供必选项「${spec.param}」` };
      }
      merged[spec.param] = value;
    } else if (spec.fallback !== undefined) {
      merged[spec.param] = spec.fallback;
    } else if (spec.param === "model") {
      merged[spec.param] = defaultModel;
    } else {
      return { ok: false, error: `缺少必选项「${spec.param}」且当前环境无可交互 UI` };
    }
  }
  return { ok: true };
}

// ── 媒体输入解析 ─────────────────────────────────────────────────────────────

/** 图像字段:att_→dataURI→归一化;非 att_ 原样。 */
async function resolveImageField(val: string, ctx: AttachmentToolContext): Promise<string> {
  const resolved = val.startsWith("att_") ? await resolveInputToDataUri(val, ctx) : val;
  return normalizeImageDataUri(resolved);
}

/** 远程 provider 字段:att_→可 fetch 展示 URL;https 原样。 */
async function resolveUrlField(val: string, ctx: AttachmentToolContext): Promise<string> {
  if (!val.startsWith("att_")) return val;
  const handle = await ctx.resolve(val);
  return handle.url();
}

/**
 * 本地 ffmpeg 字段:att_→**本地绝对路径**(LocalFs 直返落盘路径;远程后端懒下载临时文件)。
 * 非 att_ 原样透传(https 交由 fetchToTmp 下载)。此前误用 resolveUrlField 返回相对
 * `/api/attachments/…` URL,fetchToTmp 的 `new URL()` 无 origin 解析失败(att_ 引用作 ffmpeg 输入即报错)。
 */
async function resolveLocalField(val: string, ctx: AttachmentToolContext): Promise<string> {
  if (!val.startsWith("att_")) return val;
  const handle = await ctx.resolve(val);
  return handle.localPath();
}

async function resolveFields(
  fields: readonly string[] | undefined,
  merged: Record<string, unknown>,
  ctx: AttachmentToolContext,
  resolver: (val: string, ctx: AttachmentToolContext) => Promise<string>,
): Promise<void> {
  if (!fields) return;
  for (const name of fields) {
    const val = merged[name];
    if (typeof val === "string" && val !== "") {
      merged[name] = await resolver(val, ctx);
    } else if (Array.isArray(val)) {
      merged[name] = await Promise.all(
        val.map((elem) => (typeof elem === "string" && elem !== "" ? resolver(elem, ctx) : elem)),
      );
    }
  }
}

// ── 结果组装 ─────────────────────────────────────────────────────────────────

const KIND_NOUN: Record<string, string> = { image: "图像", video: "视频", audio: "音频" };

function okResult(kind: MediaKind, model: string, assets: MediaAsset[]): ExecuteResult {
  const noun = KIND_NOUN[kind] ?? "产物";
  const headline = `生成成功:${assets.length} 个${noun}已保存 (${assets
    .map((a) => a.attachmentId)
    .join(", ")})。`;
  // content 里附 markdown 链接作渲染兜底(details 不到前端时,渲染器仍可从 content 解析出
  // displayUrl;kind 再由 mimeType/扩展名判定)。本包工具均注册专属渲染器,content 只喂它。
  const lines = [headline, ...assets.map((a) => `![${a.name}](${a.displayUrl})`)];
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: { ok: true, model, kind, assets },
  };
}

function errResult(error: string): ExecuteResult {
  return { content: [{ type: "text", text: error }], details: { ok: false, error } };
}

// ── 编排主函数 ───────────────────────────────────────────────────────────────

export async function runMediaTool(
  params: Record<string, unknown>,
  ext: ExtensionContext | undefined,
  signal: AbortSignal | undefined,
  _onUpdate: ((partial: ExecuteResult) => void) | undefined,
  opts: RunMediaToolOptions,
): Promise<ExecuteResult> {
  const { toolName, routes, defaultModel, requiredParams, imageInputFields, urlInputFields, localFileFields, deps } = opts;

  const { model: modelArg, ...llmArgs } = params as Record<string, unknown> & { model?: string };
  const merged: Record<string, unknown> = { ...llmArgs };
  if (typeof modelArg === "string" && modelArg !== "") merged.model = modelArg;

  const fill = await resolveRequiredParams(requiredParams, routes, defaultModel, merged, ext);
  if (!fill.ok) return errResult(fill.error);

  const route = selectRoute(
    routes,
    defaultModel,
    typeof merged.model === "string" ? merged.model : undefined,
    toolName,
  );
  delete merged.model;

  const varCheck = checkRequiredVars(route.requiredVars);
  if (!varCheck.ok) {
    return errResult(`能力不可用:缺少环境变量 ${varCheck.missing.join(", ")} (model="${route.model}")`);
  }

  const getCtx = deps?.getCtx ?? (() => getAttachmentToolContext());
  const ctx = getCtx();
  if (!ctx.available) {
    return errResult("能力不可用:attachment 上下文未注入(runner 未装配)");
  }

  const startedAt = Date.now();
  log.debug("media tool start", { tool: toolName, model: route.model });
  try {
    await resolveFields(imageInputFields, merged, ctx, resolveImageField);
    await resolveFields(urlInputFields, merged, ctx, resolveUrlField);
    await resolveFields(localFileFields, merged, ctx, resolveLocalField);

    const picked = await runEndpoint(route, merged, { signal, fetchImpl: deps?.fetchImpl });
    log.info("provider returned", { tool: toolName, model: route.model, kind: picked.kind });

    const persisted = await persistMedia(picked, ctx, {
      fetchImpl: deps?.fetchImpl,
      namePrefix: toolName,
    });
    if (persisted === null || persisted.assets.length === 0) {
      return errResult(`生成失败:provider 未返回可落库媒体产物 (kind=${picked.kind})`);
    }
    log.info("assets persisted", {
      tool: toolName,
      kind: persisted.kind,
      count: persisted.assets.length,
      totalMs: Date.now() - startedAt,
    });
    return okResult(persisted.kind, route.model, persisted.assets);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("media tool failed", { tool: toolName, model: route.model, error: message });
    return errResult(`生成失败:${message}`);
  }
}
