/**
 * 输入历史态机(IDE 终端式,会话内内存态;PromptInput onHistoryNav 的装配层实现)。
 *
 * 语义:↑ 仅在空输入(或已在翻阅态)时接管,自最新条目向旧翻;↓ 向新翻,翻到底
 * 回到进入翻阅前的草稿并退出翻阅态;手动编辑(resetBrowse)即退出。连续重复不重记。
 */
export interface InputHistory {
  /** 记入一条已发文本(空串与连续重复忽略),并退出翻阅态。 */
  push(text: string): void;
  /**
   * 翻阅请求:返回应回填的文本;返回 null 表示不接管(历史为空,或编辑中按 ↑,
   * 或未在翻阅态按 ↓)——调用方保持默认光标行为。
   */
  nav(dir: "prev" | "next", currentInput: string): string | null;
  /** 手动编辑时调用:退出翻阅态(不清历史)。 */
  resetBrowse(): void;
}

export function createInputHistory(): InputHistory {
  const entries: string[] = [];
  let idx: number | null = null; // null = 不在翻阅态
  let draft = "";

  return {
    push(text: string): void {
      if (text !== "" && entries[entries.length - 1] !== text) {
        entries.push(text);
      }
      idx = null;
    },
    nav(dir: "prev" | "next", currentInput: string): string | null {
      if (entries.length === 0) return null;
      const browsing = idx !== null;
      if (dir === "prev") {
        if (!browsing) {
          if (currentInput !== "") return null; // 编辑中不劫持
          draft = currentInput;
          idx = entries.length - 1;
        } else {
          idx = Math.max(0, (idx as number) - 1);
        }
        return entries[idx]!;
      }
      if (!browsing) return null;
      const next = (idx as number) + 1;
      if (next >= entries.length) {
        idx = null;
        return draft; // 翻到底:回草稿(通常为空)
      }
      idx = next;
      return entries[next]!;
    },
    resetBrowse(): void {
      idx = null;
    },
  };
}
