/**
 * agent-routes-demo —— 声明式 HTTP routes 的**多路由**范例(spec agent-declared-routes)。
 *
 * 演示重点是**文件目录标准**:三个只读 route(ping / echo / whoami)各占一文件
 * `routes/<name>.ts`(文件名 === 路由 name === URL 段),`routes/index.ts` barrel 汇总,
 * 本文件只 `import { routes }` 传给 `defineAgent`、不放任何 handler 逻辑。
 * 详见 docs/product/07-agent-development.md「声明式路由的文件组织」。
 *
 * 会话创建后可直接调用(无需订阅 SSE):
 *   GET  /api/sessions/:id/agent-routes/ping
 *   GET  /api/sessions/:id/agent-routes/echo?foo=bar
 *   POST /api/sessions/:id/agent-routes/echo   { "hello": "world" }
 *   GET  /api/sessions/:id/agent-routes/whoami
 *
 * model 省略 → 继承 ~/.pi/agent/settings.json 默认;无工具/扩展,hermetic。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { routes } from "./routes/index.js";

export default defineAgent({
  systemPrompt: [
    "You are agent-routes-demo, a pi-web example showcasing agent-declared HTTP routes.",
    "The routes (ping / echo / whoami) are callable directly over HTTP without the LLM.",
    "Keep chat replies concise.",
  ].join("\n"),
  // 声明式 HTTP routes 集中在 routes/ 子目录(一路由一文件);此处只汇总。
  routes,
  // Self-contained:关内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
