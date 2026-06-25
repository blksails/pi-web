/**
 * webext-runtime-declarative-agent — 运行时加载验收夹具(webext-package-install)。
 *
 * 刻意 **不** 进构建期注册表(lib/app/webext-registry.ts),用于验证「构建期未命中 →
 * 经 /api/webext/resolve 运行时动态加载」这条 Tier5 纯声明路径。其 webext 产物在
 * `.pi/web/dist/manifest.json`(纯声明,无 entry,零 bundle)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";

const agent = defineAgent({
  systemPrompt: "You are the runtime-declarative webext acceptance fixture.",
});

export default agent;
