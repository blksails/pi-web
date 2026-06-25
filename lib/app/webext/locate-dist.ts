/**
 * locate-dist — 已装/本地源的 `.pi/web/dist` 定位与安全读取(webext-package-install 任务 2.3)。
 *
 * 定位优先级:
 *   1. 本地源路径(相对 cwd 或绝对):`<source>/.pi/web/dist`
 *   2. 已装 npm 包(按名):`<agentDir>/npm/node_modules/<source>/.pi/web/dist`
 *
 * 安全:dist 目录必须以 `.pi/web/dist` 结尾且存在;读取文件经 realpath 前缀校验,
 * 杜绝目录穿越(arbitrary file read)。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";

const DIST_SUFFIX = path.join(".pi", "web", "dist");

function agentDir(): string {
  return (
    process.env.PI_WEB_AGENT_DIR ??
    process.env.PI_AGENT_DIR ??
    path.join(os.homedir(), ".pi", "agent")
  );
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** 候选 dist 目录(本地源 + 已装 npm 名)。 */
function candidates(source: string): string[] {
  const out: string[] = [];
  // 本地路径(相对 cwd 或绝对)
  const local = path.resolve(process.cwd(), source);
  out.push(path.join(local, DIST_SUFFIX));
  // 已装 npm 包(裸名,不含路径分隔/协议)
  if (!source.includes("/") && !source.includes(":") && source !== ".") {
    out.push(path.join(agentDir(), "npm", "node_modules", source, DIST_SUFFIX));
  }
  return out;
}

/** 定位已装/本地源的 dist 目录;无则 undefined。 */
export async function locateDist(source: string): Promise<string | undefined> {
  for (const c of candidates(source)) {
    if (c.endsWith(DIST_SUFFIX) && (await isDir(c))) {
      return path.resolve(c);
    }
  }
  return undefined;
}

/** 读取 dist 下 manifest.json 原始 JSON;不存在/非法返回 undefined。 */
export async function readManifestJson(
  distDir: string,
): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(path.join(distDir, "manifest.json"), "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** dist 目录 → 浏览器可 fetch 的 baseUrl(末尾含 /)。distDir 经 base64url 编码进路径。 */
export function toBaseUrl(distDir: string): string {
  const enc = Buffer.from(path.resolve(distDir), "utf8").toString("base64url");
  return `/api/webext/dist/${enc}/`;
}

/** 由 baseUrl 段解码回 dist 目录。 */
export function decodeDistDir(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

/**
 * 安全读取 dist 内文件:校验 dist 目录以 `.pi/web/dist` 结尾且存在,目标文件 realpath
 * 落在 dist 内。返回字节 + content-type;越权/不存在返回 undefined。
 */
export async function readDistFile(
  distDir: string,
  relFile: string,
): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const resolvedDist = path.resolve(distDir);
  if (!resolvedDist.endsWith(DIST_SUFFIX)) return undefined;
  if (!(await isDir(resolvedDist))) return undefined;

  const target = path.resolve(resolvedDist, relFile);
  // 前缀校验:目标必须在 dist 目录内(防 ..)
  if (target !== resolvedDist && !target.startsWith(resolvedDist + path.sep)) {
    return undefined;
  }
  try {
    const bytes = await fs.readFile(target);
    return { bytes, contentType: contentTypeFor(target) };
  } catch {
    return undefined;
  }
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
