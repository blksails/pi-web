export interface CreativeSearchResult {
  readonly items: readonly unknown[];
  readonly error?: string;
  readonly total?: number;
  readonly requestId?: string;
}

export class SearchPlatformError extends Error {
  constructor(
    message: string,
    readonly code = "platform_unavailable",
    readonly status = 503,
    readonly retryable = status >= 500,
  ) {
    super(message);
    this.name = "SearchPlatformError";
  }
}

export interface CreativeSearchRequest {
  readonly text?: string;
  readonly imageDataUri?: string;
  readonly limit?: number;
}

interface CreativeSearchResponse {
  readonly items?: unknown;
  readonly error?: string | { readonly code?: string; readonly message?: string };
  readonly total?: unknown;
  readonly requestId?: unknown;
}

export interface SearchPlatformClient {
  readonly available: boolean;
  searchCreatives(input: CreativeSearchRequest): Promise<CreativeSearchResult>;
}

const UNAVAILABLE: SearchPlatformClient = {
  available: false,
  searchCreatives: () =>
    Promise.reject(new SearchPlatformError("platform seam unavailable")),
};

function requestBody(input: CreativeSearchRequest): Record<string, unknown> {
  const text = input.text?.trim() ?? "";
  const imageDataUri = input.imageDataUri?.trim() ?? "";
  if ((text === "") === (imageDataUri === "")) {
    throw new SearchPlatformError(
      "Provide text or one image.",
      "invalid_request",
      400,
      false,
    );
  }
  if (imageDataUri.length > 20 * 1024 * 1024) {
    throw new SearchPlatformError(
      "Image is too large.",
      "invalid_request",
      400,
      false,
    );
  }
  return {
    op: "similar-search",
    ...(text !== "" ? { text } : {}),
    ...(imageDataUri !== "" ? { image_url: imageDataUri } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
}

function responseError(
  error: CreativeSearchResponse["error"],
  status: number,
  statusText: string,
): { code: string; message: string } {
  if (typeof error === "string") {
    return { code: status >= 500 ? "platform_unavailable" : "request_failed", message: error };
  }
  if (error !== null && typeof error === "object") {
    return {
      code: error.code ?? (status >= 500 ? "platform_unavailable" : "request_failed"),
      message: error.message ?? statusText,
    };
  }
  return {
    code: status >= 500 ? "platform_unavailable" : "request_failed",
    message: statusText,
  };
}

/**
 * webapp `/api/agent/materials` similar-search BFF。
 * 凭据优先级：显式 Bearer → 桌面凭据 → 兼容 PI_LABS_MCP 别名。
 * 本地无服务时可设 PI_LABS_WEBAPP_URL 指向生产。
 */
export function getSearchPlatformClient(
  env: NodeJS.ProcessEnv = process.env,
): SearchPlatformClient {
  const base =
    env.PI_LABS_WEBAPP_URL?.trim() ||
    env.PI_WEB_DEV_WEBAPP_URL?.trim() ||
    "http://127.0.0.1:4000";
  const token =
    env.PI_LABS_WEBAPP_AUTHORIZATION?.replace(/^Bearer\s+/i, "").trim() ||
    env.PI_WEB_DESKTOP_CREDENTIAL?.trim() ||
    env.PI_LABS_MCP_TOKEN?.trim() ||
    "";
  if (token === "") {
    return UNAVAILABLE;
  }
  let endpoint: URL;
  try {
    endpoint = new URL("/api/agent/materials", base);
  } catch {
    return UNAVAILABLE;
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) return UNAVAILABLE;
  return {
    available: true,
    async searchCreatives(input) {
      const bodyInput = requestBody(input);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(bodyInput),
      });
      const body = (await response.json().catch(() => ({}))) as CreativeSearchResponse;
      if (!response.ok) {
        const detail = responseError(body.error, response.status, response.statusText);
        throw new SearchPlatformError(
          `搜图服务 ${response.status}: ${detail.message}`,
          detail.code,
          response.status,
        );
      }
      if (typeof body.error === "string") {
        return {
          items: Array.isArray(body.items) ? body.items : [],
          error: body.error,
          ...(typeof body.total === "number" ? { total: body.total } : {}),
          ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}),
        };
      }
      if (body.error !== undefined) {
        const detail = responseError(body.error, response.status, response.statusText);
        return {
          items: Array.isArray(body.items) ? body.items : [],
          error: detail.code,
          ...(typeof body.total === "number" ? { total: body.total } : {}),
          ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}),
        };
      }
      return {
        items: Array.isArray(body.items) ? body.items : [],
        ...(typeof body.total === "number" ? { total: body.total } : {}),
        ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}),
      };
    },
  };
}
