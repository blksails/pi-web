"use client";
/**
 * PluginPanel — `/plugin` 管理面板(builtin-plugin-command 任务 3.3)。
 *
 * 列出已安装 plugin(及作用域)、支持以来源安装与卸载;装/卸后触发会话重载使其生效。
 * 经既有 /extensions 与 /sessions/:id/reload 端点(client transport)。失败呈现原因。
 */
import * as React from "react";
import type { PiClient, InstalledExtensionInfo } from "@blksails/pi-web-react";

export interface PluginPanelProps {
  readonly client: PiClient;
  readonly sessionId: string | undefined;
  readonly onClose: () => void;
  /** 装/卸成功后回调(宿主据此触发 webext 加载路径,与 runner 重载构成双路生效)。 */
  readonly onAfterChange?: () => void;
  /** 外部刷新信号:变化即重取已装列表(如键入 /plugin install 由宿主分派安装后)。 */
  readonly refreshKey?: number;
}

export function PluginPanel({
  client,
  sessionId,
  onClose,
  onAfterChange,
  refreshKey,
}: PluginPanelProps): React.JSX.Element {
  const [items, setItems] = React.useState<readonly InstalledExtensionInfo[]>([]);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const [source, setSource] = React.useState("");

  const refresh = React.useCallback((): void => {
    void client
      .listExtensions()
      .then((r) => {
        setItems(r.extensions);
        setError(undefined);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  React.useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const reloadIfPossible = React.useCallback(async (): Promise<void> => {
    if (sessionId !== undefined) {
      await client.reloadSession(sessionId).catch(() => undefined);
    }
  }, [client, sessionId]);

  const install = React.useCallback(async (): Promise<void> => {
    if (source.trim().length === 0) return;
    setBusy(true);
    try {
      await client.installExtension(source.trim());
      await reloadIfPossible();
      onAfterChange?.();
      setSource("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [client, source, reloadIfPossible, refresh, onAfterChange]);

  const remove = React.useCallback(
    async (extId: string): Promise<void> => {
      setBusy(true);
      try {
        await client.removeExtension(extId);
        await reloadIfPossible();
        onAfterChange?.();
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [client, reloadIfPossible, refresh, onAfterChange],
  );

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
            onClick={() => void install()}
            disabled={busy}
            className="rounded-sm bg-[hsl(var(--primary))] px-3 py-1 text-sm text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            安装
          </button>
        </div>

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
                  onClick={() => void remove(x.id)}
                  disabled={busy}
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
