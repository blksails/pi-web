/**
 * BashResultRenderer — bang shell 命令结果卡片(spec bang-shell-command,Req 4.x)。
 *
 * 渲染 `data-bash-result` data part:命令 + 输出 + 退出状态。
 *  - 输出用**同步** `<pre>`(不经 streamdown/Response;jsdom 下异步高亮会致 e2e 抓不到,Req 4.6)。
 *  - 退出码非零 → 标红并显示退出码(Req 4.3)。
 *  - 输出截断 → 提示(Req 4.4)。
 *  - 取消 → 标示未正常完成(Req 7.3)。
 *  - `!!`(不进上下文)→ no-context 徽标(Req 4.5)。
 */
import { cn } from "../lib/cn.js";
import type { DataPartRenderer } from "../registry/renderer-registry.js";

/** `data-bash-result` part 的 data 形状(BashResult + 前端补充 command/excludeFromContext)。 */
export interface BashResultPartData {
  readonly command: string;
  readonly output: string;
  readonly exitCode?: number;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
  readonly excludeFromContext: boolean;
}

export const BashResultRenderer: DataPartRenderer = ({ part }) => {
  const data = ("data" in part ? part.data : undefined) as
    | BashResultPartData
    | undefined;
  if (data === undefined) return null;
  const failed = data.exitCode !== undefined && data.exitCode !== 0;
  return (
    <div
      data-pi-bash-result=""
      className={cn(
        "my-1 overflow-hidden rounded-[var(--radius)] border text-sm",
        failed || data.cancelled
          ? "border-[hsl(var(--destructive))]"
          : "border-[hsl(var(--border))]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 font-mono">
        <span className="text-[hsl(var(--muted-foreground))]">$</span>
        <span className="min-w-0 flex-1 break-all" data-pi-bash-command>
          {data.command}
        </span>
        {data.excludeFromContext ? (
          <span
            className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 text-xs text-[hsl(var(--secondary-foreground))]"
            data-pi-bash-no-context
          >
            no context
          </span>
        ) : null}
      </div>
      <pre
        className="pi-scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs"
        data-pi-bash-output
      >
        {data.output}
      </pre>
      <div className="flex items-center gap-3 border-t border-[hsl(var(--border))] px-2 py-1 text-xs">
        {data.cancelled ? (
          <span
            className="text-[hsl(var(--destructive))]"
            data-pi-bash-cancelled
          >
            已取消(未正常完成)
          </span>
        ) : (
          <span
            className={cn(
              failed
                ? "text-[hsl(var(--destructive))]"
                : "text-[hsl(var(--muted-foreground))]",
            )}
            data-pi-bash-exit
          >
            exit {data.exitCode ?? 0}
          </span>
        )}
        {data.truncated ? (
          <span
            className="text-[hsl(var(--muted-foreground))]"
            data-pi-bash-truncated
          >
            输出已截断
          </span>
        ) : null}
      </div>
    </div>
  );
};
