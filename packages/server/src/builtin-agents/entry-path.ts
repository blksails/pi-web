/**
 * 内置 default-agent 入口文件的绝对路径解析。
 *
 * 镜像 `../../tool-kit/.../entry-path.ts` 范式:从本模块位置(`import.meta.url`)推算 default-agent
 * 的 `index.ts` 绝对路径,**不 import** 它(那会把它拉进 bundle);AgentSourceResolver 据此把保留
 * source `builtin:default-agent` 解析成 custom-mode 入口。
 *
 * standalone 产物里打包器可能把 `import.meta.url` 内联成构建机绝对路径(换机失效),故解析不到时
 * 回退运行时 cwd(产物以 cwd=仓库根启动,源文件落在 packages/server/src/builtin-agents/ 下)。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 保留 source 标识:解析为内置 default-agent(custom 模式)。 */
export const BUILTIN_DEFAULT_AGENT_SOURCE = "builtin:default-agent";

const REL = "default-agent/index.ts";
const CWD_REL = "packages/server/src/builtin-agents/default-agent/index.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/**
 * 内置 default-agent 入口的绝对路径;解析不到则 undefined(resolver 抛错,回退由上层处理)。
 */
export function defaultAgentEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}
