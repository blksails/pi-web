/**
 * `ping`(GET)—— 最小只读探活 route。
 *
 * 声明式路由文件标准:文件名 ping.ts === 路由 name「ping」=== URL 段 /agent-routes/ping。
 * handler 只在 agent 子进程内执行,返回值须 JSON 可序列化;单独 export 便于单测。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

export function pingHandler(): unknown {
  return { pong: true };
}

export const pingRoute: AgentRouteDecl = {
  name: "ping",
  description: "探活:返回 { pong: true }",
  handler: pingHandler,
};
