/**
 * get_commands 回填 `webVisible`(spec plugin-system-unification 增量)。
 *
 * 平台默认隐藏 `source:"extension"` 命令(防 busy 卡死的历史安全网)。统一插件可在
 * `pi-plugin.json` 的 `web.commands` 显式声明 web 可见命令;此处据命令的 sourceInfo
 * 解析其所属插件清单,命中则打 `webVisible:true`,前端补全据此放行(安全网仍在,opt-in)。
 *
 * 按 packageRoot 缓存解析,O(去重后插件数) 次 fs 读;解析失败安全降级(不打标记)。
 */
import path from "node:path";
import { resolvePiPlugin } from "./resolve-plugin.js";

interface CommandShape {
  readonly name?: unknown;
  readonly source?: unknown;
  readonly sourceInfo?: { readonly baseDir?: unknown; readonly origin?: unknown };
}

/** 由命令的 sourceInfo 推算其插件包根:top-level → `<src>/.pi` 的父;package → baseDir 即包根。 */
function packageRootOf(baseDir: string, origin: unknown): string {
  return origin === "top-level" ? path.dirname(baseDir) : baseDir;
}

/**
 * 给 `source:"extension"` 命令回填 `webVisible`(据 pi-plugin.json 的 `web.commands`)。
 * 非扩展命令、无 baseDir 的命令原样透传。
 */
export async function enrichWebVisibleCommands(
  commands: readonly unknown[],
): Promise<unknown[]> {
  const cache = new Map<string, Set<string>>();
  const out: unknown[] = [];
  for (const c of commands) {
    const cmd = c as CommandShape;
    if (
      cmd.source !== "extension" ||
      typeof cmd.name !== "string" ||
      typeof cmd.sourceInfo?.baseDir !== "string"
    ) {
      out.push(c);
      continue;
    }
    const root = packageRootOf(cmd.sourceInfo.baseDir, cmd.sourceInfo.origin);
    let webCmds = cache.get(root);
    if (webCmds === undefined) {
      const descriptor = await resolvePiPlugin(root).catch(() => undefined);
      webCmds = new Set(descriptor?.webCommands ?? []);
      cache.set(root, webCmds);
    }
    out.push(
      webCmds.has(cmd.name) ? { ...(c as object), webVisible: true } : c,
    );
  }
  return out;
}
