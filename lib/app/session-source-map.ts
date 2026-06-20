/**
 * session-source-map — app 级 sessionId → agent source 持久映射。
 *
 * 会话创建时由客户端经 `POST /api/session-source` 记录;冷加载 `/session/:id` 时
 * 服务端按 id 取回真实 source,用于重解析其 `.pi/web` UI 扩展(否则 resume 模式
 * `create.source` 退化为 "." → 扩展区域插槽/背景全部消失)。
 *
 * 设计取舍:URL 保持纯净 `/session/:id`(不把文件路径塞进 query),且不改
 * `@pi-web/server` 的持久化 schema —— 故用本地旁路映射。每会话一个文件
 * (`<dir>/<id>`,内容即 source 字符串),天然规避并发读改写竞态,删除也简单。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 映射根目录:`PI_WEB_SESSION_SOURCE_DIR` 覆盖,默认 `~/.pi/agent/piweb-session-sources`。 */
function rootDir(): string {
  return (
    process.env.PI_WEB_SESSION_SOURCE_DIR ??
    path.join(os.homedir(), ".pi", "agent", "piweb-session-sources")
  );
}

/**
 * 安全 id 白名单:仅允许 uuid / 短标识字符,拒绝路径分隔符与 `.`,杜绝把写入/读取
 * 越权到映射目录之外(目录穿越)。
 */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/** 记录 `sessionId → source`(创建期由客户端触发;best-effort)。 */
export async function recordSessionSource(
  id: string,
  source: string,
): Promise<void> {
  if (!isSafeId(id)) return;
  const dir = rootDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, id), source, "utf8");
}

/** 取回某 `sessionId` 的 source;无记录 / 读失败 / 非法 id 一律返回 undefined。 */
export async function lookupSessionSource(
  id: string,
): Promise<string | undefined> {
  if (!isSafeId(id)) return undefined;
  try {
    const s = await fs.readFile(path.join(rootDir(), id), "utf8");
    return s.length > 0 ? s : undefined;
  } catch {
    return undefined;
  }
}

/** 删除某 `sessionId` 的映射(会话删除时清理;不存在视作成功)。 */
export async function forgetSessionSource(id: string): Promise<void> {
  if (!isSafeId(id)) return;
  try {
    await fs.rm(path.join(rootDir(), id), { force: true });
  } catch {
    // best-effort:清理失败仅留下一个无害的小文件。
  }
}
