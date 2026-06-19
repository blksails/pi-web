/**
 * web-ext 门控配置(任务 3.3 / Req 7.x)。
 *
 * 从环境变量读取扩展加载安全策略,供宿主侧 extension-gate 使用:
 *   - PI_WEB_EXT_WHITELIST:逗号分隔的受信签名密钥(HMAC 共享密钥)。
 *   - PI_WEB_EXT_REQUIRE_SIGNATURE:是否强制签名(默认 "true";git source 加载代码 bundle 应保持开启)。
 *   - PI_WEB_KIT_VERSION:宿主 web-kit 版本(targetApiVersion 兼容判定);缺省 "0.1.0"。
 *
 * 该配置在 server 读取后随页面下发给客户端(由 app-shell 注入,见 awe-5)。
 */
import type { GateOptions } from "@pi-web/react";

export function buildGateOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GateOptions {
  const whitelist = (env.PI_WEB_EXT_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const requireSignature = env.PI_WEB_EXT_REQUIRE_SIGNATURE !== "false";
  const hostApiVersion = env.PI_WEB_KIT_VERSION ?? "0.1.0";
  return { whitelist, requireSignature, hostApiVersion };
}
