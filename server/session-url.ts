/**
 * 会话 URL 解析(spec vite-spa-migration,Req 1.3/1.4)。
 *
 * 独立成模块:`server/index.ts` 在顶层调用 `serve()`,被测试 import 会真的起服务。
 */

/**
 * 从恰好 `/api/sessions/:id`(整会话删除)提取 `:id`。
 *
 * 子资源删除(多余路径段,如 `/api/sessions/:id/attachments/:aid`)返回 undefined ——
 * 那类请求不应触发 `sessionId → source` 映射清理(Req 1.4)。
 */
export function wholeSessionIdFromUrl(url: string): string | undefined {
  const raw = new URL(url).pathname.match(/\/api\/sessions\/([^/]+)\/?$/)?.[1];
  return raw !== undefined ? decodeURIComponent(raw) : undefined;
}

/** 从任意会话子资源 URL 取 id；供冷恢复重放使用，删除语义仍只用整会话版本。 */
export function sessionIdFromUrl(url: string): string | undefined {
  const raw = new URL(url).pathname.match(/\/api\/sessions\/([^/]+)(?:\/|$)/)?.[1];
  return raw !== undefined ? decodeURIComponent(raw) : undefined;
}
