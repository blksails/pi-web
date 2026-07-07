/**
 * `whoami`(GET)—— 返回该 agent 的静态身份与路由清单(确定性,无时间戳)。
 *
 * 演示 handler 可返回任意 JSON 可序列化结构;此处刻意只用定值,便于端到端断言。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

export function whoamiHandler(): unknown {
  return {
    agent: "agent-routes-demo",
    routes: ["ping", "echo", "whoami"],
  };
}

export const whoamiRoute: AgentRouteDecl = {
  name: "whoami",
  description: "返回 agent 身份与声明的路由清单(定值)",
  handler: whoamiHandler,
};
