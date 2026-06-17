/**
 * JsonlLineReader — 协议正确的增量 JSONL 成帧器(Req 3.1–3.6, 1.2, 4.6, 7.1)。
 *
 * 严格遵循 pi 的 JSONL 语义:
 *  - 仅以换行符 `\n` 作为行边界切分,禁用 Node `readline`(Req 3.1)。
 *  - 切分后剥离尾随 `\r`(CRLF → 行内容,Req 3.2)。
 *  - 维护内部残留缓冲,跨 chunk 拼接被拆分的行(Req 3.3)。
 *  - 单 chunk 多行按出现顺序逐行输出(Req 3.6)。
 *  - 不把 `U+2028` / `U+2029` 当行边界,保留在行内(Req 3.4)。
 *  - 跳过空行(切分后内容为空)而不输出、不报错(Req 3.5)。
 *
 * 纯字符串处理、无 I/O、无副作用,便于大量正反例单测。约定输入 chunk 为已解码
 * UTF-8 字符串(子进程 stdout 设 `setEncoding('utf8')`),本 reader 不处理字节级拼接。
 */
export class JsonlLineReader {
  /** 尚未遇到 `\n` 的残留尾段(跨 chunk 缓冲,Req 3.3)。 */
  private buffer = "";

  /**
   * 喂入一个 stdout 文本 chunk,返回本次新成形的完整行(已剥 `\r`、已跳空行)。
   *
   * 仅以 `\n` 切分;`U+2028`/`U+2029` 等绝不作为分隔符(Req 3.1/3.4)。
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      // 取出 [start, newlineIndex) 一行(不含 `\n`)。
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const line = JsonlLineReader.stripTrailingCr(rawLine);
      // 跳过空行(仅 `\n` 或仅 `\r\n`)而不分发(Req 3.5)。
      if (line.length > 0) {
        lines.push(line);
      }

      newlineIndex = this.buffer.indexOf("\n");
    }

    return lines;
  }

  /**
   * 流结束时取出残留缓冲中未尾随 `\n` 的内容(供 exit 处理)。
   * 同样剥离尾随 `\r` 并跳过空内容;调用后内部缓冲清空。
   */
  flush(): string[] {
    if (this.buffer.length === 0) {
      return [];
    }
    const line = JsonlLineReader.stripTrailingCr(this.buffer);
    this.buffer = "";
    return line.length > 0 ? [line] : [];
  }

  /** 剥离单个尾随 `\r`(CRLF → LF 后的行内容,Req 3.2)。 */
  private static stripTrailingCr(line: string): string {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}
