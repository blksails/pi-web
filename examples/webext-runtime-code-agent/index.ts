/**
 * webext-runtime-code-agent — 代码 webext 运行时加载验收夹具(webext-package-install)。
 *
 * 刻意不在构建期注册表。其 `.pi/web` 含一个 Tier1 slot(panelRight)代码组件,经
 * `pi-web build` 预构建为签名 .mjs(react/web-kit external),由运行时车道动态加载:
 *   /api/webext/resolve(服务端验签)→ import map(单例)→ import(.mjs)→ applyExtension。
 * 用于端到端验证「签名服务端验 / SRI 浏览器验 / import map 单例 / 代码执行」全链。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt: "You are the runtime-code webext acceptance fixture.",
});
