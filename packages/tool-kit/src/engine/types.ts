/**
 * `@blksails/tool-kit` 声明式工具引擎的类型契约。
 *
 * 本文件是**纯类型**模块:零运行时代码、零值导入,可从主入口 `@blksails/tool-kit` 安全导出
 * 而不把任何 node/SDK 运行时拉进前端 bundle(守 webpack externals 边界,design Boundary)。
 *
 * 两层模型(由 variants 重构拍平而来):
 *  - {@link ToolSpec}        一个 LLM 工具(snake_case name/description/inputSchema)+ 一张 model 路由表;
 *  - {@link ModelRoute}      单一 model 的执行声明(= {@link EndpointBehavior} + 路由元数据);
 *  - {@link EndpointBehavior} 一次调用如何发起(HTTP 同步 / 异步轮询 / 本地执行)与如何取结果。
 *
 * `model` 作为 LLM 可见入参(enum,取值 = 各 ModelRoute.model),运行时按其值路由到对应
 * ModelRoute;省略时回退 {@link ToolSpec.defaultModel}。OpenAI Images 专属参数
 * (background/moderation/quality/style 等)对非 OpenAI model 由各自 buildBody 静默忽略。
 */

/** JSON Schema 属性(LLM 入参 schema 的子集)。 */
export interface JsonSchemaProp {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: ReadonlyArray<string | number>;
  items?: JsonSchemaProp;
  default?: unknown;
  examples?: ReadonlyArray<unknown>;
  /** 素材提示:该字段承载何种媒体引用(供宿主/面板理解,非 LLM 强约束)。 */
  mediaKind?: MediaKind | ReadonlyArray<MediaKind>;
}

export type MediaKind = "image" | "video" | "audio";

/** LLM 可见的工具入参 schema(JSON Schema object 子集)。 */
export interface EndpointInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required?: ReadonlyArray<string>;
  additionalProperties?: boolean;
}

/** 价格元数据(展示/审计用;Wave 1 不计费)。 */
export interface Pricing {
  amount: number;
  currency: "CNY" | "USD";
  unit: "image" | "task" | "second" | "1k_tokens";
  note?: string;
}

/** 工具产出的规范化形态(LLM/宿主消费;Wave 1 主要 image / image-set)。 */
export type PickedResult =
  | { kind: "image"; url: string; caption?: string }
  | { kind: "image-set"; urls: ReadonlyArray<string>; caption?: string }
  | { kind: "video"; url: string; caption?: string; lastFrameUrl?: string }
  | {
      kind: "video-set";
      urls: ReadonlyArray<string>;
      caption?: string;
      lastFrameUrls?: ReadonlyArray<string | undefined>;
    }
  | { kind: "audio"; url: string; caption?: string }
  | { kind: "audio-set"; urls: ReadonlyArray<string>; caption?: string }
  | { kind: "text"; text: string }
  | {
      kind: "choices";
      choices: ReadonlyArray<{ label: string; prompt: string; description?: string }>;
      rationale?: string;
    }
  | { kind: "raw"; value: unknown };

/** 执行阶段(进度回调用)。 */
export type RunStage =
  | "submitting"
  | "queued"
  | "running"
  | "fetching"
  | "complete";

export type ToolProgress = (stage: RunStage) => void;

/** buildBody 执行上下文:注入式 fetch 与已解析的代理 URL(不在声明中直接 import 运行时库)。 */
export interface BuildBodyContext {
  proxyUrl?: string;
  /** 注入的 fetch(默认代理 fetch;测试可 mock)。供 inline 远程图等异步预处理使用。 */
  fetchImpl?: typeof fetch;
}

/** 异步任务轮询声明。 */
export interface AsyncSpec {
  /** 从提交响应取轮询 status URL。 */
  statusUrl: (submitResponse: unknown) => string;
  /** 从提交响应取最终结果 URL(可与 statusUrl 相同)。 */
  responseUrl: (submitResponse: unknown) => string;
  /** 判断任务完成(默认检测常见完成态字段)。 */
  isComplete?: (statusResponse: unknown) => boolean;
  /** 判断任务失败。 */
  isFailed?: (statusResponse: unknown) => boolean;
  /** 轮询间隔毫秒(默认 2000)。 */
  pollMs?: number;
  /** 总超时毫秒(默认 300000)。 */
  timeoutMs?: number;
}

/** 本地执行钩子(如 ffmpeg;Wave 1 不实现,保留类型以备后续 Wave)。 */
export type LocalExecuteHook = (
  args: Record<string, unknown>,
  ctx: { sessionId?: string; signal?: AbortSignal; onProgress?: ToolProgress },
) => Promise<PickedResult>;

/** 一次调用如何发起与取结果(HTTP 同步 / 异步轮询 / 本地执行)。 */
export interface EndpointBehavior {
  method?: "POST" | "GET" | "PUT" | "PATCH";
  /** 请求 URL,支持 `${VAR}` 占位(HTTP 路径必填)。 */
  url?: string;
  /** 请求头,值支持 `${VAR}` 占位。 */
  headers?: Record<string, string>;
  /** 构造请求体(可异步:如把远程图 inline 为 data URI)。 */
  buildBody?: (
    args: Record<string, unknown>,
    ctx?: BuildBodyContext,
  ) => unknown | Promise<unknown>;
  /** 从响应提取规范化结果(HTTP 路径必填)。 */
  pickResult?: (response: unknown) => PickedResult;
  /** 从响应检测业务错误,返回可读错误信息(命中即视为失败)。 */
  detectError?: (response: unknown) => string | undefined;
  /** 异步轮询声明;省略则为同步单次请求。 */
  async?: AsyncSpec;
  /** 调用前需可解析的环境变量名(缺失 → 工具降级)。 */
  requiredVars?: ReadonlyArray<string>;
  /** 可选代理 URL,支持 `${VAR}`;env 未配 → 直连。 */
  proxy?: string;
  /** 价格元数据。 */
  pricing?: Pricing;
  /** 本地执行钩子(与 url+pickResult 互斥;Wave 1 不用)。 */
  runLocal?: LocalExecuteHook;
}

/**
 * 单一 model 的执行路由项(= EndpointBehavior + 路由元数据)。
 *
 * 替代旧 `Variant`:`model` 既是 LLM 可见入参 enum 的取值,也是运行时路由键。
 * 由 variants 重构而来——多 provider 能力仍由各 ModelRoute 的 EndpointBehavior 承载
 * (DashScope 异步轮询 / OpenRouter chat / NewAPI OpenAI 兼容)。
 */
export type ModelRoute = EndpointBehavior & {
  /** LLM 可见 model 值 + 运行时路由键(如 "gpt-image-1" / "wanx2.1-turbo")。 */
  model: string;
  /** 展示标签。 */
  label: string;
  description?: string;
};

/**
 * 业务必选项的交互补全声明(aigc-tools-interactive-params)。
 *
 * 某参数虽对成图必需,但**不在 inputSchema 标 required**(避免 LLM 漏传被参数校验拦截);
 * 改由编译器在执行时检测缺失,经 pi 宿主交互能力(`ctx.ui`)补全:
 *  - `via:"select"` 弹选择器(options;含哨兵 `"$models"` 时展开为该工具 models 的 model 集合);
 *  - `via:"input"`  弹文本输入(placeholder)。
 * 无交互 UI 时:有 `fallback` 用之;`param==="model"` 退回 `defaultModel`;否则该项缺失 → ok:false。
 */
export interface InteractionSpec {
  /** 目标参数名(如 "model" / "size" / "prompt")。 */
  param: string;
  /** 交互方式:枚举选择 / 文本输入。 */
  via: "select" | "input";
  /** 弹窗标题(用户可见)。 */
  title: string;
  /** input 占位文本。 */
  placeholder?: string;
  /** select 选项;含哨兵 "$models" 时运行时展开为 tool.models 的 model 集合。 */
  options?: ReadonlyArray<string>;
  /** 无交互 UI 时的兜底值;省略则该项无兜底(缺失 → ok:false)。 */
  fallback?: string;
}

/**
 * 一个 LLM 工具:snake_case 声明 + 一张 model 路由表。
 *
 * 替代旧 `Category`(去 variants/defaultVariant/ui 抽象):
 *  - `inputSchema` 不含 model;编译器据 `models` 自动注入 `model` enum 参数。
 *  - `models` 非空;运行时按 LLM `model` 入参选路由,省略则用 `defaultModel`。
 */
export interface ToolSpec {
  /** 工具名(LLM 可见,snake_case;作为 tool name)。 */
  name: string;
  /** 工具描述(LLM 可见)。 */
  description: string;
  /** 工具展示名(给 defineTool 的 label;省略回退 name)。 */
  label?: string;
  /** LLM 可见入参 schema(不含 model;由 models 派生注入)。 */
  inputSchema: EndpointInputSchema;
  /** model 路由表(非空)。 */
  models: ReadonlyArray<ModelRoute>;
  /** 无 LLM `model` 指定时的默认 model(必须存在于 models)。 */
  defaultModel: string;
  /**
   * 业务必选项的交互补全声明(缺失时经 ctx.ui 补全,而非在 schema 标 required)。
   * 顺序即补全顺序。
   */
  requiredParams?: ReadonlyArray<InteractionSpec>;
}
