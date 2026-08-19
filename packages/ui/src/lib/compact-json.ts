/**
 * 工具卡展示用 JSON 限长。
 *
 * 工具结果可能包含工程快照、日志或长路径；展示层不可让一次 stringify
 * 把整页 DOM 与主线程拖住。保留前缀便于诊断，完整数据仍留在工具/会话侧。
 */
export const MAX_RENDERED_JSON_CHARS = 16_000;

export function compactJson(value: unknown): string {
  if (value === undefined) return "";
  const source =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2) ?? "";
          } catch {
            return String(value);
          }
        })();
  if (source.length <= MAX_RENDERED_JSON_CHARS) return source;
  const omitted = source.length - MAX_RENDERED_JSON_CHARS;
  return `${source.slice(0, MAX_RENDERED_JSON_CHARS)}\n… [展示已截断，省略 ${omitted} 字符]`;
}
