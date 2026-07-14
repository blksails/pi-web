/**
 * unified-diff — 行级 LCS diff,unified 格式输出(spec cli-component-add,任务 2.5,
 * Req 5.4, 7.3)。
 *
 * 仅供终端呈现「本地修改 vs 来源新内容」,不追求 git 兼容(无 hunk 合并/上下文折叠的
 * 完整实现——固定 3 行上下文,单 hunk 邻接合并)。仓内无 diff 依赖,自带极简实现
 * (research §1.4)。输入超过 `MAX_LINES` 时退化为整文件替换提示(组件源码都是小文件,
 * 此上限只是 O(n²) LCS 的护栏)。
 */

const CONTEXT = 3;
const MAX_LINES = 5000;

type Op = { readonly tag: "eq" | "del" | "add"; readonly line: string };

/** 经典 O(n·m) LCS 表回溯出操作序列(小文件足够)。 */
function diffOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] as number[];
    const next = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: "eq", line: a[i] as string });
      i += 1;
      j += 1;
    } else if (((dp[i + 1] as number[])[j] as number) >= ((dp[i] as number[])[j + 1] as number)) {
      ops.push({ tag: "del", line: a[i] as string });
      i += 1;
    } else {
      ops.push({ tag: "add", line: b[j] as string });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ tag: "del", line: a[i] as string });
    i += 1;
  }
  while (j < m) {
    ops.push({ tag: "add", line: b[j] as string });
    j += 1;
  }
  return ops;
}

/**
 * 产出 unified 格式 diff(`--- a/<rel>` / `+++ b/<rel>` 头 + `@@` hunk)。
 * 无差异返回空串。`oldText` 视角 = 本地落盘,`newText` 视角 = 来源新内容。
 */
export function unifiedDiff(rel: string, oldText: string, newText: string): string {
  if (oldText === newText) return "";
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const header = `--- a/${rel}\n+++ b/${rel}\n`;
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return `${header}@@ 文件过大,略去逐行 diff(本地 ${a.length} 行 → 来源 ${b.length} 行,整文件已变更)@@\n`;
  }
  const ops = diffOps(a, b);

  // 收集变更点索引,按 CONTEXT 邻接合并成 hunk。
  const changed = ops
    .map((op, idx) => (op.tag === "eq" ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changed.length === 0) return "";

  type Hunk = { start: number; end: number };
  const hunks: Hunk[] = [];
  for (const idx of changed) {
    const last = hunks[hunks.length - 1];
    if (last !== undefined && idx - last.end <= CONTEXT * 2) last.end = idx;
    else hunks.push({ start: idx, end: idx });
  }

  let out = header;
  // 行号游标:遍历 ops 前缀累计 old/new 行号。
  const oldLineAt: number[] = [];
  const newLineAt: number[] = [];
  let ol = 1;
  let nl = 1;
  for (const op of ops) {
    oldLineAt.push(ol);
    newLineAt.push(nl);
    if (op.tag !== "add") ol += 1;
    if (op.tag !== "del") nl += 1;
  }

  for (const hunk of hunks) {
    const from = Math.max(0, hunk.start - CONTEXT);
    const to = Math.min(ops.length - 1, hunk.end + CONTEXT);
    let oldCount = 0;
    let newCount = 0;
    let body = "";
    for (let k = from; k <= to; k += 1) {
      const op = ops[k] as Op;
      if (op.tag === "eq") {
        body += ` ${op.line}\n`;
        oldCount += 1;
        newCount += 1;
      } else if (op.tag === "del") {
        body += `-${op.line}\n`;
        oldCount += 1;
      } else {
        body += `+${op.line}\n`;
        newCount += 1;
      }
    }
    out += `@@ -${oldLineAt[from]},${oldCount} +${newLineAt[from]},${newCount} @@\n${body}`;
  }
  return out;
}
