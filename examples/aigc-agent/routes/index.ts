/**
 * agents/aigc 声明的全部 HTTP 路由（barrel）。
 *
 * 新增路由：建 `routes/<name>.ts`（导出其 `AgentRouteDecl`）后，在此按稳定顺序追加一行。
 * index.ts 只 `import { routes }` 传给 defineAgent，不放 handler 逻辑。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { galleryStatsRoute } from "./gallery-stats.js";

export const routes: AgentRouteDecl[] = [galleryStatsRoute];
