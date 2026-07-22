import { DEFAULT_PANE_RESPONSE_BYTES } from "./authorization.js";
import { PaneHostError } from "./errors.js";

export interface AgentRouteClientOptions {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly fetch?: typeof globalThis.fetch;
  /** 会话已创建但 runner 尚未发出 route 声明时的有界重试；缺省最多约 14 秒。 */
  readonly readinessRetry?: {
    readonly attempts?: number;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
  };
}

interface ErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly message?: unknown } | string;
}

function endpoint(options: AgentRouteClientOptions, route: string): string {
  return `${options.baseUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(options.sessionId)}/agent-routes/${encodeURIComponent(route)}`;
}

async function parseResponse(response: Response, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new PaneHostError("PAYLOAD_TOO_LARGE", "Agent Route response exceeds the pane grant", { status: response.status });
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PaneHostError("PAYLOAD_TOO_LARGE", "Agent Route response exceeds the pane grant", { status: response.status });
  }
  let body: unknown;
  try {
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    throw new PaneHostError("ROUTE_FAILED", "Agent Route returned invalid JSON", { status: response.status });
  }
  if (response.ok) return body;
  const envelope = body as ErrorEnvelope | undefined;
  const nested = typeof envelope?.error === "object" && envelope.error !== null ? envelope.error : undefined;
  const upstreamCode = typeof nested?.code === "string" ? nested.code : undefined;
  const upstreamMessage = typeof nested?.message === "string"
    ? nested.message
    : (typeof envelope?.error === "string" ? envelope.error : `Agent Route HTTP ${response.status}`);
  if (upstreamCode === "SESSION_NOT_FOUND") {
    throw new PaneHostError("HOST_UNAVAILABLE", "当前会话已失效，请重新打开 Agent 会话", { status: response.status });
  }
  if (upstreamCode === "ROUTE_NOT_FOUND") {
    throw new PaneHostError("HOST_UNAVAILABLE", "Agent Route 正在装配或未由当前 Agent 声明", {
      status: response.status,
      retryable: true,
    });
  }
  if (response.status === 409 || upstreamCode === "REVISION_CONFLICT") {
    throw new PaneHostError("REVISION_CONFLICT", upstreamMessage, { status: response.status });
  }
  throw new PaneHostError("ROUTE_FAILED", upstreamMessage, {
    status: response.status,
    retryable: response.status >= 500 || response.status === 404,
  });
}

export function createAgentRouteClient(options: AgentRouteClientOptions): {
  query(route: string, query?: Readonly<Record<string, string>>, maxResponseBytes?: number): Promise<unknown>;
  mutate(route: string, body: unknown, maxResponseBytes?: number): Promise<unknown>;
} {
  const fetcher = options.fetch ?? globalThis.fetch;
  const attempts = Math.max(1, options.readinessRetry?.attempts ?? 10);
  const initialDelay = Math.max(0, options.readinessRetry?.initialDelayMs ?? 250);
  const maxDelay = Math.max(initialDelay, options.readinessRetry?.maxDelayMs ?? 2_000);
  const withReadinessRetry = async (request: () => Promise<Response>, maxResponseBytes: number): Promise<unknown> => {
    let delay = initialDelay;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await parseResponse(await request(), maxResponseBytes);
      } catch (reason) {
        const retry = reason instanceof PaneHostError && reason.code === "HOST_UNAVAILABLE" && reason.retryable;
        if (!retry || attempt === attempts) throw reason;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        delay = Math.min(maxDelay, Math.max(1, delay * 2));
      }
    }
    throw new PaneHostError("HOST_UNAVAILABLE", "Agent Route is unavailable");
  };
  return {
    async query(route, query = {}, maxResponseBytes = DEFAULT_PANE_RESPONSE_BYTES) {
      const url = new URL(endpoint(options, route), globalThis.location?.origin ?? "http://localhost");
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      return withReadinessRetry(() => fetcher(url.toString()), maxResponseBytes);
    },
    async mutate(route, body, maxResponseBytes = DEFAULT_PANE_RESPONSE_BYTES) {
      return withReadinessRetry(() => fetcher(endpoint(options, route), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }), maxResponseBytes);
    },
  };
}
