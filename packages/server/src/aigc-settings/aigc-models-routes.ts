/**
 * aigc-models-routes — GET /aigc/models(aigc-tool-settings)。
 *
 * 只读返回图像模型展示目录 `{ models: [{model,label,provider}] }`,供 /settings 的「模型开关」
 * 自定义 widget 列举(该页无会话态,拿不到 aigcExtension 运行期下发的 `aigc.models`)。
 *
 * 数据源 = tool-kit **主入口**的纯 `AIGC_MODEL_CATALOG`(零 pi SDK,不进 Next bundle 崩 dev)。
 * 「被禁模型」的读写走标准 config 域 `/api/config/aigc`(落 `<agentDir>/aigc.json`),不在此。
 */
import { AIGC_MODEL_CATALOG } from "@blksails/pi-web-tool-kit";
import { jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";

export function createAigcModelsRoute(): ReadonlyArray<InjectedRoute> {
  const get: InjectedRoute = {
    method: "GET",
    path: "/aigc/models",
    handler: async () => jsonResponse(200, { models: [...AIGC_MODEL_CATALOG] }),
  };
  return [get];
}
