/**
 * `@blksails/pi-web-tool-kit` 工具编译器 — 把声明式 {@link ToolSpec} 包装成 pi ToolDefinition。
 *
 * 本文件属于 **runtime 入口**(`./runtime` 子入口),禁止从主入口 `src/index.ts`
 * 直接/间接引入。原因:它导入 `@earendil-works/pi-coding-agent`(`defineTool`)与
 * `@earendil-works/pi-ai`(`Type`),两者含 node-only 运行时依赖,不得进 Next/webpack
 * 前端 bundle(守 design Boundary / Req 6.1)。
 *
 * 执行语义(由 variants 重构拍平而来):
 *   1. 参数 schema 映射:inputSchema → pi Type.* 对象参数,追加可选 `model` 枚举选择器
 *      (enum = 各 ModelRoute.model)。
 *   2. model 路由:LLM args.model 命中 → 对应 ModelRoute;否则 tool.defaultModel;再兜底首项。
 *   3. 降级检查:requiredVars 缺失 || ctx.available===false → { ok:false, error } 不抛。
 *   4. 成功路径:runEndpoint → persistPicked → 组装 content+details。
 *   5. 顶层 try/catch:任何错误 → { ok:false, error },不崩溃子进程(Req 1.6/6.x)。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { createLogger } from "@blksails/pi-web-logger";
import type { TSchema } from "@earendil-works/pi-ai";
import type {
  ToolDefinition,
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import { checkRequiredVars } from "./var-resolver.js";
import { runEndpoint } from "./endpoint-adapter.js";
import { normalizeImageDataUri } from "./normalize-image.js";
import { getAttachmentToolContext } from "../attachment/seam.js";
import {
  persistPicked,
  previewAssetsFromPicked,
  resolveInputToDataUri,
  type PersistedAsset,
} from "../attachment/persist.js";
import type {
  ToolSpec,
  JsonSchemaProp,
  MediaKind,
  ModelRoute,
  InteractionSpec,
} from "./types.js";

// 执行层日志(node-only runtime 子入口;走 stderr sentinel,默认门控由 runner 的
// initConfigFromEnv 决定)。命名空间 toolkit:tool —— 主时间线:provider 返回 / persist 耗时。
const log = createLogger({ namespace: "toolkit:tool" });

/** 编译依赖注入:测试注入 mock ctx / fetch;生产走默认 seam + proxyFetch。 */
export interface CompileDeps {
  /** 读取 attachment ctx;默认从 globalThis seam 取得。 */
  getCtx?: () => AttachmentToolContext;
  /** 注入式 fetch;默认全局 fetch / proxyFetch。 */
  fetchImpl?: typeof fetch;
}

// ── JSON Schema → pi Type 映射 ─────────────────────────────────────────────────

/**
 * 把单个 JsonSchemaProp 映射成对应的 pi `Type.*` schema。
 * - required=false 时包装进 Type.Optional。
 * - enum 字段:用 Type.Union([Type.Literal(...)]) 枚举。
 * - 不支持的类型(object/array 复杂嵌套)退化为 Type.Any()。
 */
function jsonSchemaToType(prop: JsonSchemaProp, required: boolean): TSchema {
  let base: TSchema;

  if (prop.enum && prop.enum.length > 0) {
    // enum → Type.Union(Type.Literal[])
    const literals = prop.enum.map((v) =>
      typeof v === "number"
        ? Type.Literal(v, { description: String(v) })
        : Type.Literal(String(v), { description: String(v) }),
    );
    if (literals.length === 1) {
      base = literals[0] as TSchema;
    } else {
      base = Type.Union(literals as unknown as [TSchema, TSchema, ...TSchema[]], {
        description: prop.description,
      });
    }
  } else {
    const opts = prop.description ? { description: prop.description } : {};
    switch (prop.type) {
      case "string":
        base = Type.String(opts);
        break;
      case "number":
        base = Type.Number(opts);
        break;
      case "integer":
        base = Type.Integer(opts);
        break;
      case "boolean":
        base = Type.Boolean(opts);
        break;
      case "array":
        base = Type.Array(Type.Any(), opts);
        break;
      case "object":
        base = Type.Object({}, opts);
        break;
      default: {
        // TypeScript exhaustiveness — 未来新类型退化为 Any
        const _never: never = prop.type;
        void _never;
        base = Type.Any(opts);
      }
    }
  }

  return required ? base : Type.Optional(base);
}

/**
 * 把 ToolSpec.inputSchema 映射成 pi Type.Object,
 * 额外追加可选 `model` 枚举参数(model 路由选择器)。
 */
function buildParameters(tool: ToolSpec): TSchema {
  const props: Record<string, TSchema> = {};
  const required = new Set(tool.inputSchema.required ?? []);

  for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
    props[name] = jsonSchemaToType(prop, required.has(name));
  }

  // 追加可选 model 枚举(LLM 路由选择器,enum = 各 ModelRoute.model)
  const models = tool.models.map((m) => m.model);
  const desc = `Model to use. Omit for default (${tool.defaultModel}). Options: ${models.join(" | ")}`;
  const literals = models.map((m) => Type.Literal(m, { description: m }));
  const base: TSchema =
    literals.length === 1
      ? Type.Literal(models[0] as string, { description: desc })
      : Type.Union(
          literals as unknown as [TSchema, TSchema, ...TSchema[]],
          { description: desc },
        );
  props.model = Type.Optional(base);

  return Type.Object(props);
}

// ── model 路由查找 ─────────────────────────────────────────────────────────────

/** 精确名称匹配 model 路由;未命中返回 undefined。 */
function findRoute(tool: ToolSpec, model: string): ModelRoute | undefined {
  return tool.models.find((m) => m.model === model);
}

/** 按优先级选取 active 路由:args.model > defaultModel > 首项兜底。 */
function selectModelRoute(
  tool: ToolSpec,
  modelArg: string | undefined,
): ModelRoute {
  if (modelArg) {
    const found = findRoute(tool, modelArg);
    if (found) return found;
    // LLM 传了无效 model → 警告降级(走日志系统,而非裸 console.warn 被降级为 proc:stderr)
    log.warn("unknown model; falling back to default", {
      tool: tool.name,
      model: modelArg,
    });
  }
  const def = findRoute(tool, tool.defaultModel);
  if (def) return def;
  const first = tool.models[0];
  if (!first) throw new Error(`Tool "${tool.name}" has no models`);
  return first;
}

// ── 工具描述构造 ──────────────────────────────────────────────────────────────

function buildDescription(tool: ToolSpec): string {
  const lines = tool.models.map((m) => {
    const star = m.model === tool.defaultModel ? " (default)" : "";
    const desc = m.description ? ` — ${m.description}` : "";
    return `- \`${m.model}\`${star}: ${m.label}${desc}`;
  });
  return [
    tool.description.trim(),
    "",
    'Available models (pass `model: "<id>"` to choose; omit for default):',
    ...lines,
  ].join("\n");
}

// ── 工具执行结果类型 ───────────────────────────────────────────────────────────

/** 工具执行结果的 details 判别联合。 */
export type ToolExecuteDetails =
  | {
      ok: true;
      model: string;
      assets: {
        attachmentId: string;
        displayUrl: string;
        mimeType: string;
        name: string;
      }[];
    }
  | { ok: false; error: string };

/** 工具执行返回结果(对齐 AgentToolResult)。 */
type ExecuteResult = AgentToolResult<ToolExecuteDetails>;

// ── 媒体字段解析(att_id → data URI) ─────────────────────────────────────────

/** 判断 mediaKind 是否包含 "image"。 */
function hasImageMediaKind(
  mediaKind: MediaKind | ReadonlyArray<MediaKind> | undefined,
): boolean {
  if (!mediaKind) return false;
  if (Array.isArray(mediaKind)) return (mediaKind as ReadonlyArray<MediaKind>).includes("image");
  return mediaKind === "image";
}

/**
 * 遍历 inputSchema.properties,把值中所有 `att_...` 前缀的 attachment id
 * 通过 `resolveInputToDataUri` 替换为 data URI。
 *
 * 规则:
 *  - `type:"string"` + `mediaKind:"image"` + value 以 `att_` 开头 → resolve
 *  - `type:"array"` + (prop 或 items 有 `mediaKind:"image"`) → 逐元素解析 att_ 前缀
 *  - 其他(已是 data: / https:// 等)→ 透传
 *  - resolve 失败 → 抛出,由 runExecute 的 try/catch 捕获并返回 ok:false
 */
async function resolveMediaFields(
  tool: ToolSpec,
  merged: Record<string, unknown>,
  ctx: AttachmentToolContext,
): Promise<void> {
  const { properties } = tool.inputSchema;

  for (const [name, prop] of Object.entries(properties)) {
    const isImageProp = hasImageMediaKind(prop.mediaKind);

    if (prop.type === "string" && isImageProp) {
      const val = merged[name];
      if (typeof val === "string") {
        merged[name] = await resolveAndNormalizeImage(val, ctx);
      }
    } else if (prop.type === "array") {
      // 数组类型:看 prop 或 items 是否有 image mediaKind
      const itemsHaveImage = hasImageMediaKind(prop.items?.mediaKind);
      if (isImageProp || itemsHaveImage) {
        const arr = merged[name];
        if (Array.isArray(arr)) {
          merged[name] = await Promise.all(
            arr.map(async (elem) =>
              typeof elem === "string"
                ? resolveAndNormalizeImage(elem, ctx)
                : elem,
            ),
          );
        }
      }
    }
  }
}

/**
 * 解析图像输入并规范化:`att_` → data URI;随后对 data URI 剥元数据/烘焙方向/控尺寸
 * (见 {@link normalizeImageDataUri},失败回退),以规避网关对 iPhone 多图 JPEG(AMPF/EXIF)
 * 的渠道选择失败。非 `att_`、非 data: 的输入(如 https URL)原样透传。
 */
async function resolveAndNormalizeImage(
  val: string,
  ctx: AttachmentToolContext,
): Promise<string> {
  const resolved = val.startsWith("att_")
    ? await resolveInputToDataUri(val, ctx)
    : val;
  return normalizeImageDataUri(resolved);
}

// ── 必选项交互补全(aigc-tools-interactive-params) ────────────────────────────

/** 交互补全结果:成功或带可读原因的失败(取消 / 无 UI 缺无兜底项)。 */
type ResolveOutcome = { ok: true } | { ok: false; error: string };

/** 展开 select 选项:哨兵 "$models" → tool.models 的 model 集合;其余原样。 */
function expandOptions(spec: InteractionSpec, tool: ToolSpec): string[] {
  const out: string[] = [];
  for (const o of spec.options ?? []) {
    if (o === "$models") out.push(...tool.models.map((m) => m.model));
    else out.push(o);
  }
  return out;
}

/**
 * 对 tool.requiredParams 声明的业务必选项逐一补全(在 provider 调用前):
 *  - 已有非空值 → 跳过(R7);
 *  - 有交互 UI(ext.hasUI && ext.ui)→ select(model/size)/ input(prompt);取消(undefined/空)→ ok:false(R5);
 *  - 无交互 UI → fallback 优先;param==="model" 退回 defaultModel;否则缺失 → ok:false(R6)。
 * 直接在 merged 上写回补全值。
 */
async function resolveRequiredParams(
  tool: ToolSpec,
  merged: Record<string, unknown>,
  ext: ExtensionContext | undefined,
): Promise<ResolveOutcome> {
  const specs = tool.requiredParams;
  if (!specs || specs.length === 0) return { ok: true };

  const hasUI = ext?.hasUI === true && ext.ui != null;

  for (const spec of specs) {
    const cur = merged[spec.param];
    if (cur !== undefined && cur !== null && cur !== "") continue;

    if (hasUI) {
      const value =
        spec.via === "select"
          ? await ext!.ui.select(spec.title, expandOptions(spec, tool))
          : await ext!.ui.input(spec.title, spec.placeholder);
      if (value === undefined || value === "") {
        return { ok: false, error: `已取消:未提供必选项「${spec.param}」` };
      }
      merged[spec.param] = value;
    } else if (spec.fallback !== undefined) {
      merged[spec.param] = spec.fallback;
    } else if (spec.param === "model") {
      merged[spec.param] = tool.defaultModel;
    } else {
      return {
        ok: false,
        error: `缺少必选项「${spec.param}」且当前环境无可交互 UI`,
      };
    }
  }
  return { ok: true };
}

// ── 执行核心函数(便于 execute 保持简洁) ─────────────────────────────────────

/**
 * 把一组(预览/已落库)资产组装成成功的 {@link ExecuteResult}。
 * preview=true 表示尚未落库(attachmentId 为空、displayUrl 是原始网关 URL),用于
 * provider 出图后、persist 完成前的乐观预览中间帧;最终帧用签名 displayUrl 覆盖。
 */
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
  const summaryLines = [
    headline,
    ...assets.map((a) => `![${a.name}](${a.displayUrl})`),
  ];
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

async function runExecute(
  tool: ToolSpec,
  deps: CompileDeps | undefined,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  ext: ExtensionContext | undefined,
  onUpdate?: (partial: ExecuteResult) => void,
): Promise<ExecuteResult> {
  // ── 提取 model 选择器,其余参数进合并;model 一并纳入必选项补全候选 ──────────
  const { model: modelArg, ...llmArgs } = params as Record<string, unknown> & {
    model?: string;
  };
  const merged: Record<string, unknown> = { ...llmArgs };
  if (typeof modelArg === "string" && modelArg !== "") merged.model = modelArg;

  // ── 必选项交互补全(model/size/prompt;缺失才触发,在 provider 调用前)─────────
  const fill = await resolveRequiredParams(tool, merged, ext);
  if (!fill.ok) {
    return {
      content: [{ type: "text", text: fill.error }],
      details: { ok: false, error: fill.error },
    };
  }

  // ── model 路由(merged.model 已补全或仍缺→默认);model 是路由键,不作 buildBody 入参 ──
  const route = selectModelRoute(
    tool,
    typeof merged.model === "string" ? merged.model : undefined,
  );
  delete merged.model;

  // ── 降级检查:requiredVars ──────────────────────────────────────────────
  const varCheck = checkRequiredVars(route.requiredVars);
  if (!varCheck.ok) {
    const error = `能力不可用:缺少环境变量 ${varCheck.missing.join(", ")} (model="${route.model}")`;
    return {
      content: [{ type: "text", text: error }],
      details: { ok: false, error },
    };
  }

  // ── 降级检查:attachment ctx ─────────────────────────────────────────────
  const getCtx = deps?.getCtx ?? (() => getAttachmentToolContext());
  const ctx = getCtx();
  if (!ctx.available) {
    const error = "能力不可用:attachment 上下文未注入(runner 未装配)";
    return {
      content: [{ type: "text", text: error }],
      details: { ok: false, error },
    };
  }

  // ── 执行 ────────────────────────────────────────────────────────────────
  const startedAt = Date.now();
  log.debug("tool execute start", { tool: tool.name, model: route.model });
  try {
    // att_id → data URI:在 buildBody 前解析 inputSchema 中 mediaKind:image 字段
    await resolveMediaFields(tool, merged, ctx);

    const picked = await runEndpoint(route, merged, {
      signal,
      fetchImpl: deps?.fetchImpl,
    });
    // provider 已出图 —— 对照后台网关"已返回"的时刻;此后的 persist 才是前端继续等待的窗口。
    const providerMs = Date.now() - startedAt;
    log.info("provider returned", {
      tool: tool.name,
      model: route.model,
      kind: picked.kind,
      providerMs,
    });

    // 乐观预览 + 进度反馈:provider 已出图,persist(下载+落库+签名)是紧接着的额外
    // 重活,会让"完成态"滞后于实际出图。出图后立刻发一个 preliminary 帧(原始网关
    // URL),工具卡即翻 Streaming 并秒显图;随后 persist 完成,end 帧用签名 URL 覆盖。
    // preliminary 帧只供 UI 流式展示,不进模型上下文,故承载会过期的网关 URL 是安全的。
    if (onUpdate) {
      const preview = previewAssetsFromPicked(picked, tool.name);
      if (preview.length > 0) {
        onUpdate(buildImageResult(preview, route.model, { preview: true }));
      }
    }

    const persistStartedAt = Date.now();
    const assets = await persistPicked(picked, ctx, {
      fetchImpl: deps?.fetchImpl,
      namePrefix: tool.name,
    });
    log.info("assets persisted", {
      tool: tool.name,
      count: assets.length,
      persistMs: Date.now() - persistStartedAt,
      totalMs: Date.now() - startedAt,
    });

    // 无落库产物(provider 返回 raw/空 url,实为解析失败)→ 报失败而非误导性 ok:true。
    if (assets.length === 0) {
      const error = `provider 未返回有效图像产物 (kind=${picked.kind})`;
      log.warn("no assets persisted", { tool: tool.name, kind: picked.kind });
      return {
        content: [{ type: "text", text: `生成失败:${error}` }],
        details: { ok: false, error },
      };
    }

    // 组装 content:文本说明 + markdown 图片(承载带签名 displayUrl)。
    // 注:displayUrl 须经 content 传到前端 —— pi 的 tool result 消息流只携带 content,
    // details(结构化明细)不进消息流到前端;故产物引用随 content 走,aigc web-ext renderer
    // 据此从 content 提取 displayUrl 渲染 <img>(默认卡片回退为 JSON/文本)。
    return buildImageResult(assets, route.model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("tool execute failed", {
      tool: tool.name,
      model: route.model,
      error: message,
      ms: Date.now() - startedAt,
    });
    return {
      content: [{ type: "text", text: `生成失败:${message}` }],
      details: { ok: false, error: message },
    };
  }
}

// ── 主编译函数 ────────────────────────────────────────────────────────────────

/**
 * 把 {@link ToolSpec} 编译成 pi `ToolDefinition`。
 *
 * @param tool  工具声明(纯数据,无值导入运行时)。
 * @param deps  可选注入依赖(测试 mock);省略则走生产默认。
 */
export function compileTool(
  tool: ToolSpec,
  deps?: CompileDeps,
): ToolDefinition<TSchema, ToolExecuteDetails> {
  const parameters = buildParameters(tool);

  return defineTool<TSchema, ToolExecuteDetails>({
    name: tool.name,
    label: tool.label ?? tool.name,
    description: buildDescription(tool),
    parameters,

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ext: ExtensionContext,
    ): Promise<ExecuteResult> {
      // pi 把 onUpdate(partialResult)→ tool_execution_update 事件 → 前端 preliminary
      // 工具帧。透传它,让出图与落库之间能流式反馈(见 runExecute 乐观预览)。
      const emit =
        typeof onUpdate === "function"
          ? (partial: ExecuteResult) =>
              (onUpdate as (p: ExecuteResult) => void)(partial)
          : undefined;
      return runExecute(tool, deps, params, signal, ext, emit);
    },
  });
}
