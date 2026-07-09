/**
 * vision-models-routes — GET /vision/models(spec canvas-vision-readout)。
 *
 * 只读返回「已配置凭证且支持图像输入」的模型清单 `{ models: [{value,label,provider}] }`,
 * 供 Canvas 提示词栏的视觉模型选择器列举。`value` 是 `provider/modelId`,
 * 可原样填进 `image_vision` 工具的 `model` 参数。
 *
 * 取数经 `deps.listModels` 注入(与 `createConfigRoutes` 的 `listModelOptions` 同形态),
 * 使本模块的单测不必加载 pi SDK。
 *
 * 降级:取数抛错(如 `models.json` 损坏)→ 返回 **200 + 空清单**,而非把 500 透给前端。
 * 前端据此退化为「由工具弹层选择模型」,解读功能仍可用(Req 3.6)。
 *
 * 挂载:经 `routes:` 注入接缝进入 `createPiWebHandler`,宿主(`server/index.ts`)以一条
 * `app.all("/api/*")` 转发全部 API 面。(spec vite-spa-migration 删除 Next 后,不再需要
 * per-段的 catch-all 转发器。)
 */
import { jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import type { VisionModelOptions } from "./vision-model-options.types.js";

export interface VisionModelsRouteDeps {
  /** 列出可用视觉模型;抛错由本路由兜底为空清单。 */
  readonly listModels: () => VisionModelOptions;
}

export function createVisionModelsRoute(
  deps: VisionModelsRouteDeps,
): ReadonlyArray<InjectedRoute> {
  const get: InjectedRoute = {
    method: "GET",
    path: "/vision/models",
    handler: async () => {
      try {
        const { models } = deps.listModels();
        return jsonResponse(200, { models: [...models] });
      } catch {
        // 降级而非 500:前端退化为工具弹层选择(3.6),解读按钮保持可用。
        return jsonResponse(200, { models: [] });
      }
    },
  };
  return [get];
}
