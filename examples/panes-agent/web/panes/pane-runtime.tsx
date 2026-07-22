import * as React from "react";
import { createRoot } from "react-dom/client";
import type { PaneId, PaneInteractionMode, PanesSnapshot } from "../pane-types.js";

export interface PaneApi {
  readonly paneId: PaneId;
  readonly interactionMode: PaneInteractionMode;
  query<T>(payload?: Record<string, unknown>): Promise<T>;
  mutate<T>(operation: string, payload: Record<string, unknown>, expectedRevision?: number): Promise<T>;
  attach(file: File): Promise<{ attachmentId: string; displayUrl: string }>;
  subscribe(listener: (snapshot: PanesSnapshot) => void): () => void;
}

interface ResponseMessage {
  readonly type: "response";
  readonly id: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
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

function createApi(paneId: PaneId, interactionMode: PaneInteractionMode, port: MessagePort): PaneApi {
  let sequence = 0;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Set<(snapshot: PanesSnapshot) => void>();
  port.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (typeof data !== "object" || data === null) return;
    const message = data as Partial<ResponseMessage> & { snapshot?: PanesSnapshot };
    if (message.type === "response" && typeof message.id === "string") {
      const call = pending.get(message.id);
      if (call === undefined) return;
      pending.delete(message.id);
      if (message.ok) call.resolve(message.data);
      else call.reject(new Error(message.error ?? "Pane request failed"));
      return;
    }
    if ((data as { type?: unknown }).type === "snapshot" && message.snapshot !== undefined) {
      for (const listener of listeners) listener(message.snapshot);
    }
  };
  port.start();

  const request = <T,>(operation: "query" | "mutate" | "attach", payload?: unknown, transfer: Transferable[] = []): Promise<T> => {
    const id = `pane-${++sequence}`;
    port.postMessage({ type: "request", id, operation, payload }, transfer);
    return new Promise<T>((resolve, reject) => pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    }));
  };

  return {
    paneId,
    interactionMode,
    query: (payload = {}) => request("query", payload),
    mutate: (operation, payload, expectedRevision) => request("mutate", {
      operation,
      payload,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
    attach: async (file) => {
      const bytes = await file.arrayBuffer();
      return request("attach", { name: file.name, type: file.type, bytes }, [bytes]);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function PaneRoot({ paneId, App }: { readonly paneId: PaneId; readonly App: React.ComponentType }): React.JSX.Element {
  const [api, setApi] = React.useState<PaneApi>();
  React.useEffect(() => {
    const onConnect = (event: MessageEvent): void => {
      if (event.source !== parent || event.data?.type !== "panes:connect" || event.data?.paneId !== paneId || event.ports.length !== 1) return;
      const interactionMode = event.data?.interactionMode === "advanced" ? "advanced" : "standard";
      setApi(createApi(paneId, interactionMode, event.ports[0]!));
    };
    window.addEventListener("message", onConnect);
    return () => window.removeEventListener("message", onConnect);
  }, [paneId]);
  return api === undefined
    ? <main className="center muted" aria-live="polite">正在连接会话…</main>
    : <PaneContext.Provider value={api}><App /></PaneContext.Provider>;
}

export function mountPane(paneId: PaneId, App: React.ComponentType): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Pane root missing");
  createRoot(root).render(<React.StrictMode><PaneRoot paneId={paneId} App={App} /></React.StrictMode>);
}
