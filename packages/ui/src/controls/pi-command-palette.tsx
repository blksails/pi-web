/**
 * PiCommandPalette — "/" 斜杠命令补全。
 *
 * `value` 以 "/" 开头时进入命令模式:经 `controls.getCommands` 拉取候选,按输入过滤;
 * 方向键导航 / 回车确认 / Esc 关闭;选择把命令填充回输入区(经 onChange)。
 * aria 标注当前活动项(listbox/option + aria-activedescendant)。
 * 命令为空或获取失败 → 显示空态/错误态,不崩溃。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import type { RpcSlashCommand } from "@pi-web/protocol";
import { cn } from "../lib/cn.js";

export interface PiCommandPaletteProps {
  readonly controls: UsePiControlsResult;
  /** 当前输入值;以 "/" 开头时激活命令模式。 */
  readonly value: string;
  /** 把选中命令填充回输入区。 */
  readonly onChange: (next: string) => void;
  /** 可选:回车确认时提交(默认仅填充)。 */
  readonly onSubmit?: (command: RpcSlashCommand) => void;
  readonly className?: string;
}

function isCommandMode(value: string): boolean {
  return value.startsWith("/");
}

function queryOf(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

export function PiCommandPalette({
  controls,
  value,
  onChange,
  onSubmit,
  className,
}: PiCommandPaletteProps): React.JSX.Element | null {
  const open = isCommandMode(value);
  const [commands, setCommands] = React.useState<readonly RpcSlashCommand[]>(
    controls.commands ?? [],
  );
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [active, setActive] = React.useState<number>(0);
  const listId = React.useId();

  // 进入命令模式时拉取命令(若 hook 未已暴露)。
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (controls.commands !== undefined) {
      setCommands(controls.commands);
      setError(undefined);
      return;
    }
    void controls
      .getCommands()
      .then((res) => {
        if (cancelled) return;
        setCommands(res.commands);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, controls]);

  const query = queryOf(value).toLowerCase();
  const filtered = React.useMemo(
    () =>
      commands.filter((c) => c.name.toLowerCase().includes(query)),
    [commands, query],
  );

  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  const select = React.useCallback(
    (cmd: RpcSlashCommand): void => {
      onChange(`/${cmd.name} `);
      if (onSubmit !== undefined) onSubmit(cmd);
    },
    [onChange, onSubmit],
  );

  const handleKey = React.useCallback(
    (e: Pick<KeyboardEvent, "key" | "preventDefault">): boolean => {
      if (filtered.length === 0) {
        if (e.key === "Escape") {
          onChange("");
          return true;
        }
        return false;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % filtered.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % filtered.length);
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd !== undefined) select(cmd);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
        return true;
      }
      return false;
    },
    [filtered, active, onChange, select],
  );

  // 命令模式下,即便焦点在外部输入框(prompt input),也捕获方向键/回车/Esc 导航。
  React.useEffect(() => {
    if (!open) return;
    const listener = (e: KeyboardEvent): void => {
      handleKey(e);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [open, handleKey]);

  if (!open) return null;

  const activeId = `${listId}-opt-${active}`;

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md",
        className,
      )}
      data-pi-command-palette
    >
      {error !== undefined ? (
        <div
          role="alert"
          className="p-3 text-sm text-[hsl(var(--destructive))]"
          data-pi-command-error
        >
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="p-3 text-sm text-[hsl(var(--muted-foreground))]"
          data-pi-command-empty
        >
          No commands
        </div>
      ) : (
        <ul
          role="listbox"
          id={listId}
          aria-label="Slash commands"
          aria-activedescendant={activeId}
          tabIndex={-1}
          className="max-h-64 overflow-y-auto p-1"
        >
          {filtered.map((cmd, i) => (
            <li
              key={cmd.name}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(cmd)}
              className={cn(
                "flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm",
                i === active
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                  : "",
              )}
              data-pi-command-item={cmd.name}
            >
              <span className="font-medium">/{cmd.name}</span>
              {cmd.description !== undefined ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {cmd.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
