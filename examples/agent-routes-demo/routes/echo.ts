/**
 * `echo`(GET·POST)—— 回显入参 route,演示 query 与 POST body 的透传。
 *
 * 文件名 echo.ts === name「echo」=== URL 段。声明 `methods: ["GET","POST"]`(缺省仅 GET)。
 * GET 恒无 body;POST 携带的 JSON 经 `req.body` 拿到。
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";

export function echoHandler(req: AgentRouteRequest): unknown {
  return {
    method: req.method,
    query: req.query,
    body: req.body ?? null,
  };
}

export const echoRoute: AgentRouteDecl = {
  name: "echo",
  methods: ["GET", "POST"],
  description: "回显 method / query / body",
  handler: echoHandler,
};
