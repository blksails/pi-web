/**
 * `creative-search` — 搜索域 pane 自带的声明式 HTTP route(Wave 5 · 6.1)。
 *
 * 对齐 webapp `/api/agent/materials` 的 `op: "similar-search"` 契约；子进程只持
 * scoped Bearer 凭据，经 BFF 按当前租户做多模态编码与素材向量检索。
 *
 * 降级语义(响应体恒 `{ items, error? }`,handler 不抛错):
 *  - body 非法 → `{ error: "invalid_body", items: [] }`
 *  - 平台接缝不可用(无回调 token / 回调失败)→ `{ error: "platform_unavailable", items: [] }`
 *  - 未配 DASHSCOPE_API_KEY → 父进程回 `{ error: "embedding_unavailable", items: [] }`,原样透传。
 *
 * 外部调用:POST /api/sessions/<sessionId>/agent-routes/creative-search  body
 * { text|query, image_url|imageDataUri, limit? }。
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { getSearchPlatformClient, SearchPlatformError } from "../platform.js";

export async function creativeSearchHandler(req: AgentRouteRequest): Promise<unknown> {
  const body = (req.body ?? {}) as {
    query?: unknown;
    text?: unknown;
    imageDataUri?: unknown;
    image_url?: unknown;
    limit?: unknown;
  };
  const query =
    typeof body.text === "string"
      ? body.text.trim()
      : typeof body.query === "string"
        ? body.query.trim()
        : "";
  const imageDataUri =
    typeof body.image_url === "string"
      ? body.image_url.trim()
      : typeof body.imageDataUri === "string"
        ? body.imageDataUri.trim()
        : "";
  if ((query === "") === (imageDataUri === "")) {
    return { error: "invalid_body", items: [] };
  }
  if (imageDataUri.length > 20 * 1024 * 1024) {
    return { error: "invalid_body", items: [] };
  }
  const platform = getSearchPlatformClient();
  if (!platform.available) return { error: "platform_unavailable", items: [] };
  const limit =
    typeof body.limit === "number" && Number.isSafeInteger(body.limit)
      ? Math.min(120, Math.max(1, body.limit))
      : 60;
  try {
    return await platform.searchCreatives({
      ...(query !== "" ? { text: query } : { imageDataUri }),
      limit,
    });
  } catch (error) {
    return {
      error: error instanceof SearchPlatformError ? error.code : "platform_unavailable",
      items: [],
    };
  }
}

/** 路由声明:文件名 creative-search.ts === name「creative-search」=== URL /agent-routes/creative-search。 */
export const creativeSearchRoute: AgentRouteDecl = {
  name: "creative-search",
  methods: ["POST"],
  description: "以词搜图(多模态编码 → creative_vectors 相似检索,租户隔离)",
  handler: creativeSearchHandler,
};
