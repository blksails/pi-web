/**
 * 桌面壳 standalone 产物入口定位(spec pi-web-desktop task 2.1,Req 3.3/8.1/8.2)。
 *
 * 纯函数:按运行模式返回被拉起的 standalone `server.js` 绝对路径,或 dev 态返回 null
 * (壳改加载 dev url,不拉起 server)。所有环境相关输入经 `deps` 注入以便测试:
 * - `resourcesPath`:打包态资源目录(生产传 Electron 的 process.resourcesPath),
 *   产物经 electron-builder extraResources 落在其下的 `standalone/`(见 task 3.2)。
 * - `cliStandaloneJs`:CLI 布局下的产物入口(生产传 bin/pi-web.mjs 导出的 standaloneServerJs())。
 */
import { join } from "node:path";
import type { RuntimeMode } from "./runtime-mode.js";

export interface ResolveServerEntryDeps {
  /** 打包态资源目录;生产为 process.resourcesPath。dev/unpackaged 可为 undefined。 */
  readonly resourcesPath: string | undefined;
  /** CLI 布局产物入口绝对路径(unpackaged 用)。 */
  readonly cliStandaloneJs: string;
}

/** @returns packaged/unpackaged → server.js 绝对路径;dev → null。 */
export function resolveServerEntry(
  mode: RuntimeMode,
  deps: ResolveServerEntryDeps,
): string | null {
  if (mode.kind === "dev") return null;
  if (mode.kind === "packaged") {
    if (deps.resourcesPath === undefined || deps.resourcesPath === "") {
      throw new Error(
        "打包态无法定位 standalone 产物:缺少 resourcesPath(应为 Electron 的 process.resourcesPath)。",
      );
    }
    return join(deps.resourcesPath, "standalone", "server.js");
  }
  // unpackaged:直跑构建产物,复用 CLI 布局入口。
  return deps.cliStandaloneJs;
}
