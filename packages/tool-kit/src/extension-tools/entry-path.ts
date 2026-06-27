/**
 * 解析「扩展管理扩展」文件的绝对路径（spec extension-install-agent-tools, Req 1.1）。
 *
 * 镜像 `@blksails/pi-web-server` 的 `runner-bootstrap-path.ts`：从本模块位置
 * (`import.meta.url`) 推算，**不 import** `extension-manager`（后者拉 pi SDK/pi-ai），故本模块
 * 可安全进 Next server bundle —— pi-handler 调它拿路径，经 spawn env `PI_WEB_EXT_TOOLS_ENTRY`
 * 下发给 agent 子进程，runner option-mapper 据此加入 forcedExtensionPaths。
 *
 * standalone 产物里 webpack 把 `import.meta.url` 内联成构建机绝对路径（换机/换 OS 失效），
 * 故失败/不存在则回退运行时 cwd（产物以 cwd=根启动，源文件落在 packages/tool-kit/ 下）。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REL = "extension-manager.ts";
const CWD_REL = "packages/tool-kit/src/extension-tools/extension-manager.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/**
 * 扩展管理扩展文件的绝对路径；解析不到则 undefined（runner 跳过注入，扩展管理不可用，
 * 不阻塞会话）。
 */
export function extensionManagerEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}
