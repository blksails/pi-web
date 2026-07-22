import * as React from "react";
import {
  PaneGuestRequestSchema,
  PANE_PROTOCOL_VERSION,
  type PaneCapabilities,
  type PaneDefinition,
  type PaneGuestRequest,
  type PaneHostMessage,
  type PaneInstance,
  type PanesDefinition,
} from "../contract.js";
import { authorizePaneRequest, DEFAULT_PANE_RESPONSE_BYTES } from "../authorization.js";
import { createAgentRouteClient } from "../agent-routes.js";
import { asPaneHostError, PaneHostError } from "../errors.js";
import { createPaneWorkspace, reducePaneWorkspace, type PaneWorkspaceAction } from "../instances.js";

export interface PanesSurfaceAccess {
  run(domain: string, action: string, args?: unknown): Promise<unknown>;
  getState<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  hasCommand(name: string): boolean;
}

export type PanesUpload = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ readonly attachment: { readonly id: string }; readonly displayUrl: string }>;

export interface PanesConversationAccess {
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): void;
}

export interface PanesHostConfig {
  readonly interactionMode?: "standard" | "advanced";
  readonly allowTabReorder?: boolean;
  readonly showCommandPalette?: boolean;
}

export interface PanesHostProps {
  readonly definition: PanesDefinition;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly surface?: PanesSurfaceAccess;
  readonly upload?: PanesUpload;
  readonly conversation?: PanesConversationAccess;
  readonly config?: PanesHostConfig;
  readonly className?: string;
  readonly onHostError?: (error: PaneHostError) => void;
  readonly createInstanceId?: (paneId: string, sequence: number) => string;
}

interface LiveConnection {
  readonly epoch: number;
  readonly port: MessagePort;
  readonly cleanup: readonly (() => void)[];
}

function defaultInstanceId(paneId: string, sequence: number): string {
  return `${paneId}-${sequence}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function paneById(definition: PanesDefinition, paneId: string): PaneDefinition {
  const pane = definition.panes.find((candidate) => candidate.id === paneId);
  if (pane === undefined) throw new Error(`Unknown pane id: ${paneId}`);
  return pane;
}

function routeMax(capabilities: PaneCapabilities, route: string, method: "GET" | "POST"): number {
  return capabilities.routes.find((grant) => grant.name === route && grant.methods.includes(method))?.maxResponseBytes
    ?? DEFAULT_PANE_RESPONSE_BYTES;
}

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
};

export function PanesHost({
  definition,
  baseUrl,
  sessionId,
  surface,
  upload,
  conversation,
  config = {},
  className,
  onHostError,
  createInstanceId = defaultInstanceId,
}: PanesHostProps): React.JSX.Element {
  const sequence = React.useRef(0);
  const nextId = React.useCallback((paneId: string) => createInstanceId(paneId, ++sequence.current), [createInstanceId]);
  const [workspace, setWorkspace] = React.useState(() => createPaneWorkspace(definition, (paneId) => nextId(paneId)));
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [draggedId, setDraggedId] = React.useState<string>();
  const [hostError, setHostError] = React.useState<PaneHostError>();
  const frames = React.useRef(new Map<string, HTMLIFrameElement>());
  const connections = React.useRef(new Map<string, LiveConnection>());
  const advanced = config.interactionMode === "advanced";

  const dispatch = React.useCallback((action: PaneWorkspaceAction): void => {
    setWorkspace((current) => reducePaneWorkspace(definition, current, action));
  }, [definition]);

  const closeConnection = React.useCallback((instanceId: string, lifecycle = true): void => {
    const live = connections.current.get(instanceId);
    if (live === undefined) return;
    if (lifecycle) live.port.postMessage({ type: "pane:lifecycle", state: "closing" } satisfies PaneHostMessage);
    for (const cleanup of live.cleanup) cleanup();
    live.port.close();
    connections.current.delete(instanceId);
  }, []);

  React.useEffect(() => () => {
    for (const instanceId of [...connections.current.keys()]) closeConnection(instanceId);
  }, [closeConnection]);

  React.useEffect(() => {
    for (const instance of workspace.instances) {
      connections.current.get(instance.instanceId)?.port.postMessage({
        type: "pane:lifecycle",
        state: instance.instanceId === workspace.activeInstanceId ? "visible" : "hidden",
      } satisfies PaneHostMessage);
    }
  }, [workspace.activeInstanceId, workspace.instances]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && config.showCommandPalette !== false) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const instance = workspace.instances[Number(event.key) - 1];
        if (instance !== undefined) dispatch({ type: "activate", instanceId: instance.instanceId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.showCommandPalette, dispatch, workspace.instances]);

  const handleRequest = React.useCallback(async (
    instance: PaneInstance,
    pane: PaneDefinition,
    request: PaneGuestRequest,
  ): Promise<unknown> => {
    const live = connections.current.get(instance.instanceId);
    if (live?.epoch !== instance.epoch) throw new PaneHostError("STALE_INSTANCE", "Pane instance epoch is stale");
    authorizePaneRequest(pane.capabilities, request);
    if (request.operation === "route.query" || request.operation === "route.mutate") {
      if (baseUrl === undefined || sessionId === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Agent Route session is not ready", { retryable: true });
      const client = createAgentRouteClient({ baseUrl, sessionId });
      return request.operation === "route.query"
        ? client.query(request.route, request.query, routeMax(pane.capabilities, request.route, "GET"))
        : client.mutate(request.route, request.body, routeMax(pane.capabilities, request.route, "POST"));
    }
    if (request.operation === "surface.run") {
      if (surface === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Surface is not ready", { retryable: true });
      return surface.run(request.domain, request.action, request.args);
    }
    if (request.operation === "attachment.put") {
      if (upload === undefined || baseUrl === undefined || sessionId === undefined) {
        throw new PaneHostError("ATTACHMENT_FAILED", "Attachment service is not ready", { retryable: true });
      }
      const file = new File([request.bytes], request.name, { type: request.mimeType || "application/octet-stream" });
      const result = await upload(baseUrl, sessionId, file);
      return { attachmentId: result.attachment.id, displayUrl: result.displayUrl };
    }
    if (conversation === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Conversation is not ready", { retryable: true });
    conversation.submitUserMessage(request.text, request.attachmentIds === undefined ? undefined : { attachmentIds: request.attachmentIds });
    return undefined;
  }, [baseUrl, conversation, sessionId, surface, upload]);

  const connect = React.useCallback((instance: PaneInstance): void => {
    const frame = frames.current.get(instance.instanceId);
    if (frame?.contentWindow === null || frame?.contentWindow === undefined) return;
    if (connections.current.get(instance.instanceId)?.epoch === instance.epoch) return;
    closeConnection(instance.instanceId, false);
    const pane = paneById(definition, instance.paneId);
    const channel = new MessageChannel();
    const cleanup: Array<() => void> = [];
    connections.current.set(instance.instanceId, { epoch: instance.epoch, port: channel.port1, cleanup });
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const parsed = PaneGuestRequestSchema.safeParse(data);
      if (!parsed.success) {
        const requestId = typeof data === "object" && data !== null && typeof (data as { requestId?: unknown }).requestId === "string"
          ? (data as { requestId: string }).requestId
          : "invalid";
        channel.port1.postMessage({
          type: "pane:result",
          requestId,
          ok: false,
          error: new PaneHostError("INVALID_MESSAGE", "Pane request does not match protocol").toJSON(),
        } satisfies PaneHostMessage);
        return;
      }
      void handleRequest(instance, pane, parsed.data).then(
        (data) => channel.port1.postMessage({ type: "pane:result", requestId: parsed.data.requestId, ok: true, data } satisfies PaneHostMessage),
        (reason: unknown) => {
          const error = asPaneHostError(reason);
          if (error.code === "HOST_UNAVAILABLE") setHostError(error);
          onHostError?.(error);
          channel.port1.postMessage({ type: "pane:result", requestId: parsed.data.requestId, ok: false, error: error.toJSON() } satisfies PaneHostMessage);
        },
      );
    };
    channel.port1.start();
    for (const key of pane.capabilities.surfaceKeys) {
      if (surface === undefined) break;
      const push = (value: unknown): void => channel.port1.postMessage({ type: "pane:surface", key, value } satisfies PaneHostMessage);
      push(surface.getState(key));
      cleanup.push(surface.subscribe(key, push));
    }
    frame.contentWindow.postMessage({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: instance.instanceId, paneId: instance.paneId, epoch: instance.epoch },
      grants: pane.capabilities,
      interactionMode: config.interactionMode ?? "standard",
    } satisfies PaneHostMessage, "*", [channel.port2]);
  }, [closeConnection, config.interactionMode, definition, handleRequest, onHostError, surface]);

  React.useEffect(() => {
    const onGuestReady = (event: MessageEvent<unknown>): void => {
      const data = event.data as { type?: unknown; protocol?: unknown; paneId?: unknown } | undefined;
      if (data?.type !== "pane:ready" || data.protocol !== PANE_PROTOCOL_VERSION || typeof data.paneId !== "string") return;
      const instance = workspace.instances.find((candidate) => {
        const frame = frames.current.get(candidate.instanceId);
        return candidate.paneId === data.paneId && frame?.contentWindow === event.source;
      });
      if (instance !== undefined) connect(instance);
    };
    window.addEventListener("message", onGuestReady);
    return () => window.removeEventListener("message", onGuestReady);
  }, [connect, workspace.instances]);

  const openPane = (paneId: string): void => {
    dispatch({ type: "open", paneId, instanceId: nextId(paneId) });
    setPaletteOpen(false);
  };

  const closePane = (instanceId: string): void => {
    closeConnection(instanceId);
    dispatch({ type: "close", instanceId });
  };

  return (
    <section data-panes-host className={className} style={{ position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 4, padding: 8, borderBottom: "1px solid hsl(var(--border))" }}>
        <nav aria-label="Panes" role="tablist" style={{ display: "flex", flex: 1, gap: 2, minWidth: 0, overflowX: "auto" }}>
          {workspace.instances.map((instance, index) => {
            const pane = paneById(definition, instance.paneId);
            const count = workspace.instances.filter((candidate) => candidate.paneId === instance.paneId);
            const ordinal = count.findIndex((candidate) => candidate.instanceId === instance.instanceId) + 1;
            const selected = instance.instanceId === workspace.activeInstanceId;
            return (
              <div key={instance.instanceId} role="presentation" draggable={advanced && config.allowTabReorder !== false}
                onDragStart={() => setDraggedId(instance.instanceId)} onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (draggedId !== undefined) dispatch({ type: "move", instanceId: draggedId, beforeInstanceId: instance.instanceId }); setDraggedId(undefined); }}
                style={{ display: "flex", alignItems: "center", borderRadius: 8, background: selected ? "hsl(var(--accent))" : "transparent" }}>
                <button type="button" role="tab" aria-selected={selected} aria-controls={`pane-view-${instance.instanceId}`}
                  title={`${pane.title} · Alt+${index + 1}`} onClick={() => dispatch({ type: "activate", instanceId: instance.instanceId })}
                  style={{ ...buttonStyle, padding: "7px 5px 7px 9px", whiteSpace: "nowrap", color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                  <span aria-hidden="true">{pane.icon}</span> {pane.title}{count.length > 1 ? ` ${ordinal}` : ""}
                </button>
                <button type="button" aria-label={`关闭 ${pane.title}`} title="关闭 Pane" onClick={() => closePane(instance.instanceId)}
                  style={{ ...buttonStyle, padding: "4px 7px", color: "hsl(var(--muted-foreground))" }}>×</button>
              </div>
            );
          })}
        </nav>
        <button type="button" aria-label="新开 Pane" title="新开 Pane" onClick={() => setPaletteOpen(true)} style={{ ...buttonStyle, padding: "4px 9px", fontSize: 18 }}>+</button>
        {config.showCommandPalette !== false ? <button type="button" aria-label="打开 Pane 切换器" title="Ctrl/Cmd+K" onClick={() => setPaletteOpen(true)} style={{ ...buttonStyle, border: "1px solid hsl(var(--border))", padding: "5px 8px" }}>⌘K</button> : null}
      </header>
      {hostError !== undefined ? <div role="alert" data-pane-host-error={hostError.code} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 10px", background: "hsl(var(--destructive) / .1)", color: "hsl(var(--destructive))", fontSize: 12 }}><span>{hostError.message}</span><button type="button" onClick={() => setHostError(undefined)} style={buttonStyle}>×</button></div> : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {workspace.instances.length === 0 ? <div style={{ height: "100%", display: "grid", placeItems: "center", color: "hsl(var(--muted-foreground))" }}><button type="button" onClick={() => setPaletteOpen(true)} style={{ ...buttonStyle, border: "1px solid hsl(var(--border))", padding: "8px 12px" }}>打开一个 Pane</button></div> : null}
        {workspace.instances.map((instance) => {
          const pane = paneById(definition, instance.paneId);
          const active = instance.instanceId === workspace.activeInstanceId;
          return <iframe key={`${instance.instanceId}:${instance.epoch}`} id={`pane-view-${instance.instanceId}`}
            ref={(node) => { if (node === null) frames.current.delete(instance.instanceId); else frames.current.set(instance.instanceId, node); }}
            title={pane.title} sandbox="allow-scripts" referrerPolicy="no-referrer"
            {...(pane.document.kind === "inline" ? { srcDoc: pane.document.srcDoc } : { src: pane.document.src })}
            onLoad={() => connect(instance)}
            style={{ display: active ? "block" : "none", width: "100%", height: "100%", border: 0 }} />;
        })}
      </div>
      {paletteOpen ? <div role="dialog" aria-modal="true" aria-label="新开 Pane" onMouseDown={() => setPaletteOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 30, display: "grid", placeItems: "start center", paddingTop: 60, background: "rgb(0 0 0 / .28)" }}>
        <div onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(360px, calc(100% - 24px))", padding: 8, border: "1px solid hsl(var(--border))", borderRadius: 12, background: "hsl(var(--popover, var(--background)))", boxShadow: "0 18px 45px rgb(0 0 0 / .18)" }}>
          <strong style={{ display: "block", padding: "7px 10px" }}>新开 Pane</strong>
          {definition.panes.map((pane, index) => {
            const openCount = workspace.instances.filter((instance) => instance.paneId === pane.id).length;
            const disabled = openCount >= pane.maxInstances || workspace.instances.length >= definition.maxOpenPanes;
            return <button key={pane.id} type="button" autoFocus={index === 0} disabled={disabled} onClick={() => openPane(pane.id)}
              style={{ ...buttonStyle, width: "100%", display: "flex", justifyContent: "space-between", padding: "9px 10px", textAlign: "left", opacity: disabled ? .45 : 1 }}>
              <span>{pane.icon} {pane.title}</span><span>{openCount}/{pane.maxInstances}</span>
            </button>;
          })}
        </div>
      </div> : null}
    </section>
  );
}
