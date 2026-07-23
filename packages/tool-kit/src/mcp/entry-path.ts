/**
 * 解析「内置 MCP 客户端扩展」文件的绝对路径。
 *
 * 镜像 `../auto-title/entry-path.ts`:从本模块位置(`import.meta.url`)推算,**不 import**
 * `mcp-extension`(后者拉 pi SDK 与 MCP SDK),故本模块可安全进前端/Next server bundle ——
 * pi-handler 调它拿路径,经 spawn env `PI_WEB_MCP_ENTRY` 下发给 agent 子进程,runner
 * option-mapper 据此加入 forcedExtensionPaths。
 *
 * standalone 产物里打包器会把 `import.meta.url` 内联成构建机绝对路径(换机/换 OS 失效),
 * 故失败/不存在则回退运行时 cwd(产物以 cwd=根启动,源文件落在 packages/tool-kit/ 下)。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REL = "mcp-extension.ts";
const CWD_REL = "packages/tool-kit/src/mcp/mcp-extension.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/**
 * MCP 客户端扩展文件的绝对路径;解析不到则 undefined(runner 跳过注入,MCP 能力不可用,
 * 但**不阻塞会话** —— 与 Req 1.5 的降级方向一致)。
 */
export function mcpEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}
