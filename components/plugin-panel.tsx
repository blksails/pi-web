"use client";
/**
 * PluginPanel — `/plugin` 管理面板(unified-command-result-layer 任务 6.2)。
 *
 * 纯展示型:列出已安装 plugin、提供安装/卸载入口。**不直调 REST、不持 client、无 refreshKey**;
 * 安装/卸载经 `onExecute(argv)` 走统一命令通道(host 命令在服务端执行),列表由命令结果
 * (CommandResult.data.extensions)经 `items` 注入,事件驱动刷新。失败原因经 `error` 呈现。
 */
import * as React from "react";
import type { InstalledExtensionInfo } from "@blksails/pi-web-react";

export interface PluginPanelProps {
  /** 已装列表(由命令结果事件驱动注入)。 */
  readonly items: readonly InstalledExtensionInfo[];
  /** 失败/通知文案(命令结果 effect:notify 或 ok:false)。 */
  readonly error?: string;
  /** 执行中(pending 态,禁用操作)。 */
  readonly busy?: boolean;
  /** 经统一命令通道执行 `/plugin` 子命令(argv 如 "install <源>" / "uninstall <名>" / "list")。 */
  readonly onExecute: (argv: string) => void;
  readonly onClose: () => void;
}

export function PluginPanel({
  items,
  error,
  busy,
  onExecute,
  onClose,
}: PluginPanelProps): React.JSX.Element {
  const [source, setSource] = React.useState("");

  const install = React.useCallback((): void => {
    const s = source.trim();
    if (s.length === 0) return;
    onExecute(`install ${s}`);
    setSource("");
  }, [source, onExecute]);

  return (
    <div
      data-testid="plugin-panel"
      role="dialog"
      aria-label="Plugin 管理"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-8"
      onClick={onClose}
    >
      <div
        className="mt-12 w-full max-w-lg rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Plugin 管理</h2>
          <button
            type="button"
            data-testid="plugin-panel-close"
            onClick={onClose}
            className="text-[hsl(var(--muted-foreground))]"
          >
            ✕
          </button>
        </header>

        <div className="mb-3 flex gap-2">
          <input
            data-testid="plugin-install-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="安装来源（npm / git / 本地路径）"
            className="flex-1 rounded-sm border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
          />
          <button
            type="button"
            data-testid="plugin-install-btn"
            onClick={install}
            disabled={busy === true}
            className="rounded-sm bg-[hsl(var(--primary))] px-3 py-1 text-sm text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            安装
          </button>
        </div>

        {busy === true ? (
          <p
            data-testid="plugin-busy"
            role="status"
            aria-live="polite"
            className="mb-2 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"
          >
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            执行中…
          </p>
        ) : null}

        {error !== undefined ? (
          <p data-testid="plugin-error" className="mb-2 text-xs text-[hsl(0_72%_51%)]">
            {error}
          </p>
        ) : null}

        <ul data-testid="plugin-list" className="flex flex-col gap-1">
          {items.length === 0 ? (
            <li data-testid="plugin-empty" className="text-xs text-[hsl(var(--muted-foreground))]">
              暂无已安装 plugin
            </li>
          ) : (
            items.map((x) => (
              <li
                key={`${x.id}@${x.scope}`}
                data-testid="plugin-item"
                className="flex items-center justify-between rounded-sm px-2 py-1 text-sm hover:bg-[hsl(var(--accent))]"
              >
                <span>
                  {x.id}
                  <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {x.scope}
                    {x.version !== undefined ? ` · ${x.version}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onExecute(`uninstall ${x.id}`)}
                  disabled={busy === true}
                  className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(0_72%_51%)] disabled:opacity-50"
                >
                  卸载
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
