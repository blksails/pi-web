/**
 * webext-slots-runtime-badsig-agent — 安全门降级 e2e 夹具(任务 6.4)。
 * `.pi/web/dist/manifest.json` 由 globalSetup 用一把**不在** playwright.config 的
 * PI_WEB_EXT_WHITELIST 里的 Ed25519 私钥签名,验证服务端 WebextTrustService 会拒绝
 * 下发(resolve 端点返回 rejectedReason),宿主壳降级到默认 UI,不崩溃。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt: "You are the bad-signature webext degradation fixture.",
});
