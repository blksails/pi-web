/**
 * `@blksails/pi-web-tool-kit` 流式读取工具 —— OpenAI-chat SSE(`text/event-stream`)。
 *
 * 两块:
 *  - {@link readOpenAiSse}          —— 从 fetch `Response.body` 逐帧读取 SSE,回调每个已解析的 `data:` JSON;
 *                                      跳过 `:` 心跳注释,遇 `[DONE]` 结束,严格按 `\n` 分行(不用 readline)。
 *  - {@link makeOpenAiChatAccumulator} —— 消费 `chat.completion.chunk` 帧,累积 reasoning / 答复文本 / 图像 url,
 *                                      各自变化时回调,并可取最终 {@link OpenAiChatStreamResult}。
 *
 * 仅服务 OpenRouter 类 chat 端点(`choices[].delta.{reasoning,reasoning_details,content,images}`)。
 * 本模块零 pi SDK 依赖,纯 Web/Node 通用(ReadableStream + TextDecoder)。
 */

/** 逐帧读取 SSE:对每个 `data:` 帧的 JSON.parse 结果调用 `onData`。`[DONE]` 或流结束即返回。 */
export async function readOpenAiSse(
  response: Response,
  onData: (json: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("SSE 响应无 body");
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let dataLines: string[] = [];

  const flush = (): boolean => {
    if (dataLines.length === 0) return false;
    const payload = dataLines.join("\n");
    dataLines = [];
    if (payload === "[DONE]") return true;
    try {
      onData(JSON.parse(payload));
    } catch {
      // 半帧 / 非 JSON:容错跳过(下一帧继续)。
    }
    return false;
  };

  try {
    for (;;) {
      if (signal?.aborted) {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // 严格按 \n 分行,剥掉 \r(不用 Node readline,避免 U+2028/2029 误分)。
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          // 空行 = 帧边界。
          if (flush()) return;
        } else if (line.startsWith(":")) {
          // 注释 / 心跳(如 `: OPENROUTER PROCESSING`)—— 忽略。
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        // 其余字段(event:/id:/retry:)本流不需要,忽略。
      }
    }
    // 收尾:末帧可能无终止空行。
    flush();
  } finally {
    reader.releaseLock?.();
  }
}

// ── OpenAI-chat 累积器 ────────────────────────────────────────────────────────

/** 流式最终产物。 */
export interface OpenAiChatStreamResult {
  /** 累积的推理(思考)文本。 */
  reasoning: string;
  /** 累积的答复正文。 */
  content: string;
  /** 收集到的图像 url(data URI 或 https),去重、保序。 */
  imageUrls: string[];
}

interface ChatChunk {
  choices?: {
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_details?: { text?: string; summary?: string }[];
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  error?: { code?: number | string; message?: string };
}

/** 累积器句柄:`onData` 喂给 {@link readOpenAiSse};`result()` 取最终产物;`error()` 取业务错误。 */
export interface OpenAiChatAccumulator {
  onData: (json: unknown) => void;
  result: () => OpenAiChatStreamResult;
  error: () => string | undefined;
}

/**
 * 构造 OpenAI-chat 流式累积器。各增量变化时回调对应 handler(参数为**累积**值 / 全量 url 列表)。
 */
export function makeOpenAiChatAccumulator(handlers: {
  onReasoning?: (accumulated: string) => void;
  onText?: (accumulated: string) => void;
  onImage?: (urls: string[]) => void;
} = {}): OpenAiChatAccumulator {
  let reasoning = "";
  let content = "";
  const imageUrls: string[] = [];
  const seenUrl = new Set<string>();
  let errMsg: string | undefined;

  const onData = (json: unknown): void => {
    const chunk = json as ChatChunk;
    if (chunk.error) {
      errMsg = chunk.error.message ?? `code ${chunk.error.code ?? "?"}`;
      return;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    // 推理:优先 delta.reasoning(纯串);同帧无它但有 reasoning_details 时用其 text/summary。
    if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      reasoning += delta.reasoning;
      handlers.onReasoning?.(reasoning);
    } else if (Array.isArray(delta.reasoning_details)) {
      let added = "";
      for (const d of delta.reasoning_details) {
        added += d.text ?? d.summary ?? "";
      }
      if (added) {
        reasoning += added;
        handlers.onReasoning?.(reasoning);
      }
    }

    // 答复正文。
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      handlers.onText?.(content);
    }

    // 图像(早弹)。
    if (Array.isArray(delta.images)) {
      let changed = false;
      for (const img of delta.images) {
        const url = img.image_url?.url;
        if (url && !seenUrl.has(url)) {
          seenUrl.add(url);
          imageUrls.push(url);
          changed = true;
        }
      }
      if (changed) handlers.onImage?.([...imageUrls]);
    }
  };

  return {
    onData,
    result: () => ({ reasoning, content, imageUrls: [...imageUrls] }),
    error: () => errMsg,
  };
}

// ── OpenAI Images 累积器(/images `stream:true` + `partial_images`)─────────────

/**
 * OpenAI Images 流式帧(`text/event-stream`):
 *  - `image_generation.partial_image` — 渐进局部图(由糊变清),带 `partial_image_index` + `b64_json`(整幅,完成度递增)
 *  - `image_generation.completed`     — 最终图,带 `b64_json`
 * OpenRouter `POST /api/v1/images` 与 OpenAI 官方 `/images` 同构。
 */
interface ImagesStreamFrame {
  type?: string;
  partial_image_index?: number;
  b64_json?: string;
  error?: { code?: number | string; message?: string };
}

/** Images 流式最终产物。 */
export interface OpenAiImagesStreamResult {
  /** 最终图 data URI(completed;缺失时回退到最后一张 partial)。 */
  finalDataUri: string | undefined;
  /** 收到的 partial 张数。 */
  partialCount: number;
}

/** Images 流式累积器句柄。 */
export interface OpenAiImagesAccumulator {
  onData: (json: unknown) => void;
  result: () => OpenAiImagesStreamResult;
  error: () => string | undefined;
}

/** b64 → PNG data URI(Images 流式帧不带 mime,gpt-image 恒 PNG)。 */
function b64ToDataUri(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

/**
 * 构造 OpenAI Images 流式累积器:
 *  - 每张 partial(由糊变清)→ `onPartial(dataUri, index)`
 *  - 最终图 → `onComplete(dataUri)`
 */
export function makeOpenAiImagesAccumulator(handlers: {
  onPartial?: (dataUri: string, index: number) => void;
  onComplete?: (dataUri: string) => void;
} = {}): OpenAiImagesAccumulator {
  let finalDataUri: string | undefined;
  let lastPartial: string | undefined;
  let partialCount = 0;
  let errMsg: string | undefined;

  const onData = (json: unknown): void => {
    const f = json as ImagesStreamFrame;
    if (f.error) {
      errMsg = f.error.message ?? `code ${f.error.code ?? "?"}`;
      return;
    }
    if (!f.b64_json) return;
    const dataUri = b64ToDataUri(f.b64_json);
    if (f.type === "image_generation.completed" || f.type === "image_edit.completed") {
      finalDataUri = dataUri;
      handlers.onComplete?.(dataUri);
    } else if (
      f.type === "image_generation.partial_image" ||
      f.type === "image_edit.partial_image"
    ) {
      partialCount++;
      lastPartial = dataUri;
      handlers.onPartial?.(dataUri, f.partial_image_index ?? partialCount - 1);
    }
  };

  return {
    onData,
    result: () => ({ finalDataUri: finalDataUri ?? lastPartial, partialCount }),
    error: () => errMsg,
  };
}
