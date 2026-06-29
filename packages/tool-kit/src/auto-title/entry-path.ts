/**
 * 解析「自动标题扩展」文件的绝对路径。
 *
 * 镜像 `../extension-tools/entry-path.ts`:从本模块位置(`import.meta.url`)推算,**不 import**
 * `auto-title-extension`(后者拉 pi SDK/pi-ai),故本模块可安全进 Next server bundle —— pi-handler
 * 调它拿路径,经 spawn env `PI_WEB_AUTO_TITLE_ENTRY` 下发给 agent 子进程,runner option-mapper
 * 据此加入 forcedExtensionPaths。
 *
 * standalone 产物里 webpack 把 `import.meta.url` 内联成构建机绝对路径(换机/换 OS 失效),
 * 故失败/不存在则回退运行时 cwd(产物以 cwd=根启动,源文件落在 packages/tool-kit/ 下)。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REL = "auto-title-extension.ts";
const CWD_REL = "packages/tool-kit/src/auto-title/auto-title-extension.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/**
 * 自动标题扩展文件的绝对路径;解析不到则 undefined(runner 跳过注入,自动标题不可用,
 * 不阻塞会话)。
 */
export function autoTitleEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}
