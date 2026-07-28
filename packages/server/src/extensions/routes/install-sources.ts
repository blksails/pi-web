/**
 * extension-management — GET /sessions/:id/install-sources?q=<前缀>
 * (plugin-subcommand-completion R3;spec agent-plugin-commands 任务 1.3 改为经端口取数)。
 *
 * 本文件只剩 HTTP 层职责:会话查找、查询参数读取、响应组装与降级。真正的枚举交给注入的
 * `InstallSourceProvider`(缺省为本地扫描实现),使非本地形态可替换实现而无须改动本端点。
 * 只读端点,不强制管理员门控。
 */
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RequestContext, RouteHandler } from "../../http/index.js";
import type { SessionStore } from "../../session/index.js";
import type { InstallSourceProvider } from "../install-sources/types.js";
import { createScanInstallSourceProvider } from "../install-sources/scan-provider.js";

export type { InstallSourceRecord as InstallSourceItem } from "../install-sources/types.js";

export function makeInstallSourcesHandler(
  store: SessionStore,
  provider: InstallSourceProvider = createScanInstallSourceProvider(),
): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    const sessionId = ctx.sessionId ?? "";
    const session = store.get(sessionId);
    if (session === undefined) {
      return errorResponse(
        404,
        "SESSION_NOT_FOUND",
        `Session "${sessionId}" not found.`,
      );
    }
    const q = ctx.url.searchParams.get("q") ?? "";
    try {
      const sources = await provider.list({ cwd: session.cwd, query: q });
      return jsonResponse(200, { sources });
    } catch {
      // 端口失败 → 降级为空候选而非 5xx:补全是辅助能力,不该因枚举故障阻断输入
      // (Req 8.5,与命令面板的空候选降级同语义)。
      return jsonResponse(200, { sources: [] });
    }
  };
}
