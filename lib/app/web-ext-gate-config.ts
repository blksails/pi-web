/**
 * web-ext 门控配置(webext-package-install 任务 1.3)。
 *
 * 拆分「签名服务端验 / SRI 浏览器验」:
 *   - 服务端 `buildServerGateOptions`:持受信发布者 **Ed25519 公钥** 白名单,用于
 *     服务端验签(WebextTrustService)。白名单与 requireSignature 仅在服务端使用。
 *   - 浏览器 `buildBrowserGateOptions`:**不含任何验签材料**,置 `signaturePreVerified`,
 *     浏览器仅做 SRI。验签由服务端完成,机密/材料不下发浏览器(Req 5.2, 6.4, 10.4)。
 *
 * 环境变量:
 *   - PI_WEB_EXT_WHITELIST:逗号分隔的受信发布者 Ed25519 公钥(base64 raw)。
 *   - PI_WEB_EXT_REQUIRE_SIGNATURE:是否强制签名(默认 "true";生产不得置 false,见任务 2.2)。
 *   - 宿主 web-kit 版本(targetApiVersion 兼容判定)由 `host-api-version.ts` 统一解析:
 *     构建期从 web-kit 包版本注入,`NEXT_PUBLIC_PI_WEB_KIT_VERSION` / `PI_WEB_KIT_VERSION` 可覆盖。
 */
import type { GateOptions } from "@blksails/pi-web-react";
// #33:宿主版本唯一解析点(构建期注入 + env 可选覆盖),不再各自 env ?? "0.1.0"
import { resolveHostApiVersion } from "./host-api-version.js";

/**
 * 服务端门控选项:含受信发布者公钥白名单与 requireSignature,供服务端验签使用。
 * 切勿原样下发浏览器——浏览器请用 {@link buildBrowserGateOptions}。
 */
export function buildServerGateOptions(
  env: NodeJS.ProcessEnv = process.env,
): GateOptions {
  const whitelist = (env.PI_WEB_EXT_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const requireSignature = env.PI_WEB_EXT_REQUIRE_SIGNATURE !== "false";
  return { whitelist, requireSignature, hostApiVersion: resolveHostApiVersion(env) };
}

/**
 * 浏览器门控选项:不含白名单/验签材料,`signaturePreVerified` 置真(签名已服务端验),
 * 浏览器仅校验 SRI 与版本兼容。
 */
export function buildBrowserGateOptions(
  env: NodeJS.ProcessEnv = process.env,
): GateOptions {
  return {
    whitelist: [],
    requireSignature: false,
    hostApiVersion: resolveHostApiVersion(env),
    signaturePreVerified: true,
  };
}

/**
 * @deprecated 使用 {@link buildServerGateOptions}(服务端)或 {@link buildBrowserGateOptions}(浏览器)。
 * 保留以兼容既有引用;语义等同服务端选项。
 */
export function buildGateOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GateOptions {
  return buildServerGateOptions(env);
}
