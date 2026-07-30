/**
 * aigc-models-routes — GET /aigc/models(aigc-tool-settings;model-catalog spec 任务 3.1 扩参)。
 *
 * 只读返回图像模型展示目录 `{ models: [{model,label,provider,source?}] }`,供 /settings 的
 * 「模型开关」自定义 widget 列举(该页无会话态,拿不到 aigcExtension 运行期下发的 `aigc.models`)。
 *
 * 数据源可注入(`listEntries`,装配处接 ModelCatalogService.imageEntries():聚合形态附
 * 可选 `source` 来源字段,Req 4.1);未注入时回落 tool-kit **主入口**的纯静态
 * `AIGC_MODEL_CATALOG`(零 pi SDK,不进前端 bundle 崩 dev;向后兼容既有直调用者,
 * 输出与主干逐字节一致,Req 4.3)。
 * 「被禁模型」的读写走标准 config 域 `/api/config/aigc`(落 `<agentDir>/aigc.json`),不在此。
 */
import { AIGC_MODEL_CATALOG } from "@blksails/pi-web-tool-kit";
import { jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import type { CatalogImageEntry } from "../model-catalog/index.js";

/** `createAigcModelsRoute` 的可选注入(model-catalog spec 任务 3.1)。 */
export interface CreateAigcModelsRouteOpts {
  /**
   * 目录取数接缝(请求期求值)。缺省 = 静态 `AIGC_MODEL_CATALOG` 原样返回
   * (条目不带 `source`,与主干逐字节一致)。
   */
  readonly listEntries?: () => readonly CatalogImageEntry[];
}

export function createAigcModelsRoute(
  opts?: CreateAigcModelsRouteOpts,
): ReadonlyArray<InjectedRoute> {
  const listEntries = opts?.listEntries ?? (() => AIGC_MODEL_CATALOG);
  const get: InjectedRoute = {
    method: "GET",
    path: "/aigc/models",
    handler: async () => jsonResponse(200, { models: [...listEntries()] }),
  };
  return [get];
}
