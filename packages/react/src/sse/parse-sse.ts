/**
 * SSE 帧解析器(纯函数)。
 *
 * 把文本缓冲切成 SSE 事件块(以空行分隔),逐块解析 `data:` / `id:` / `event:` 字段,
 * 合并多行 `data:`,剥行尾 `\r`,半帧(尾部未以空行收束)经 `rest` 留存供下次拼接。
 * 心跳注释行(以 `:` 开头)被忽略。
 *
 * 产出 ParsedSseEvent[](原始字段),不做协议 schema 校验(那归 connection 层)。
 * 无 I/O、无副作用,可直接单测。
 */

/** 单个解析出的 SSE 事件(原始字段,未经协议 schema 校验)。 */
export interface ParsedSseEvent {
  /** 合并后的 data(多行 data: 以 \n 连接);可能为空字符串。 */
  readonly data: string;
  /** id: 行的值;无则 undefined。 */
  readonly id: string | undefined;
  /** event: 行的值;无则 undefined。 */
  readonly event: string | undefined;
}

export interface ParseSseResult {
  readonly frames: ParsedSseEvent[];
  /** 未收束的尾部半帧文本,需与下一次输入拼接后再解析。 */
  readonly rest: string;
}

/** 解析单个事件块(已去除分隔空行)。返回 null 表示该块无有效字段(纯注释/空)。 */
function parseEventBlock(block: string): ParsedSseEvent | null {
  const dataLines: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let hasField = false;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;
    if (line.startsWith(":")) continue; // 注释/心跳

    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      // SSE 约定:冒号后单个前导空格被去除。
      if (value.startsWith(" ")) value = value.slice(1);
    }

    switch (field) {
      case "data":
        dataLines.push(value);
        hasField = true;
        break;
      case "id":
        id = value;
        hasField = true;
        break;
      case "event":
        event = value;
        hasField = true;
        break;
      default:
        break; // 未知字段忽略(SSE 规范)
    }
  }

  if (!hasField) return null;
  return { data: dataLines.join("\n"), id, event };
}

/**
 * 解析 SSE 文本缓冲。
 *
 * 先归一 `\r\n` / `\r` 为 `\n`,再以空行(`\n\n`)切分事件块。最后一段后若无空行收束,
 * 整段作为 `rest` 返回供下次拼接(半帧跨 chunk)。
 */
export function parseSse(buffer: string): ParseSseResult {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames: ParsedSseEvent[] = [];

  // 找到所有事件边界:连续空行(\n\n+)。我们逐字符扫描,以 "\n\n" 作为最小边界。
  let cursor = 0;
  let consumed = 0;
  while (cursor < normalized.length) {
    const boundary = normalized.indexOf("\n\n", cursor);
    if (boundary === -1) break;
    const block = normalized.slice(consumed, boundary);
    const ev = parseEventBlock(block);
    if (ev !== null) frames.push(ev);
    // 越过该边界的连续空行
    let next = boundary + 2;
    while (next < normalized.length && normalized[next] === "\n") next++;
    consumed = next;
    cursor = next;
  }

  const rest = normalized.slice(consumed);
  return { frames, rest };
}
