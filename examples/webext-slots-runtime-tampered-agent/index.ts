/**
 * webext-slots-runtime-tampered-agent — 安全门降级 e2e 夹具(任务 6.4)。
 * `.pi/web/dist/web-extension.mjs` 由 globalSetup 正常构建 + 签名后,故意在字节层追加
 * 一段污染内容(manifest.json 的 SRI 摘要保持构建时的原值不变),模拟「产物在传输/落盘
 * 途中被篡改」——验证浏览器原生 SRI 校验会拒绝执行被篡改的脚本,宿主壳不崩溃。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt: "You are the tampered-entry webext degradation fixture.",
});
