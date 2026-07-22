import * as React from "react";
import { connectPaneGuest, type PaneGuestConnection } from "../guest.js";

const PaneGuestContext = React.createContext<PaneGuestConnection | undefined>(undefined);

export function usePaneGuest(): PaneGuestConnection {
  const connection = React.useContext(PaneGuestContext);
  if (connection === undefined) throw new Error("Pane guest is not connected");
  return connection;
}

export function PaneGuestProvider({
  paneId,
  children,
  fallback = <main aria-live="polite">正在连接 Pane 宿主…</main>,
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
    void connectPaneGuest({ expectedPaneId: paneId }).then(
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
      active?.close();
    };
  }, [paneId]);

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
