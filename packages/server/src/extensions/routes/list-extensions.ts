/**
 * extension-management — GET /extensions(Req 1.x/7.4)。
 *
 * 经注入的 `PiCli.listExtensions()`(`pi list` / 读 settings)取已安装清单,映射为扩展
 * 列表 DTO(含来源类型、版本/ref、全局/项目作用域)。无扩展 → 空列表(非错误,Req 1.4);
 * `pi list` 失败 → 可识别脱敏错误(Req 1.3)。只读端点不强制管理员门控(Req 7.4)。
 */
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RouteHandler } from "../../http/index.js";
import type { InstalledExtension, PiCli } from "../ext.types.js";

export function makeListExtensionsHandler(piCli: PiCli): RouteHandler {
  return async (): Promise<Response> => {
    try {
      const extensions: readonly InstalledExtension[] =
        await piCli.listExtensions();
      // 形状对齐 protocol 命名(extensions: InstalledExtension[])。
      return jsonResponse(200, { extensions: [...extensions] });
    } catch (err) {
      const summary =
        err instanceof Error ? err.message : "failed to list extensions";
      return errorResponse(502, "EXT_LIST_FAILED", summary);
    }
  };
}
