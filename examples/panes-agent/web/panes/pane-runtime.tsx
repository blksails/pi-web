import * as React from "react";
import { createRoot } from "react-dom/client";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";
import type { PaneId, PaneInteractionMode, PanesSnapshot } from "../pane-types.js";

export interface PaneApi {
  readonly paneId: PaneId;
  readonly interactionMode: PaneInteractionMode;
  query<T>(payload?: Record<string, unknown>): Promise<T>;
  mutate<T>(operation: string, payload: Record<string, unknown>, expectedRevision?: number): Promise<T>;
  attach(file: File): Promise<{ attachmentId: string; displayUrl: string }>;
  subscribe(listener: (snapshot: PanesSnapshot) => void): () => void;
}

const PaneContext = React.createContext<PaneApi | undefined>(undefined);

export function usePaneApi(): PaneApi {
  const api = React.useContext(PaneContext);
  if (api === undefined) throw new Error("Pane bridge is not connected");
  return api;
}

export function usePaneSnapshot(): PanesSnapshot | undefined {
  const api = usePaneApi();
  const [snapshot, setSnapshot] = React.useState<PanesSnapshot>();
  React.useEffect(() => api.subscribe(setSnapshot), [api]);
  return snapshot;
}

function unwrapRoute<T>(value: unknown): T {
  if (typeof value === "object" && value !== null && "data" in value) return (value as { data: T }).data;
  return value as T;
}

function ConnectedPane({ paneId, App }: { readonly paneId: PaneId; readonly App: React.ComponentType }): React.JSX.Element {
  const guest = usePaneGuest();
  const api = React.useMemo<PaneApi>(() => ({
    paneId,
    interactionMode: guest.interactionMode as PaneInteractionMode,
    query: async <T,>(payload: Record<string, unknown> = {}) => unwrapRoute<T>(await guest.query("pane-data", {
      pane: paneId,
      ...(typeof payload["path"] === "string" ? { path: payload["path"] } : {}),
    })),
    mutate: async <T,>(operation: string, payload: Record<string, unknown>, expectedRevision?: number) => unwrapRoute<T>(await guest.mutate("pane-data", {
      paneId,
      operation,
      payload,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    })),
    attach: (file: File) => guest.upload(file),
    subscribe: (listener) => guest.surface.subscribe("surface:panes", (value) => listener(value as PanesSnapshot)),
  }), [guest, paneId]);
  return <PaneContext.Provider value={api}><App /></PaneContext.Provider>;
}

function PaneRoot({ paneId, App }: { readonly paneId: PaneId; readonly App: React.ComponentType }): React.JSX.Element {
  return <PaneGuestProvider paneId={paneId} fallback={<main className="center muted" aria-live="polite">正在连接会话…</main>}>
    <ConnectedPane paneId={paneId} App={App} />
  </PaneGuestProvider>;
}

export function mountPane(paneId: PaneId, App: React.ComponentType): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Pane root missing");
  createRoot(root).render(<React.StrictMode><PaneRoot paneId={paneId} App={App} /></React.StrictMode>);
}
