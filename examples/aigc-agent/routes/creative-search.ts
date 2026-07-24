/**
 * `creative-search` — 搜索域 pane 自带的声明式 HTTP route(Wave 5 · 6.1)。
 *
 * 承接宿主 POST /api/creative-search 的语义(以词搜图):子进程内经 ../platform-client.js
 * 回调父进程 /api/internal/platform/creatives/search,父进程以回调 token 绑定的租户身份
 * (claims.tid)做多模态编码 + creative_vectors 相似检索——子进程不持任何后端凭证。
 *
 * 降级语义(响应体恒 `{ items, error? }`,handler 不抛错):
 *  - body 非法 → `{ error: "invalid_body", items: [] }`
 *  - 平台接缝不可用(无回调 token / 回调失败)→ `{ error: "platform_unavailable", items: [] }`
 *  - 未配 DASHSCOPE_API_KEY → 父进程回 `{ error: "embedding_unavailable", items: [] }`,原样透传。
 *
 * 外部调用:POST /api/sessions/<sessionId>/agent-routes/creative-search  body { query, limit? }
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { getPlatformContext } from "../platform-client.js";

export async function creativeSearchHandler(req: AgentRouteRequest): Promise<unknown> {
  const body = (req.body ?? {}) as { query?: unknown; limit?: unknown };
  if (typeof body.query !== "string" || body.query === "") {
    return { error: "invalid_body", items: [] };
  }
  const platform = getPlatformContext();
  if (!platform.available) return { error: "platform_unavailable", items: [] };
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 20;
  try {
    return await platform.searchCreatives(body.query, limit);
  } catch {
    return { error: "platform_unavailable", items: [] };
  }
}

/** 路由声明:文件名 creative-search.ts === name「creative-search」=== URL /agent-routes/creative-search。 */
export const creativeSearchRoute: AgentRouteDecl = {
  name: "creative-search",
  methods: ["POST"],
  description: "以词搜图(多模态编码 → creative_vectors 相似检索,租户隔离)",
  handler: creativeSearchHandler,
};
