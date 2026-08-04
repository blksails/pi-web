#!/usr/bin/env node
/**
 * 导出兼容层主入口的符号清单(spec: core-package-extraction,任务 1.1)。
 *
 * 该清单是 R2.2「主入口符号集合逐字不变」的**比对基准**,以文件形式入库:
 * 改动它必须是有意动作、会出现在 diff 里。这也是 R2.4「刻意不导出的缺口不得顺手补全」
 * 的执行方式 —— 补全会让符号数增加,常驻测试立刻转红。
 *
 * 用法:node scripts/dump-main-entry-symbols.mjs > test/compat/main-entry-symbols.txt
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
const mod = await jiti.import(path.join(pkgDir, "src/index.ts"));
console.log(Object.keys(mod).sort().join("\n"));
