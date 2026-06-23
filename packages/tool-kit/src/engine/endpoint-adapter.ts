/**
 * Execution engine for `@pi-web/tool-kit`.
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

import { resolveVars, resolveVarsOptional } from "./var-resolver.js";
import { proxyFetch } from "./proxy-fetch.js";
import type { EndpointBehavior, PickedResult, RunStage, ToolProgress } from "./types.js";

export interface RunEndpointOptions {
  signal?: AbortSignal;
  onProgress?: ToolProgress;
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

  // Effective fetch: injected impl → proxy fetch → global fetch.
  const effectiveFetch: typeof fetch =
    options.fetchImpl ??
    (proxyUrl
      ? ((u: string | URL | Request, init?: RequestInit) => proxyFetch(u as string | URL, init, proxyUrl)) as typeof fetch
      : globalThis.fetch);

  const body = behavior.buildBody
    ? await Promise.resolve(behavior.buildBody(args as Record<string, unknown>, { proxyUrl, fetchImpl: options.fetchImpl }))
    : args;

  // ── (b) Sync single request ──────────────────────────────────────────────
  if (!behavior.async) {
    onProgress?.("submitting" as RunStage);
    const response = await callOnce(url, resolvedHeaders, body, behavior.method ?? "POST", effectiveFetch, signal);
    const errMsg = behavior.detectError?.(response);
    if (errMsg) throw new Error(errMsg);
    onProgress?.("complete" as RunStage);
    return behavior.pickResult(response);
  }

  // ── (c) Async submit + poll ──────────────────────────────────────────────
  onProgress?.("submitting" as RunStage);
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
      onProgress?.("complete" as RunStage);
      return behavior.pickResult(finalJson);
    }

    onProgress?.("running" as RunStage);
  }

  throw new Error(
    `job timed out after ${asyncSpec.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

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
    throw new Error(`${url}: upstream request failed → ${String(err)}`);
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
