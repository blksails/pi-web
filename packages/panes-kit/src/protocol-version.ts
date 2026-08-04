/**
 * pane 协议的纯常量(spec host-builtin-panes,任务 2.5)。
 *
 * ## 为什么单独成文件
 *
 * 这些常量原本住在 `contract.ts`。那个模块顶层是一串 `z.object({...})` —— 对打包器而言是
 * **副作用表达式**,不敢 tree-shake。后果:guest SDK 只为取一个 `= 1 as const` 的版本号而
 * import 它,就把整个 zod(约 62KB minified)拖进 guest bundle。
 *
 * 实测(2026-07-30):`import { PANE_PROTOCOL_VERSION } from "./contract.js"` 后打包,产物
 * 61,835 bytes 且含 `ZodError`;经 barrel 或深路径导入都一样 —— 与 barrel 无关,是模块副作用。
 *
 * 这对 **guest 侧**格外要紧:内置 pane 的文档是内联进宿主 bundle 的字符串,每个 pane 都会
 * 重复内联一份。本文件零依赖,故 guest 从这里取常量时不会牵出任何东西。
 *
 * `contract.ts` re-export 这两个名字,既有导入点零破坏。
 */

/** pane 宿主与 guest 之间的握手协议版本。双方不一致时拒绝建连。 */
export const PANE_PROTOCOL_VERSION = 1 as const;

/** 显式哨兵:宿主有意不施加 pane 数量上限时使用。 */
export const UNLIMITED_PANE_COUNT = Number.MAX_SAFE_INTEGER;
