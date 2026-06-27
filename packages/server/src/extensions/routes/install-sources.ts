/**
 * extension-management — GET /sessions/:id/install-sources?q=<前缀>
 * (plugin-subcommand-completion R3)。
 *
 * 按会话 cwd 浅层扫描"可作为 install local: 源"的目录(含 index.ts/index.js/package.json/.pi
 * 任一),返回相对路径候选 `{ path, insertText: "local:<rel>" }`。realpath 归一 + 越界防护:
 * 仅返回 realpath 仍位于 cwd 内的目录,不泄露 cwd 之外路径。只读端点,不强制管理员门控。
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RequestContext, RouteHandler } from "../../http/index.js";
import type { SessionStore } from "../../session/index.js";

/** 候选目录的判定标志文件。 */
const MARKERS = ["index.ts", "index.js", "package.json", ".pi"] as const;
/** 扫描深度(相对 cwd 的最大层数)与候选上限。 */
const MAX_DEPTH = 2;
const MAX_ITEMS = 30;
/** 跳过的噪声目录。 */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
]);

export interface InstallSourceItem {
  readonly path: string;
  readonly insertText: string;
}

async function hasMarker(dir: string): Promise<boolean> {
  for (const m of MARKERS) {
    try {
      await fs.access(path.join(dir, m));
      return true;
    } catch {
      // 不存在,试下一个标志。
    }
  }
  return false;
}

/** 浅层扫描 cwd 下可装目录;realpath 越界则跳过。 */
async function scanInstallSources(
  cwd: string,
  query: string,
): Promise<InstallSourceItem[]> {
  let cwdReal: string;
  try {
    cwdReal = await fs.realpath(cwd);
  } catch {
    return [];
  }
  const q = query.toLowerCase();
  const out: InstallSourceItem[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_ITEMS) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_ITEMS) return;
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) {
        continue;
      }
      const abs = path.join(dir, e.name);
      // 越界防护:realpath 必须仍在 cwd 内。
      let real: string;
      try {
        real = await fs.realpath(abs);
      } catch {
        continue;
      }
      if (real !== cwdReal && !real.startsWith(cwdReal + path.sep)) continue;

      const rel = path.relative(cwdReal, real);
      if (await hasMarker(abs)) {
        const relNorm = `./${rel.split(path.sep).join("/")}`;
        if (q.length === 0 || relNorm.toLowerCase().includes(q)) {
          out.push({ path: relNorm, insertText: `local:${relNorm}` });
        }
      }
      await walk(abs, depth + 1);
    }
  }

  await walk(cwdReal, 1);
  return out.slice(0, MAX_ITEMS);
}

export function makeInstallSourcesHandler(store: SessionStore): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    const sessionId = ctx.sessionId ?? "";
    const session = store.get(sessionId);
    if (session === undefined) {
      return errorResponse(
        404,
        "SESSION_NOT_FOUND",
        `Session "${sessionId}" not found.`,
      );
    }
    const q = ctx.url.searchParams.get("q") ?? "";
    try {
      const sources = await scanInstallSources(session.cwd, q);
      return jsonResponse(200, { sources });
    } catch (err) {
      const summary =
        err instanceof Error ? err.message : "failed to scan install sources";
      return errorResponse(502, "INSTALL_SOURCES_FAILED", summary);
    }
  };
}
