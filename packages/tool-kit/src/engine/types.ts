/**
 * `@pi-web/tool-kit` 声明式工具引擎的类型契约(移植自 pi-labs `lib/aigc/types.ts` 的精简版)。
 *
 * 本文件是**纯类型**模块:零运行时代码、零值导入,可从主入口 `@pi-web/tool-kit` 安全导出
 * 而不把任何 node/SDK 运行时拉进前端 bundle(守 webpack externals 边界,design Boundary)。
 *
 * 三层模型:
 *  - {@link Category}  一个工具(LLM 可见的 name/description/inputSchema)+ 多个 provider 变体;
 *  - {@link Variant}   单一 provider/model 的执行声明(= {@link EndpointBehavior} + 元数据);
 *  - {@link EndpointBehavior}  一次调用如何发起(HTTP 同步 / 异步轮询 / 本地执行)与如何取结果。
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

/** 单参数的 per-variant 覆盖(隐藏 / 禁用某些取值 / 改默认)。 */
export interface ParamOverride {
  /** 对该 variant 隐藏此参数(从 UI / schema 暴露中移除;静默丢弃 LLM 传值)。 */
  hidden?: boolean;
  /** 对该 variant 禁用的取值(UI 灰显;传入则报参数错误)。 */
  disabledOptions?: ReadonlyArray<string | number>;
  /** 覆盖默认值。 */
  default?: string | number;
}

/** 面板侧栏参数声明(不暴露给 LLM;Wave 1 不渲染面板,保留以备后续 Wave)。 */
export interface UserParamSpec {
  name: string;
  label: string;
  description?: string;
  type: "string" | "integer" | "number" | "select" | "size";
  options?: ReadonlyArray<{ value: string | number; label: string }>;
  default: string | number;
  min?: number;
  max?: number;
  presets?: ReadonlyArray<{ value: string; label: string }>;
  stepSize?: { width: number; height: number };
  additional?: boolean;
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
  /** per-variant 参数覆盖。 */
  paramOverrides?: Record<string, ParamOverride>;
  /** 本地执行钩子(与 url+pickResult 互斥;Wave 1 不用)。 */
  runLocal?: LocalExecuteHook;
}

/** 同一 model 的备选 provider 路由(浅合并覆盖 EndpointBehavior 字段)。 */
export type ProviderOption = Partial<EndpointBehavior> & {
  providerId: string;
  providerLabel: string;
  pricing?: Pricing;
  description?: string;
};

/** 单一 provider/model 变体(= EndpointBehavior + 元数据)。 */
export type Variant = EndpointBehavior & {
  /** 稳定变体 id(LLM `model` 参数 / 面板选中据此匹配)。 */
  name: string;
  /** 展示标签。 */
  label: string;
  description?: string;
  /** 备选 provider 路由。 */
  altProviders?: ReadonlyArray<ProviderOption>;
};

/** UI 元数据(可序列化;Wave 1 不下发前端,保留供后续 Wave)。 */
export interface CategoryUi {
  icon?: string;
  label?: string;
  placement?: "editor" | "panel" | "both";
}

/** 一个工具:LLM 可见声明 + 多个 provider 变体。 */
export interface Category {
  /** 工具名(LLM 可见,作为 tool name)。 */
  name: string;
  /** 工具描述(LLM 可见)。 */
  description: string;
  ui?: CategoryUi;
  /** LLM 可见入参 schema。 */
  inputSchema: EndpointInputSchema;
  /** 面板侧栏参数(不暴露 LLM;Wave 1 仅用其 default 作参数兜底)。 */
  userParams?: ReadonlyArray<UserParamSpec>;
  /** provider 变体(非空)。 */
  variants: ReadonlyArray<Variant>;
  /** 无 LLM `model` 指定时的默认变体名(必须存在于 variants)。 */
  defaultVariant: string;
}
