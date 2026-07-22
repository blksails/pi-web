import type {
  PaneCapabilities,
  PaneConnectedMessage,
  PaneErrorData,
  PaneHostMessage,
} from "./contract.js";
import { PANE_PROTOCOL_VERSION } from "./contract.js";
import { PaneHostError } from "./errors.js";

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PaneGuestSurface {
  run(domain: string, action: string, args?: unknown): Promise<unknown>;
  getState<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  hasCommand(name: string): boolean;
}

export interface PaneGuestConnection {
  readonly instanceId: string;
  readonly paneId: string;
  readonly epoch: number;
  readonly interactionMode: "standard" | "advanced";
  readonly grants: PaneCapabilities;
  readonly surface: PaneGuestSurface;
  query<T = unknown>(route: string, query?: Record<string, string>): Promise<T>;
  mutate<T = unknown>(route: string, body: unknown): Promise<T>;
  upload(file: File): Promise<{ attachmentId: string; displayUrl: string }>;
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): Promise<void>;
  onLifecycle(listener: (state: "visible" | "hidden" | "closing") => void): () => void;
  close(): void;
}

function errorFromData(error: PaneErrorData): PaneHostError {
  return new PaneHostError(error.code, error.message, { retryable: error.retryable, status: error.status });
}

function createConnection(message: PaneConnectedMessage, port: MessagePort, timeoutMs: number): PaneGuestConnection {
  let sequence = 0;
  let closed = false;
  const pending = new Map<string, PendingCall>();
  const states = new Map<string, unknown>();
  const surfaceListeners = new Map<string, Set<(value: unknown) => void>>();
  const lifecycleListeners = new Set<(state: "visible" | "hidden" | "closing") => void>();

  const request = <T,>(operation: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> => {
    if (closed) return Promise.reject(new PaneHostError("HOST_UNAVAILABLE", "Pane connection is closed"));
    const requestId = `${message.instance.instanceId}:${++sequence}`;
    port.postMessage({ type: "pane:request", requestId, operation, ...payload }, transfer);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new PaneHostError("REQUEST_TIMEOUT", "Pane request timed out", { retryable: true }));
      }, timeoutMs);
      pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
    });
  };

  port.onmessage = ({ data }: MessageEvent<PaneHostMessage>) => {
    if (data.type === "pane:result") {
      const call = pending.get(data.requestId);
      if (call === undefined) return;
      pending.delete(data.requestId);
      clearTimeout(call.timer);
      if (data.ok) call.resolve(data.data);
      else call.reject(errorFromData(data.error));
      return;
    }
    if (data.type === "pane:surface") {
      states.set(data.key, data.value);
      for (const listener of surfaceListeners.get(data.key) ?? []) listener(data.value);
      return;
    }
    if (data.type === "pane:lifecycle") {
      for (const listener of lifecycleListeners) listener(data.state);
    }
  };
  port.start();

  const grants = message.grants;
  return {
    instanceId: message.instance.instanceId,
    paneId: message.instance.paneId,
    epoch: message.instance.epoch,
    interactionMode: message.interactionMode,
    grants,
    surface: {
      run: (domain, action, args) => request("surface.run", { domain, action, ...(args !== undefined ? { args } : {}) }),
      getState: <T,>(key: string) => states.get(key) as T | undefined,
      subscribe: (key, listener) => {
        const listeners = surfaceListeners.get(key) ?? new Set();
        listeners.add(listener);
        surfaceListeners.set(key, listeners);
        return () => listeners.delete(listener);
      },
      hasCommand: (name) => grants.surfaceCommands.some((grant) =>
        name === `surface:${grant.domain}` || grant.actions.some((action) => name === `surface:${grant.domain}:${action}`)),
    },
    query: (route, query = {}) => request("route.query", { route, query }),
    mutate: (route, body) => request("route.mutate", { route, body }),
    upload: async (file) => {
      const bytes = await file.arrayBuffer();
      return request("attachment.put", { name: file.name, mimeType: file.type, bytes }, [bytes]);
    },
    submitUserMessage: (text, options) => request("conversation.submit", {
      text,
      ...(options?.attachmentIds !== undefined ? { attachmentIds: options.attachmentIds } : {}),
    }),
    onLifecycle: (listener) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new PaneHostError("HOST_UNAVAILABLE", "Pane connection closed"));
      }
      pending.clear();
      port.close();
    },
  };
}

export function connectPaneGuest(options: {
  readonly expectedPaneId: string;
  readonly timeoutMs?: number;
  readonly window?: Window;
}): Promise<PaneGuestConnection> {
  const guestWindow = options.window ?? globalThis.window;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      guestWindow.removeEventListener("message", onConnect);
      reject(new PaneHostError("HOST_UNAVAILABLE", "Pane host handshake timed out", { retryable: true }));
    }, options.timeoutMs ?? 15_000);
    const onConnect = (event: MessageEvent<unknown>): void => {
      const data = event.data as Partial<PaneConnectedMessage> | undefined;
      if (event.source !== guestWindow.parent || data?.type !== "pane:connected" || event.ports.length !== 1) return;
      if (data.protocol !== PANE_PROTOCOL_VERSION || data.instance?.paneId !== options.expectedPaneId) return;
      clearTimeout(timeout);
      guestWindow.removeEventListener("message", onConnect);
      resolve(createConnection(data as PaneConnectedMessage, event.ports[0]!, options.timeoutMs ?? 15_000));
    };
    guestWindow.addEventListener("message", onConnect);
    // readiness 与 iframe load 双触发配合：无论 React effect 与 load 谁先发生，Host 都能握手。
    guestWindow.parent.postMessage({
      type: "pane:ready",
      protocol: PANE_PROTOCOL_VERSION,
      paneId: options.expectedPaneId,
    }, "*");
  });
}
