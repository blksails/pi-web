#!/usr/bin/env node
/**
 * dev server 引导(e2b 模式)—— 用**编程式 jiti** 加载 `server/index.ts`,并把 `e2b`/`platform`
 * 标为 nativeModules。
 *
 * 为什么不用默认 `jiti-register.mjs`:e2b@2.33 内部 `platform = __toESM(require("platform"))`
 * 再读 `platform.default.version`,经 jiti 的 ESM register hook 转换后 `.default` 丢失 → getRuntime
 * 抛 `Cannot read properties of undefined (reading 'version')`,整个 e2b 模块加载即崩。
 * `createJiti(url,{ nativeModules:["e2b","platform"] })` 让这两个包走**原生 require**(不转换),
 * 保留 e2b 自带的 __toESM 语义 → 正常加载。默认(非 e2b)dev 仍用 `jiti-register.mjs`,不受影响。
 */
// jiti 未 hoist 到根 node_modules(pnpm 在 .pnpm 里),与 dev:server 一致走全路径入口。
import { createJiti } from "../node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  nativeModules: ["e2b", "platform"],
  interopDefault: true,
});
await jiti.import(path.join(root, "server", "index.ts"));
