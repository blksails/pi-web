/**
 * Execution engine for `@blksails/pi-web-tool-kit`.
 *
 * `runEndpoint` handles three paths:
 *  (a) `behavior.runLocal`  → delegate to local hook (Wave 1 minimal pass-through).
 *  (b) No `behavior.async`  → single synchronous HTTP request.
 *  (c) Has `behavior.async` → submit then poll status until complete / timeout / abort.
 *
 * Error semantics:
 *  - Empty / non-JSON sync response → throws a diagnostic `Error`.
 *  - Empty / non-JSON poll response → tolerant; continues to next tick.
 *  - `detectError` match          → throws with the provider message.
 *  - Timeout                      → throws with elapsed ms.
 *  - AbortSignal fired            → throws `AbortError`.
 */

import { createLogger } from "@blksails/pi-web-logger";
import { resolveVars, resolveVarsOptional } from "./var-resolver.js";
import { proxyFetch } from "./proxy-fetch.js";
import {
  readOpenAiSse,
  makeOpenAiChatAccumulator,
  makeOpenAiImagesAccumulator,
} from "./sse-stream.js";
import type {
  EndpointBehavior,
  PickedResult,
  RunStage,
  ToolProgress,
  ToolStreamHandler,
} from "./endpoint-types.js";

// 命名空间 toolkit:endpoint —— provider HTTP 调用耗时(对照后台网关报告的"用时")。
const log = createLogger({ namespace: "toolkit:endpoint" });

export interface RunEndpointOptions {
  signal?: AbortSignal;
  onProgress?: ToolProgress;
  /** 流式增量回调(reasoning / 文本 / 早弹图);仅 `behavior.stream` 端点触发。 */
  onStream?: ToolStreamHandler;
  /** Injected fetch implementation (default: proxyFetch or globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * Execute one `EndpointBehavior` and return a normalized `PickedResult`.
 */
export async function runEndpoint(
  behavior: EndpointBehavior,
  args: Readonly<Record<string, unknown>>,
  options: RunEndpointOptions = {},
): Promise<PickedResult> {
  const { signal, onProgress } = options;

  // ── (a) runLocal short-circuit ───────────────────────────────────────────
  if (behavior.runLocal) {
    onProgress?.("submitting" as RunStage);
    const picked = await behavior.runLocal(args as Record<string, unknown>, { signal, onProgress });
    onProgress?.("complete" as RunStage);
    return picked;
  }

  // ── HTTP path guard ──────────────────────────────────────────────────────
  if (!behavior.url || !behavior.pickResult) {
    throw new Error(
      "EndpointBehavior must provide either runLocal or both url + pickResult",
    );
  }

  const url = resolveVars(behavior.url);
  const proxyUrl = resolveVarsOptional(behavior.proxy);

  // Resolve headers; always start with content-type unless body is FormData.
  const rawHeaders = behavior.headers ?? {};
  const resolvedHeaders: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(rawHeaders)) {
    resolvedHeaders[k] = resolveVars(v);
  }

  // Effective fetch: injected impl → proxyFetch(代理与直连都经它)。
  // ★直连分支原为 `globalThis.fetch`,那条路无法配置 dispatcher,只能吃 undici 的
  // 300s 默认超时(图像端点常被掐断,见 proxy-fetch.ts 的 TRANSPORT_TIMEOUT_MS)。
  // 改为一律经 proxyFetch:proxyUrl 为空时它走放宽超时的直连传输。
  const effectiveFetch: typeof fetch =
    options.fetchImpl ??
    (((u: string | URL | Request, init?: RequestInit) =>
      proxyFetch(u as string | URL, init, proxyUrl)) as typeof fetch);

  const body = behavior.buildBody
    ? await Promise.resolve(behavior.buildBody(args as Record<string, unknown>, { proxyUrl, fetchImpl: options.fetchImpl }))
    : args;

  // ── (b0) Streaming (OpenAI-chat SSE) ─────────────────────────────────────
  // behavior.stream:走 `stream:true` + `text/event-stream`,逐帧上报 reasoning/文本/早弹图。
  // 网关未透传 SSE(仍返回整包 JSON)→ 回退同步解析(见 runStreaming)。
  if (behavior.stream) {
    return runStreaming(behavior, body, url, resolvedHeaders, effectiveFetch, options);
  }

  // ── (b) Sync single request ──────────────────────────────────────────────
  if (!behavior.async) {
    onProgress?.("submitting" as RunStage);
    const startedAt = Date.now();
    const response = await callOnce(url, resolvedHeaders, body, behavior.method ?? "POST", effectiveFetch, signal);
    log.debug("sync request returned", { url, ms: Date.now() - startedAt });
    const errMsg = behavior.detectError?.(response);
    if (errMsg) throw new Error(errMsg);
    onProgress?.("complete" as RunStage);
    return behavior.pickResult(response);
  }

  // ── (c) Async submit + poll ──────────────────────────────────────────────
  onProgress?.("submitting" as RunStage);
  const asyncStartedAt = Date.now();
  const submit = await callOnce(url, resolvedHeaders, body, behavior.method ?? "POST", effectiveFetch, signal);

  // submit 即错(HTTP 200 带业务 error,如配额/鉴权失败)→ 立即暴露可读错误,避免对
  // undefined task_id 做无意义轮询、最终以误导性 "timed out" 收场(Req 1.6)。
  const submitErr = behavior.detectError?.(submit);
  if (submitErr) throw new Error(submitErr);

  const asyncSpec = behavior.async;
  // statusUrl/responseUrl 经 resolveVars 展开 `${VAR}`/`${VAR:-default}` 占位
  // (使按 base 切换的端点在异步轮询路径也生效);无占位时原样返回。
  const statusUrl = resolveVars(asyncSpec.statusUrl(submit));
  const responseUrl = resolveVars(asyncSpec.responseUrl(submit));
  const deadline = Date.now() + (asyncSpec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollMs = asyncSpec.pollMs ?? DEFAULT_POLL_MS;

  onProgress?.("queued" as RunStage);

  while (Date.now() < deadline) {
    await abortableSleep(pollMs, signal);
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }

    const st = await effectiveFetch(statusUrl, {
      headers: resolvedHeaders,
      signal: signal,
    });

    if (!st.ok) continue;

    const status = await parseJsonTolerant(st);
    // Tolerant: empty / bad poll body → continue to next tick.
    if (status === undefined) continue;

    if (asyncSpec.isFailed?.(status)) {
      const detailed = behavior.detectError?.(status);
      throw new Error(detailed ?? "job failed");
    }

    const isComplete = asyncSpec.isComplete
      ? asyncSpec.isComplete(status)
      : defaultIsComplete(status);

    if (isComplete) {
      onProgress?.("fetching" as RunStage);
      const finalResp = await effectiveFetch(responseUrl, {
        headers: resolvedHeaders,
        signal: signal,
      });
      if (!finalResp.ok) {
        throw new Error(`${responseUrl}: ${finalResp.status} ${await finalResp.text()}`);
      }
      const finalJson = await parseJsonOrThrow(finalResp, responseUrl);
      const errMsg = behavior.detectError?.(finalJson);
      if (errMsg) throw new Error(errMsg);
      log.info("async job complete", { url, ms: Date.now() - asyncStartedAt });
      onProgress?.("complete" as RunStage);
      return behavior.pickResult(finalJson);
    }

    onProgress?.("running" as RunStage);
  }

  log.warn("async job timed out", {
    url,
    timeoutMs: asyncSpec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  throw new Error(
    `job timed out after ${asyncSpec.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
  );
}

// ── Streaming (OpenAI-chat SSE) ──────────────────────────────────────────────

/**
 * OpenAI-chat 流式执行:`stream:true` → 读 `text/event-stream` → 逐帧上报 reasoning/文本/早弹图,
 * 收敛出最终 {@link PickedResult}(经 behavior.pickResult 复用非流式解析)。
 *
 * 兜底:网关虽收下 `stream:true` 却仍返回整包 JSON(非 event-stream)→ 退化为同步解析,不崩。
 */
async function runStreaming(
  behavior: EndpointBehavior,
  body: unknown,
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  options: RunEndpointOptions,
): Promise<PickedResult> {
  const { signal, onProgress, onStream } = options;
  const pickResult = behavior.pickResult;
  if (!pickResult) throw new Error("streaming endpoint requires pickResult");

  // 请求体注入 stream:true(仅 plain object;FormData 不走流式)。
  const streamBody =
    body && typeof body === "object" && !(typeof FormData !== "undefined" && body instanceof FormData)
      ? { ...(body as Record<string, unknown>), stream: true }
      : body;

  onProgress?.("submitting" as RunStage);
  const startedAt = Date.now();
  const init: RequestInit = {
    method: behavior.method ?? "POST",
    headers: { ...headers, accept: "text/event-stream" },
    body: JSON.stringify(streamBody),
    signal,
  };

  let r: Response;
  try {
    r = await fetchFn(url, init);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    // 保留原始 err 为 cause,便于上层做错误分类(而非只能字符串匹配)。
    throw new Error(`${url}: upstream request failed → ${describeError(err)}`, { cause: err });
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${url}: ${r.status} ${text}`);
  }

  const ct = r.headers.get("content-type") ?? "";
  // 回退:网关忽略 stream,返回整包 JSON。
  if (!ct.includes("text/event-stream")) {
    log.warn("stream requested but non-SSE response; falling back to sync parse", { url, ct });
    const json = await parseJsonOrThrow(r, url);
    const errMsg = behavior.detectError?.(json);
    if (errMsg) throw new Error(errMsg);
    onProgress?.("complete" as RunStage);
    return pickResult(json);
  }

  onProgress?.("running" as RunStage);

  // ── streamKind: "images" —— OpenAI Images 渐进局部图(由糊变清)──────────────
  if (behavior.streamKind === "images") {
    const imgAcc = makeOpenAiImagesAccumulator({
      onPartial: (dataUri) => {
        onProgress?.("running" as RunStage);
        onStream?.({ kind: "image", picked: { kind: "image", url: dataUri } });
      },
      onComplete: (dataUri) => {
        onProgress?.("fetching" as RunStage);
        onStream?.({ kind: "image", picked: { kind: "image", url: dataUri } });
      },
    });
    await readOpenAiSse(r, imgAcc.onData, signal);
    const imgErr = imgAcc.error();
    if (imgErr) throw new Error(imgErr);
    const { finalDataUri, partialCount } = imgAcc.result();
    if (!finalDataUri) throw new Error(`${url}: images stream produced no image`);
    log.info("images stream complete", { url, ms: Date.now() - startedAt, partials: partialCount });
    onProgress?.("complete" as RunStage);
    return { kind: "image", url: finalDataUri };
  }

  // ── streamKind: "chat"(默认)—— reasoning 边想边显 + 图早弹 ─────────────────
  // 复用非流式解析:把当前 url 列表重建为 openrouter 非流式响应形态。
  const pickFromUrls = (urls: readonly string[]): PickedResult =>
    pickResult({ choices: [{ message: { images: urls.map((u) => ({ image_url: { url: u } })) } }] });

  const acc = makeOpenAiChatAccumulator({
    onReasoning: (text) => onStream?.({ kind: "reasoning", text }),
    onText: (text) => onStream?.({ kind: "text", text }),
    onImage: (urls) => {
      onProgress?.("fetching" as RunStage);
      onStream?.({ kind: "image", picked: pickFromUrls(urls) });
    },
  });

  await readOpenAiSse(r, acc.onData, signal);

  const streamErr = acc.error();
  if (streamErr) throw new Error(streamErr);

  const { imageUrls } = acc.result();
  log.info("stream complete", { url, ms: Date.now() - startedAt, images: imageUrls.length });
  onProgress?.("complete" as RunStage);
  return pickFromUrls(imageUrls);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 把错误连同 `cause` 链一并渲染成可读文本。
 *
 * ★undici 的网络错误一律包装成 `TypeError: fetch failed`,真因只在 `err.cause` 里
 * (`HeadersTimeoutError` / `ConnectTimeoutError` / `ECONNREFUSED` / 证书错误 …)。
 * 原实现 `String(err)` 把 cause 整个丢掉,日志只剩 "fetch failed" —— 2026-07-28 排查
 * 图像编辑失败时,只能靠「四次精确 302s」的时间规律反推超时,代价极高。此处逐层展开。
 *
 * 深度上限 3,防 cause 自引用导致无限递归。
 */
export function describeError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return String(err);
  const head = err.message ? `${err.name}: ${err.message}` : err.name;
  const cause = (err as { cause?: unknown }).cause;
  if (cause === undefined || cause === null || depth >= 3) return head;
  return `${head} ← ${describeError(cause, depth + 1)}`;
}

async function callOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  method: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  // FormData: strip content-type and let the runtime set the multipart boundary.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const finalHeaders = isForm
    ? Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-type"),
      )
    : headers;

  const init: RequestInit = { method, headers: finalHeaders, signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = isForm ? (body as FormData) : JSON.stringify(body);
  }

  let r: Response;
  try {
    r = await fetchFn(url, init);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    // 保留原始 err 为 cause,便于上层做错误分类(而非只能字符串匹配)。
    throw new Error(`${url}: upstream request failed → ${describeError(err)}`, { cause: err });
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${url}: ${r.status} ${text}`);
  }

  return parseJsonOrThrow(r, url);
}

/** Synchronous response: empty / bad JSON → throw diagnostic error. */
async function parseJsonOrThrow(r: Response, url: string): Promise<unknown> {
  const text = await r.text();
  if (!text.trim()) {
    throw new Error(
      `${url}: upstream returned ${r.status} with empty body (possible timeout or proxy truncation). Please retry.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    throw new Error(
      `${url}: upstream returned non-JSON response (${r.status}, possible truncation). Snippet: ${snippet}`,
    );
  }
}

/** Poll response: empty / bad JSON → return undefined so the loop continues. */
async function parseJsonTolerant(r: Response): Promise<unknown> {
  try {
    const text = await r.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Default completion detector: checks common status field values. */
function defaultIsComplete(status: unknown): boolean {
  const s = (status as { status?: string })?.status;
  return (
    s === "COMPLETED" ||
    s === "succeeded" ||
    s === "completed" ||
    s === "SUCCEEDED"
  );
}

/**
 * Sleep that wakes early when `signal` aborts — avoids stalling the poll loop
 * for a full `pollMs` after the caller cancels.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
