/**
 * `@blksails/pi-web-tool-kit` 执行层类型契约(endpoint execution layer)。
 *
 * 本文件是**纯类型**模块:零运行时代码、零值导入。它描述 {@link runEndpoint} 的入参与产出
 * 契约,与"声明式工具框架"(ToolSpec)**无关**——任何手写 `execute` 都可复用这些类型。
 *
 * 由 `engine/types.ts` 拆分而来(detoolspec-unify-builtin-tools):ToolSpec/ModelRoute 等
 * 声明层类型已移除,只保留这里的端点执行契约。
 */

/** 工具产出的规范化形态(宿主/落库消费;主要 image / image-set)。 */
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

/** 价格元数据(展示/审计用)。 */
export interface Pricing {
  amount: number;
  currency: "CNY" | "USD";
  unit: "image" | "task" | "second" | "1k_tokens";
  note?: string;
}

/** 执行阶段(进度回调用)。 */
export type RunStage =
  | "submitting"
  | "queued"
  | "running"
  | "fetching"
  | "complete";

export type ToolProgress = (stage: RunStage) => void;

/**
 * 流式增量事件(仅 OpenAI-chat 形态的流式端点,如 OpenRouter `chat/completions` + `stream:true`)。
 *  - `reasoning` — 模型「思考」文本的**累积**串(边想边显)
 *  - `text`      — 模型答复正文的**累积**串
 *  - `image`     — 早弹图像(局部/首张出现即推,后续被最终结果覆盖)
 */
export type StreamEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "image"; picked: PickedResult };

/** 流式增量回调(执行层→编排层→前端 onUpdate)。 */
export type ToolStreamHandler = (ev: StreamEvent) => void;

/** buildBody 执行上下文:注入式 fetch 与已解析的代理 URL。 */
export interface BuildBodyContext {
  proxyUrl?: string;
  /** 注入的 fetch(默认代理 fetch;测试可 mock)。 */
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

/** 本地执行钩子(如 ffmpeg;保留类型以备后续)。 */
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
  /**
   * 流式读取(`stream:true` → `text/event-stream`)。置真时执行层走流式分支,经 `onStream` 上报增量;
   * 网关**未透传 SSE**(仍返回整包 JSON)时自动回退为同步解析,不崩。SSE 形态由 {@link streamKind} 决定。
   */
  stream?: boolean;
  /**
   * 流式帧形态:
   *  - `"chat"`(默认)  —— OpenAI chat SSE(`choices[].delta.{reasoning,content,images}`),reasoning 边想边显 + 图早弹。
   *  - `"images"`        —— OpenAI Images SSE(`image_generation.partial_image` 渐进局部图,由糊变清)+ `image_generation.completed`。
   */
  streamKind?: "chat" | "images";
  /** 调用前需可解析的环境变量名(缺失 → 工具降级)。 */
  requiredVars?: ReadonlyArray<string>;
  /** 可选代理 URL,支持 `${VAR}`;env 未配 → 直连。 */
  proxy?: string;
  /** 价格元数据。 */
  pricing?: Pricing;
  /** 本地执行钩子(与 url+pickResult 互斥)。 */
  runLocal?: LocalExecuteHook;
}
