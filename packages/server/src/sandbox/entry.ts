/**
 * resolveSandboxEntry — 定位 pi-sandbox 扩展入口,供"强制注入"使用。
 *
 * 强制注入的目的:让沙箱 enforcement **不依赖** pi 的默认扩展发现(user-scope 注册表),
 * 而是由 pi-web 在两种 spawn 模式显式加载:
 *  - cli 模式:`pi --mode rpc -e <entry>`(`--extension, -e <path>`,可多次)。
 *  - custom 模式:经 env `PI_WEB_SANDBOX_ENTRY` 传给 runner,由 option-mapper 追加到
 *    `additionalExtensionPaths`(SDK 在 noExtensions 下仍加载;whitelist 经 mapper 放行)。
 *
 * 解析优先级:env `PI_WEB_SANDBOX_ENTRY` 覆盖 > `<agentDir>/npm/node_modules/pi-sandbox/index.ts`
 * (`pi install npm:pi-sandbox` 的落地位置)。找不到返回 undefined(调用方据此跳过注入,不报错)。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** pi-sandbox 在 user-scope 安装后的相对入口。 */
const PI_SANDBOX_REL = ["npm", "node_modules", "pi-sandbox", "index.ts"] as const;

export function resolveSandboxEntry(agentDir?: string): string | undefined {
  const fromEnv = process.env["PI_WEB_SANDBOX_ENTRY"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return existsSync(fromEnv) ? fromEnv : undefined;
  }
  const base =
    agentDir ?? process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  const candidate = join(base, ...PI_SANDBOX_REL);
  return existsSync(candidate) ? candidate : undefined;
}
