/**
 * `@pi-web/tool-kit` Category 编译器 — 把声明式 Category 包装成 pi ToolDefinition。
 *
 * 本文件属于 **runtime 入口**(`./runtime` 子入口),禁止从主入口 `src/index.ts`
 * 直接/间接引入。原因:它导入 `@earendil-works/pi-coding-agent`(`defineTool`)与
 * `@earendil-works/pi-ai`(`Type`),两者含 node-only 运行时依赖,不得进 Next/webpack
 * 前端 bundle(守 design Boundary / Req 6.3)。
 *
 * 执行语义:
 *   1. 参数 schema 映射:inputSchema → pi Type.* 对象参数,追加可选 `model` 变体选择器。
 *   2. 默认变体:LLM args.model 有效 → 对应变体;否则 category.defaultVariant。
 *   3. 参数合并(高→低):LLM args(去 model)> userParam 默认。
 *   4. 降级检查:requiredVars 缺失 || ctx.available===false → { ok:false, error } 不抛。
 *   5. 成功路径:runEndpoint → persistPicked → 组装 content+details。
 *   6. 顶层 try/catch:任何错误 → { ok:false, error },不崩溃子进程(Req 1.6/7.x)。
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@pi-web/agent-kit";
import { checkRequiredVars } from "./var-resolver.js";
import { runEndpoint } from "./endpoint-adapter.js";
import { getAttachmentToolContext } from "../attachment/seam.js";
import { persistPicked, resolveInputToDataUri } from "../attachment/persist.js";
import type { Category, JsonSchemaProp, MediaKind, Variant } from "./types.js";

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
 * 把 Category.inputSchema 映射成 pi Type.Object,
 * 额外追加可选 `model` 参数(变体选择器,Req 4.1/4.3)。
 */
function buildParameters(category: Category): TSchema {
  const props: Record<string, TSchema> = {};
  const required = new Set(category.inputSchema.required ?? []);

  for (const [name, prop] of Object.entries(category.inputSchema.properties)) {
    props[name] = jsonSchemaToType(prop, required.has(name));
  }

  // 追加可选 model 参数(LLM 变体选择器)
  const variantNames = category.variants.map((v) => v.name);
  const summary = variantNames.join(" | ");
  props.model = Type.Optional(
    Type.String({
      description: `Variant/model to use. Omit to use the default (${category.defaultVariant}). Options: ${summary}`,
    }),
  );

  return Type.Object(props);
}

// ── 变体查找 ───────────────────────────────────────────────────────────────────

/** 精确名称匹配变体;未命中返回 undefined。 */
function findVariant(
  category: Category,
  name: string,
): Variant | undefined {
  return category.variants.find((v) => v.name === name);
}

/** 按优先级选取 active 变体:args.model > defaultVariant > 首项兜底。 */
function selectVariant(
  category: Category,
  modelArg: string | undefined,
): Variant {
  if (modelArg) {
    const found = findVariant(category, modelArg);
    if (found) return found;
    // LLM 传了无效 variant name → 警告降级
    console.warn(
      `[compileCategory] unknown variant "${modelArg}" for ${category.name}; falling back to default`,
    );
  }
  const def = findVariant(category, category.defaultVariant);
  if (def) return def;
  const first = category.variants[0];
  if (!first) throw new Error(`Category "${category.name}" has no variants`);
  return first;
}

// ── userParam 默认值收集 ──────────────────────────────────────────────────────

function collectUserParamDefaults(
  category: Category,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const p of category.userParams ?? []) {
    out[p.name] = p.default;
  }
  return out;
}

// ── 参数校验(min/max/options) ─────────────────────────────────────────────────

/**
 * 对 userParams 声明的约束做简单运行时校验。
 * 越界/非法 → 返回错误字符串;通过 → 返回 undefined。
 */
function validateUserParams(
  category: Category,
  merged: Record<string, unknown>,
): string | undefined {
  for (const p of category.userParams ?? []) {
    const val = merged[p.name];
    if (val === undefined || val === null) continue;

    if (p.type === "integer" || p.type === "number") {
      const n = Number(val);
      if (Number.isNaN(n)) {
        return `参数 "${p.name}" 期望数字,实际收到 "${String(val)}"`;
      }
      if (p.min !== undefined && n < p.min) {
        return `参数 "${p.name}" 最小值为 ${p.min},实际收到 ${n}`;
      }
      if (p.max !== undefined && n > p.max) {
        return `参数 "${p.name}" 最大值为 ${p.max},实际收到 ${n}`;
      }
    }

    if (p.type === "select" && p.options && p.options.length > 0) {
      const allowed = p.options.map((o) => o.value);
      if (!allowed.includes(val as string | number)) {
        return `参数 "${p.name}" 允许值为 [${allowed.join(", ")}],实际收到 "${String(val)}"`;
      }
    }
  }
  return undefined;
}

// ── 工具描述构造 ──────────────────────────────────────────────────────────────

function buildDescription(category: Category): string {
  const lines = category.variants.map((v) => {
    const star = v.name === category.defaultVariant ? " (default)" : "";
    const desc = v.description ? ` — ${v.description}` : "";
    return `- \`${v.name}\`${star}: ${v.label}${desc}`;
  });
  return [
    category.description.trim(),
    "",
    `Available variants (pass \`model: "<id>"\` to choose; omit for default):`,
    ...lines,
  ].join("\n");
}

// ── 工具执行结果类型 ───────────────────────────────────────────────────────────

/** 工具执行结果的 details 判别联合。 */
export type ToolExecuteDetails =
  | {
      ok: true;
      variant: string;
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
  category: Category,
  merged: Record<string, unknown>,
  ctx: AttachmentToolContext,
): Promise<void> {
  const { properties } = category.inputSchema;

  for (const [name, prop] of Object.entries(properties)) {
    const isImageProp = hasImageMediaKind(prop.mediaKind);

    if (prop.type === "string" && isImageProp) {
      const val = merged[name];
      if (typeof val === "string" && val.startsWith("att_")) {
        merged[name] = await resolveInputToDataUri(val, ctx);
      }
    } else if (prop.type === "array") {
      // 数组类型:看 prop 或 items 是否有 image mediaKind
      const itemsHaveImage = hasImageMediaKind(prop.items?.mediaKind);
      if (isImageProp || itemsHaveImage) {
        const arr = merged[name];
        if (Array.isArray(arr)) {
          merged[name] = await Promise.all(
            arr.map(async (elem) => {
              if (typeof elem === "string" && elem.startsWith("att_")) {
                return resolveInputToDataUri(elem, ctx);
              }
              return elem;
            }),
          );
        }
      }
    }
  }
}

// ── 执行核心函数(便于 execute 保持简洁) ─────────────────────────────────────

async function runExecute(
  category: Category,
  deps: CompileDeps | undefined,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  userParamDefaults: Record<string, string | number>,
): Promise<ExecuteResult> {
  // ── 提取 model 选择器,其余参数进合并 ───────────────────────────────────────
  const { model: modelArg, ...llmArgsWithoutModel } = params as Record<
    string,
    unknown
  > & { model?: string };

  const variant = selectVariant(category, modelArg);

  // ── 参数合并:LLM args > userParam 默认 ─────────────────────────────────────
  const merged: Record<string, unknown> = {
    ...userParamDefaults,
    ...llmArgsWithoutModel,
  };

  // ── 参数越界校验 ──────────────────────────────────────────────────────────
  const paramError = validateUserParams(category, merged);
  if (paramError) {
    return {
      content: [{ type: "text", text: `参数错误:${paramError}` }],
      details: { ok: false, error: paramError },
    };
  }

  // ── 降级检查:requiredVars ──────────────────────────────────────────────
  const varCheck = checkRequiredVars(variant.requiredVars);
  if (!varCheck.ok) {
    const error = `能力不可用:缺少环境变量 ${varCheck.missing.join(", ")} (variant="${variant.name}")`;
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
  try {
    // att_id → data URI:在 buildBody 前解析 inputSchema 中 mediaKind:image 字段
    await resolveMediaFields(category, merged, ctx);

    const picked = await runEndpoint(variant, merged, {
      signal,
      fetchImpl: deps?.fetchImpl,
    });

    const assets = await persistPicked(picked, ctx, {
      fetchImpl: deps?.fetchImpl,
      namePrefix: category.name,
    });

    // 无落库产物(provider 返回 raw/空 url,实为解析失败)→ 报失败而非误导性 ok:true。
    if (assets.length === 0) {
      const error = `provider 未返回有效图像产物 (kind=${picked.kind})`;
      return {
        content: [{ type: "text", text: `生成失败:${error}` }],
        details: { ok: false, error },
      };
    }

    // 组装 content:文本说明 + markdown 图片(承载带签名 displayUrl)。
    // 注:displayUrl 须经 content 传到前端 —— pi 的 tool result 消息流只携带 content,
    // details(结构化明细)不进消息流到前端;故产物引用随 content 走,aigc web-ext renderer
    // 据此从 content 提取 displayUrl 渲染 <img>(默认卡片回退为 JSON/文本)。
    const attIds = assets.map((a) => a.attachmentId).join(", ");
    const summaryLines = [
      `生成成功:${assets.length} 张图像已保存 (${attIds})。`,
      ...assets.map((a) => `![${a.name}](${a.displayUrl})`),
    ];

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
      details: {
        ok: true,
        variant: variant.name,
        assets: assets.map((a) => ({
          attachmentId: a.attachmentId,
          displayUrl: a.displayUrl,
          mimeType: a.mimeType,
          name: a.name,
        })),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `生成失败:${message}` }],
      details: { ok: false, error: message },
    };
  }
}

// ── 主编译函数 ────────────────────────────────────────────────────────────────

/**
 * 把 `Category` 编译成 pi `ToolDefinition`。
 *
 * @param category  工具声明(纯数据,无值导入运行时)。
 * @param deps      可选注入依赖(测试 mock);省略则走生产默认。
 */
export function compileCategory(
  category: Category,
  deps?: CompileDeps,
): ToolDefinition<TSchema, ToolExecuteDetails> {
  const parameters = buildParameters(category);
  const userParamDefaults = collectUserParamDefaults(category);

  return defineTool<TSchema, ToolExecuteDetails>({
    name: category.name,
    label: category.ui?.label ?? category.name,
    description: buildDescription(category),
    parameters,

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
    ): Promise<ExecuteResult> {
      return runExecute(category, deps, params, signal, userParamDefaults);
    },
  });
}
