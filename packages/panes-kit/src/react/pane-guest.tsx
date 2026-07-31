import * as React from "react";
import { connectPaneGuest, type PaneGuestConnection } from "../guest.js";
import type { PaneTheme } from "../contract.js";

const PaneGuestContext = React.createContext<PaneGuestConnection | undefined>(undefined);

/** Pane 通用首屏骨架；Guest 握手完成前遮住空白载体。 */
export function PaneLoadingSkeleton({
  label = "正在连接 Pane…",
}: {
  readonly label?: string;
}): React.JSX.Element {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={label}
      data-pane-loading-skeleton
      style={{
        height: "100%",
        minHeight: 160,
        display: "grid",
        alignContent: "start",
        gap: 10,
        padding: 14,
        color: "hsl(var(--muted-foreground, 215 16% 47%))",
        background: "hsl(var(--background, 0 0% 100%))",
      }}
    >
      <style>{`
        @keyframes pane-loading-shimmer {
          from { background-position: 100% 50%; }
          to { background-position: 0 50%; }
        }
        [data-pane-loading-skeleton] [data-pane-loading-line] {
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(90deg,
            hsl(var(--muted, 210 40% 96%)) 25%,
            hsl(var(--border, 214 32% 91%)) 38%,
            hsl(var(--muted, 210 40% 96%)) 62%);
          background-size: 400% 100%;
          animation: pane-loading-shimmer 1.3s ease infinite;
        }
      `}</style>
      <span style={{ fontSize: 12 }}>{label}</span>
      <span data-pane-loading-line style={{ width: "44%" }} />
      <span data-pane-loading-line style={{ width: "72%" }} />
      <span data-pane-loading-line style={{ width: "58%" }} />
    </main>
  );
}

function applyPaneTheme(theme: PaneTheme | undefined): void {
  if (theme === undefined || typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (name.startsWith("--")) root.style.setProperty(name, value);
  }
  if (theme.colorScheme !== undefined) root.style.colorScheme = theme.colorScheme;
}

export function usePaneGuest(): PaneGuestConnection {
  const connection = React.useContext(PaneGuestContext);
  if (connection === undefined) throw new Error("Pane guest is not connected");
  return connection;
}

export function PaneGuestProvider({
  paneId,
  children,
  fallback = <PaneLoadingSkeleton />,
}: {
  readonly paneId: string;
  readonly children: React.ReactNode;
  readonly fallback?: React.ReactNode;
}): React.JSX.Element {
  const [connection, setConnection] = React.useState<PaneGuestConnection>();
  const [error, setError] = React.useState<Error>();
  React.useEffect(() => {
    let mounted = true;
    let active: PaneGuestConnection | undefined;
    const controller = new AbortController();
    void connectPaneGuest({ expectedPaneId: paneId, signal: controller.signal }).then(
      (next) => {
        if (!mounted) next.close();
        else {
          active = next;
          setConnection(next);
        }
      },
      (reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      mounted = false;
      controller.abort();
      active?.close();
    };
  }, [paneId]);

  React.useEffect(() => {
    if (connection === undefined) return;
    applyPaneTheme(connection.theme);
    return connection.onTheme(applyPaneTheme);
  }, [connection]);

  if (error !== undefined) return <main role="alert">{error.message}</main>;
  if (connection === undefined) return <>{fallback}</>;
  return <PaneGuestContext.Provider value={connection}>{children}</PaneGuestContext.Provider>;
}

export function withPaneGuest(
  paneId: string,
  Component: React.ComponentType,
): React.ComponentType {
  function ConnectedPane(): React.JSX.Element {
    return <PaneGuestProvider paneId={paneId}><Component /></PaneGuestProvider>;
  }
  ConnectedPane.displayName = `withPaneGuest(${Component.displayName ?? Component.name ?? paneId})`;
  return ConnectedPane;
}
