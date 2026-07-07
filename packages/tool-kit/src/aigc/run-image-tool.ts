/**
 * `runImageTool` — AIGC 图像工具的**运行时编排器**(detoolspec-unify-builtin-tools)。
 *
 * 取代原 `engine/compile-tool.ts` 的 `runExecute`:它不是"声明式工具框架",而是一个接收显式
 * 参数(`routes` / `defaultModel` / `requiredParams` / `mediaFields`)的运行时函数,被
 * `image_generation` / `image_edit` 两个 `pi.registerTool` 的 `execute` 共同调用。
 *
 * 编排顺序(与重构前一致):
 *   必选项交互补全(ctx.ui)→ model 路由 → requiredVars 降级检查 → attachment ctx 检查 →
 *   媒体字段解析(att_→data URI→normalize)→ runEndpoint → 乐观预览 onUpdate → persistPicked →
 *   结果组装。任何失败 → `{ ok:false }` 不抛(fail-soft)。
 *
 * 本文件属于 **runtime 入口**(`./runtime` 子入口):仅 type-only 引入 pi SDK 类型,运行时值
 * 依赖均为本仓库执行层 util。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { Type } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import { checkRequiredVars } from "../engine/var-resolver.js";
import { runEndpoint } from "../engine/endpoint-adapter.js";
import { optimizePrompt } from "./optimize-prompt.js";
import type { StreamEvent } from "../engine/endpoint-types.js";
import { emitLivePreview } from "../surface/live-preview-seam.js";
import { normalizeImageDataUri } from "../engine/normalize-image.js";
import { getAttachmentToolContext } from "../attachment/seam.js";
import { getSessionState, type SessionStateAccess } from "../session-state.js";
import {
  persistPicked,
  previewAssetsFromPicked,
  resolveInputToDataUri,
  type PersistedAsset,
} from "../attachment/persist.js";
import type { ImageRoute, InteractionParam, ToolExecuteDetails } from "./types.js";

// 执行层日志(node-only;走 stderr sentinel)。命名空间 toolkit:tool —— provider 返回 / persist 耗时。
const log = createLogger({ namespace: "toolkit:tool" });

/** 工具执行返回结果(对齐 AgentToolResult)。 */
type ExecuteResult = AgentToolResult<ToolExecuteDetails>;

/** 注入依赖:测试 mock attachment ctx / fetch / 会话状态;生产走默认 seam + 全局 fetch。 */
export interface RunImageToolDeps {
  getCtx?: () => AttachmentToolContext;
  fetchImpl?: typeof fetch;
  /** 会话共享状态接入(用户偏好读写;aigc-prompt-toolbar)。默认 getSessionState(fail-safe)。 */
  getState?: () => SessionStateAccess;
}

/**
 * 用户偏好参数白名单(aigc-prompt-toolbar Req 4/5):仅这些参数读写会话偏好键 `aigc.<param>`。
 * requiredParams 里的一次性输入(如 prompt)不得记住。
 */
const PREF_PARAMS: readonly string[] = ["model", "size"];

/** `runImageTool` 选项:工具身份 + 路由表 + 补全/媒体声明。 */
export interface RunImageToolOptions {
  /** 工具名(产物命名前缀 + 日志维度)。 */
  toolName: string;
  /** model 路由表(非空)。 */
  routes: readonly ImageRoute[];
  /** 无 model 指定时的默认 model(必须存在于 routes)。 */
  defaultModel: string;
  /** 业务必选项交互补全声明(顺序即补全顺序)。 */
  requiredParams: readonly InteractionParam[];
  /** 需解析为 data URI 的图像字段名(如 ["image","mask","reference_images"])。 */
  mediaFields: readonly string[];
  /** 注入依赖(测试用)。 */
  deps?: RunImageToolDeps;
}

/** 构造工具 description:基础说明 + 可用 model 列表(复刻原 buildDescription 文案)。 */
export function buildModelsDescription(
  base: string,
  routes: readonly ImageRoute[],
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

/** 构造可选 `model` 枚举参数(enum = 各 route 的 model)。取代编译器自动注入。 */
export function optionalModelEnum(
  routes: readonly ImageRoute[],
  defaultModel: string,
): TSchema {
  const models = routes.map((m) => m.model);
  const desc =
    `Model to use. OMIT unless the user explicitly names a model in the conversation — ` +
    `when omitted, the user's preferred model (set in the UI) or the default (${defaultModel}) applies. ` +
    `Options: ${models.join(" | ")}`;
  const literals = models.map((m) => Type.Literal(m, { description: m }));
  const base: TSchema =
    literals.length === 1
      ? Type.Literal(models[0] as string, { description: desc })
      : Type.Union(literals as unknown as [TSchema, TSchema, ...TSchema[]], {
          description: desc,
        });
  return Type.Optional(base);
}

// ── model 路由 ─────────────────────────────────────────────────────────────────

/** 按优先级选取路由:args.model > defaultModel > 首项兜底。 */
function selectRoute(
  routes: readonly ImageRoute[],
  defaultModel: string,
  modelArg: string | undefined,
  toolName: string,
): ImageRoute {
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

// ── 必选项交互补全 ─────────────────────────────────────────────────────────────

type ResolveOutcome = { ok: true } | { ok: false; error: string };

/** 展开 select 选项:哨兵 "$models" → routes 的 model 集合;其余原样。 */
function expandOptions(spec: InteractionParam, routes: readonly ImageRoute[]): string[] {
  const out: string[] = [];
  for (const o of spec.options ?? []) {
    if (o === "$models") out.push(...routes.map((m) => m.model));
    else out.push(o);
  }
  return out;
}

/**
 * 对 requiredParams 逐一补全(在 provider 调用前):
 *  - 已有非空值 → 跳过;
 *  - 有交互 UI → select/input;取消 → ok:false;
 *  - 无交互 UI → fallback 优先;param==="model" 退回 defaultModel;否则缺失 → ok:false。
 */
async function resolveRequiredParams(
  specs: readonly InteractionParam[],
  routes: readonly ImageRoute[],
  defaultModel: string,
  merged: Record<string, unknown>,
  ext: ExtensionContext | undefined,
  prefState?: SessionStateAccess,
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
      // 追问写回(aigc-prompt-toolbar Req 5.1):仅白名单参数记为会话偏好,
      // 下行帧同步回显到工具排选择器;seam 不可用时 set 为 no-op。
      if (PREF_PARAMS.includes(spec.param)) {
        prefState?.set(`aigc.${spec.param}`, value);
      }
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

// ── 媒体字段解析(att_id → data URI → normalize) ──────────────────────────────

/** att_ → data URI → 规范化;非 att_/data: 的 https URL 原样透传。 */
async function resolveAndNormalizeImage(
  val: string,
  ctx: AttachmentToolContext,
): Promise<string> {
  const resolved = val.startsWith("att_") ? await resolveInputToDataUri(val, ctx) : val;
  return normalizeImageDataUri(resolved);
}

/** 对显式 mediaFields(string 或 string[])逐字段解析。 */
async function resolveMediaFields(
  mediaFields: readonly string[],
  merged: Record<string, unknown>,
  ctx: AttachmentToolContext,
): Promise<void> {
  for (const name of mediaFields) {
    const val = merged[name];
    if (typeof val === "string") {
      merged[name] = await resolveAndNormalizeImage(val, ctx);
    } else if (Array.isArray(val)) {
      merged[name] = await Promise.all(
        val.map(async (elem) =>
          typeof elem === "string" ? resolveAndNormalizeImage(elem, ctx) : elem,
        ),
      );
    }
  }
}

// ── 结果组装 ───────────────────────────────────────────────────────────────────

/** 组装成功结果(content:文本 + markdown 图;details:ok/model/assets)。形态与重构前一致。 */
function buildImageResult(
  assets: PersistedAsset[],
  model: string,
  opts: { preview?: boolean } = {},
): ExecuteResult {
  const headline = opts.preview
    ? `图像已生成:${assets.length} 张,正在保存…`
    : `生成成功:${assets.length} 张图像已保存 (${assets
        .map((a) => a.attachmentId)
        .join(", ")})。`;
  const summaryLines = [headline, ...assets.map((a) => `![${a.name}](${a.displayUrl})`)];
  return {
    content: [{ type: "text", text: summaryLines.join("\n") }],
    details: {
      ok: true,
      model,
      assets: assets.map((a) => ({
        attachmentId: a.attachmentId,
        displayUrl: a.displayUrl,
        mimeType: a.mimeType,
        name: a.name,
      })),
    },
  };
}

function errResult(error: string): ExecuteResult {
  return {
    content: [{ type: "text", text: error }],
    details: { ok: false, error },
  };
}

/** 流式思考/文本预览结果(preview 态,前端增量渲染;details 无 assets)。 */
function buildStreamingText(text: string, model: string): ExecuteResult {
  return {
    content: [{ type: "text", text }],
    details: { ok: true, model, assets: [] },
  };
}

/** 组装流式思考文案:优先思考(reasoning),再附答复正文;都空则占位。 */
function composeThinking(reasoning: string, text: string): string {
  const parts: string[] = [];
  if (reasoning) parts.push(`💭 ${reasoning}`);
  if (text) parts.push(text);
  return parts.join("\n\n") || "生成中…";
}

/**
 * 由 prompt 生成**文件名安全**的摘要前缀,使多张单图产物可区分——此前恒为 `<toolName>-0.png`
 * 同名(@ 引用列表对不上、对不上助手回复里的 att_ id)。清洗文件名非法字符 + 折叠空白为 `-`,
 * 截断到 24 码点(中文按码点,避免半个字);空/非字符串/清洗后为空 → 回退 `fallback`(工具名)。
 */
export function promptToNamePrefix(prompt: unknown, fallback: string): string {
  if (typeof prompt !== "string") return fallback;
  const cleaned = prompt
    .trim()
    // 文件名非法/易混字符(/ \ : * ? " < > | 及点、控制符)→ 空格,随后折叠为 `-`。
    .replace(/[/\\:*?"<>|.\n\r\t]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = [...cleaned].slice(0, 24).join("");
  return truncated.length > 0 ? truncated : fallback;
}

// ── 编排主函数 ─────────────────────────────────────────────────────────────────

export async function runImageTool(
  params: Record<string, unknown>,
  ext: ExtensionContext | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: ExecuteResult) => void) | undefined,
  opts: RunImageToolOptions,
): Promise<ExecuteResult> {
  const { toolName, routes, defaultModel, requiredParams, mediaFields, deps } = opts;

  // 提取 model 选择器;其余进 merged;model 纳入必选项补全候选。
  const { model: modelArg, ...llmArgs } = params as Record<string, unknown> & { model?: string };
  const merged: Record<string, unknown> = { ...llmArgs };
  if (typeof modelArg === "string" && modelArg !== "") merged.model = modelArg;

  // 用户偏好一级(aigc-prompt-toolbar Req 4):白名单参数缺省时读会话偏好 `aigc.<param>`。
  // 优先级:LLM 显式 args > 用户偏好 > defaultModel/交互补全。偏好命中即跳过对应追问;
  // seam 不可用(available:false)读恒 undefined → 行为与引入前完全一致。
  const getState = deps?.getState ?? getSessionState;
  const prefState = getState();
  for (const p of PREF_PARAMS) {
    const cur = merged[p];
    if (cur === undefined || cur === null || cur === "") {
      const pref = prefState.get<string>(`aigc.${p}`);
      if (typeof pref === "string" && pref !== "") merged[p] = pref;
    }
  }

  // 必选项交互补全(model/size/prompt);白名单参数的追问选择写回会话偏好(Req 5.1)。
  const fill = await resolveRequiredParams(
    requiredParams,
    routes,
    defaultModel,
    merged,
    ext,
    prefState,
  );
  if (!fill.ok) return errResult(fill.error);

  // model 路由(model 是路由键,不作 buildBody 入参)。
  const route = selectRoute(
    routes,
    defaultModel,
    typeof merged.model === "string" ? merged.model : undefined,
    toolName,
  );
  delete merged.model;

  // 降级:requiredVars。
  const varCheck = checkRequiredVars(route.requiredVars);
  if (!varCheck.ok) {
    return errResult(
      `能力不可用:缺少环境变量 ${varCheck.missing.join(", ")} (model="${route.model}")`,
    );
  }

  // 降级:attachment ctx。
  const getCtx = deps?.getCtx ?? (() => getAttachmentToolContext());
  const ctx = getCtx();
  if (!ctx.available) {
    return errResult("能力不可用:attachment 上下文未注入(runner 未装配)");
  }

  const startedAt = Date.now();
  log.debug("tool execute start", { tool: toolName, model: route.model });
  try {
    await resolveMediaFields(mediaFields, merged, ctx);

    // 提示词优化(aigc-tool-settings Req 4.3):会话开关为真时,在派发 provider 前对 prompt 调
    // 优化接缝并回写;为假/未设则完全不调用、prompt 透传(与既有行为一致)。本期接缝为无改写占位。
    if (
      prefState.get<boolean>("aigc.enablePromptOptimization") === true &&
      typeof merged.prompt === "string"
    ) {
      merged.prompt = await optimizePrompt(merged.prompt, { signal });
    }

    // 流式增量:图像 → ①全局 live-preview seam(canvas 等 surface 渐进显示,不依赖 onUpdate)②chat 卡片
    // 早弹(onUpdate,若有);reasoning/文本 → 仅 chat 卡片(onUpdate)。onStream 恒建,seam 覆盖对话流 +
    // 命令旁路两条生成路径(见 surface/live-preview-seam)。
    let lastReasoning = "";
    let lastText = "";
    let lastEmit = 0;
    let sawImagePreview = false;
    const THROTTLE_MS = 100;
    const onStream = (ev: StreamEvent): void => {
      if (ev.kind === "image") {
        // 流式图:data URI(includeDataUri)。先喂全局 seam(canvas 渐进),再喂 chat 卡片早弹。
        const preview = previewAssetsFromPicked(ev.picked, toolName, { includeDataUri: true });
        const url = preview[0]?.displayUrl;
        if (url !== undefined) {
          emitLivePreview({ displayUrl: url, stage: "partial" });
          if (onUpdate) {
            sawImagePreview = true;
            onUpdate(buildImageResult(preview, route.model, { preview: true }));
          }
        }
        return;
      }
      if (onUpdate === undefined) return; // 纯文本增量仅 chat 卡片需要
      if (ev.kind === "reasoning") lastReasoning = ev.text;
      else lastText = ev.text;
      if (sawImagePreview) return; // 图已早弹,不回退到思考文本
      const now = Date.now();
      if (now - lastEmit < THROTTLE_MS) return;
      lastEmit = now;
      onUpdate(buildStreamingText(composeThinking(lastReasoning, lastText), route.model));
    };

    const picked = await runEndpoint(route, merged, { signal, fetchImpl: deps?.fetchImpl, onStream });
    const providerMs = Date.now() - startedAt;
    log.info("provider returned", {
      tool: toolName,
      model: route.model,
      kind: picked.kind,
      providerMs,
    });

    // 乐观预览:出图后立刻发预览帧(原始网关 URL),persist 完成后用签名 URL 覆盖。
    if (onUpdate) {
      const preview = previewAssetsFromPicked(picked, toolName);
      if (preview.length > 0) {
        onUpdate(buildImageResult(preview, route.model, { preview: true }));
      }
    }

    const persistStartedAt = Date.now();
    const assets = await persistPicked(picked, ctx, {
      fetchImpl: deps?.fetchImpl,
      // prompt 摘要前缀:多张单图产物此前恒为 `<toolName>-0.png` 同名(@ 引用列表对不上、
      // 对不上助手回复的 att_ id)。用 prompt 摘要命名 → `赛博朋克2077风格的游戏画面-0.png`。
      namePrefix: promptToNamePrefix(merged.prompt, toolName),
    });
    log.info("assets persisted", {
      tool: toolName,
      count: assets.length,
      persistMs: Date.now() - persistStartedAt,
      totalMs: Date.now() - startedAt,
    });

    if (assets.length === 0) {
      const error = `provider 未返回有效图像产物 (kind=${picked.kind})`;
      log.warn("no assets persisted", { tool: toolName, kind: picked.kind });
      return errResult(`生成失败:${error}`);
    }

    return buildImageResult(assets, route.model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("tool execute failed", {
      tool: toolName,
      model: route.model,
      error: message,
      ms: Date.now() - startedAt,
    });
    return errResult(`生成失败:${message}`);
  } finally {
    // 生成结束(成功/失败/取消)清除全局渐进预览 seam(surface sink 据此清 livePreview)。
    emitLivePreview(null);
  }
}
