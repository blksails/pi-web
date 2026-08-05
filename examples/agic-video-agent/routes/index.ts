/**
 * agents/aigc 声明的全部 HTTP 路由（barrel）。
 *
 * 新增路由：建 `routes/<name>.ts`（导出其 `AgentRouteDecl`）后，在此按稳定顺序追加一行。
 * index.ts 只 `import { routes }` 传给 defineAgent，不放 handler 逻辑。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { galleryStatsRoute } from "./gallery-stats.js";
import { materialsRoutes } from "../packages/materials-pane/src/routes/index.js";
import { searchRoutes } from "../packages/search-pane/src/routes/index.js";
import { videoStudioStateRoute } from "../video-studio/routes.js";

export const routes: AgentRouteDecl[] = [
  galleryStatsRoute,
  ...searchRoutes,
  ...materialsRoutes,
  videoStudioStateRoute,
];
