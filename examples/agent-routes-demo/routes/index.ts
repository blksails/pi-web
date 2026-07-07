/**
 * 该 agent 声明的全部 HTTP 路由(barrel)。
 * 新增路由:建 `routes/<name>.ts`(导出其 `AgentRouteDecl`)后在此按稳定顺序追加一行。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { pingRoute } from "./ping.js";
import { echoRoute } from "./echo.js";
import { whoamiRoute } from "./whoami.js";

export const routes: AgentRouteDecl[] = [pingRoute, echoRoute, whoamiRoute];
