/**
 * webext 运行时车道 · **本机磁盘**载体的定位/读取实现(可选件)。
 *
 * `resolve-webext` 与 `dist-handler` 本身与载体无关;本文件提供「源在本机文件系统」这一
 * 最常见载体的现成实现,供 pi-web 单机宿主、桌面壳、以及云宿主的**本地开发形态**直接注入,
 * 免各自复刻安全校验。云上以 registry bundle 为载体时另实现一套,契约相同。
 *
 * 定位优先级:
 *   1. 本地源路径(相对 cwd 或绝对):`<source>/.pi/web/dist`
 *   2. 已装 npm 包(裸名):`<agentDir>/npm/node_modules/<source>/.pi/web/dist`
 *   3. 额外根(可选):`<root>/<source>/.pi/web/dist`——云宿主本地开发时把源仓挂在此
 *
 * 安全:dist 目录必须以 `.pi/web/dist` 结尾且存在;读取经**前缀校验**杜绝目录穿越
 * (arbitrary file read)。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { webextContentTypeFor } from "./dist-handler.js";
import type { WebextDistDeps } from "./dist-handler.js";

const DIST_SUFFIX = path.join(".pi", "web", "dist");

export interface DiskWebextLocatorOptions {
  /** 已装包根(`<agentDir>/npm/node_modules/<name>`);缺省读 `PI_WEB_AGENT_DIR` / `PI_AGENT_DIR` / `~/.pi/agent`。 */
  readonly agentDir?: string;
  /** 相对路径源的解析基准;缺省 `process.cwd()`。 */
  readonly cwd?: string;
  /** 额外的源仓根(按 `<root>/<source>` 再拼 dist 后缀);云宿主本地开发用。 */
  readonly extraRoots?: readonly string[];
  /** dist 目录 → baseUrl 的路径前缀;缺省 `/api/webext/dist/`。 */
  readonly baseUrlPrefix?: string;
}

export interface DiskWebextLocator extends WebextDistDeps {
  locateDist(source: string): Promise<string | undefined>;
  readManifestJson(distDir: string): Promise<unknown | undefined>;
  toBaseUrl(distDir: string): string;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export function createDiskWebextLocator(
  opts: DiskWebextLocatorOptions = {},
): DiskWebextLocator {
  const cwd = opts.cwd ?? process.cwd();
  const agentDir =
    opts.agentDir ??
    process.env.PI_WEB_AGENT_DIR ??
    process.env.PI_AGENT_DIR ??
    path.join(os.homedir(), ".pi", "agent");
  const prefix = opts.baseUrlPrefix ?? "/api/webext/dist/";

  function candidates(source: string): string[] {
    const out: string[] = [path.join(path.resolve(cwd, source), DIST_SUFFIX)];
    // 已装 npm 包(裸名,不含路径分隔/协议)
    if (!source.includes("/") && !source.includes(":") && source !== ".") {
      out.push(path.join(agentDir, "npm", "node_modules", source, DIST_SUFFIX));
    }
    for (const root of opts.extraRoots ?? []) {
      out.push(path.join(path.resolve(root, source), DIST_SUFFIX));
    }
    return out;
  }

  return {
    async locateDist(source: string): Promise<string | undefined> {
      for (const c of candidates(source)) {
        if (c.endsWith(DIST_SUFFIX) && (await isDir(c))) return path.resolve(c);
      }
      return undefined;
    },

    async readManifestJson(distDir: string): Promise<unknown | undefined> {
      try {
        return JSON.parse(await fs.readFile(path.join(distDir, "manifest.json"), "utf8")) as unknown;
      } catch {
        return undefined;
      }
    },

    toBaseUrl(distDir: string): string {
      return `${prefix}${Buffer.from(path.resolve(distDir), "utf8").toString("base64url")}/`;
    },

    decodeDistDir(encoded: string): string {
      return Buffer.from(encoded, "base64url").toString("utf8");
    },

    async readDistFile(
      distDir: string,
      relFile: string,
    ): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
      const resolvedDist = path.resolve(distDir);
      if (!resolvedDist.endsWith(DIST_SUFFIX)) return undefined;
      if (!(await isDir(resolvedDist))) return undefined;

      const target = path.resolve(resolvedDist, relFile);
      // 前缀校验:目标必须在 dist 目录内(防 `..`)
      if (target !== resolvedDist && !target.startsWith(resolvedDist + path.sep)) {
        return undefined;
      }
      try {
        return { bytes: await fs.readFile(target), contentType: webextContentTypeFor(target) };
      } catch {
        return undefined;
      }
    },
  };
}
