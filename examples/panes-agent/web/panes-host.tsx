import * as React from "react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { panes } from "./panes/index.js";
import type { PaneDefinition, PaneId, PaneRequest, PanesHostConfig, PanesSnapshot } from "./pane-types.js";

type UploadFn = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ attachment: { id: string }; displayUrl: string }>;

export interface PanesHostProps {
  readonly extId: string;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly surface?: WebExtSurfaceAccess;
  readonly upload?: UploadFn;
  readonly config: PanesHostConfig;
}

function isPaneRequest(value: unknown): value is PaneRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<PaneRequest>;
  return request.type === "request" && typeof request.id === "string" &&
    (request.operation === "query" || request.operation === "mutate" || request.operation === "attach");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const shell: React.CSSProperties = {
  position: "relative",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
};

export function PanesHost({ baseUrl, sessionId, surface, upload, config }: PanesHostProps): React.JSX.Element {
  const [activeId, setActiveId] = React.useState<PaneDefinition["id"]>(panes[0]!.id);
  const [orderedIds, setOrderedIds] = React.useState<readonly PaneId[]>(() => panes.map((pane) => pane.id));
  const [draggedId, setDraggedId] = React.useState<PaneId>();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<PanesSnapshot | undefined>(() =>
    surface?.getState<PanesSnapshot>("surface:panes"),
  );
  const frames = React.useRef(new Map<PaneDefinition["id"], HTMLIFrameElement>());
  const ports = React.useRef(new Map<PaneDefinition["id"], MessagePort>());
  const orderedPanes = orderedIds.map((id) => panes.find((pane) => pane.id === id)!).filter(Boolean);

  React.useEffect(() => {
    if (surface === undefined) return;
    setSnapshot(surface.getState<PanesSnapshot>("surface:panes"));
    return surface.subscribe("surface:panes", (value) => {
      const next = value as PanesSnapshot | undefined;
      setSnapshot(next);
      if (next !== undefined) {
        for (const port of ports.current.values()) port.postMessage({ type: "snapshot", snapshot: next });
      }
    });
  }, [surface]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.altKey && /^[1-5]$/.test(event.key)) {
        const pane = panes[Number(event.key) - 1];
        if (pane !== undefined) setActiveId(pane.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  React.useEffect(() => () => {
    for (const port of ports.current.values()) port.close();
    ports.current.clear();
  }, []);

  const endpoint = baseUrl !== undefined && sessionId !== undefined
    ? `${baseUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}/agent-routes/pane-data`
    : undefined;

  const serve = React.useCallback(async (pane: PaneDefinition, request: PaneRequest): Promise<unknown> => {
    if (endpoint === undefined) throw new Error("会话数据面尚未就绪");
    if (request.operation === "attach") {
      if (!pane.capabilities.attachments || upload === undefined || baseUrl === undefined || sessionId === undefined) {
        throw new Error("该 Pane 没有附件能力");
      }
      const payload = request.payload as { name?: unknown; type?: unknown; bytes?: unknown } | undefined;
      if (typeof payload?.name !== "string" || !(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength > 5 * 1024 * 1024) {
        throw new Error("附件无效或超过 5 MiB");
      }
      const file = new File([payload.bytes], payload.name, {
        type: typeof payload.type === "string" ? payload.type : "application/octet-stream",
      });
      const result = await upload(baseUrl, sessionId, file);
      return { attachmentId: result.attachment.id, displayUrl: result.displayUrl };
    }
    if (request.operation === "mutate" && !pane.capabilities.write) throw new Error("该 Pane 是只读 Pane");
    const payload = typeof request.payload === "object" && request.payload !== null
      ? request.payload as Record<string, unknown>
      : {};
    const response = request.operation === "query"
      ? await fetch(`${endpoint}?${new URLSearchParams({
          pane: pane.id,
          ...(typeof payload["path"] === "string" ? { path: payload["path"] } : {}),
        })}`)
      : await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, paneId: pane.id }),
        });
    if (!response.ok) throw new Error(`Agent Route HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; data?: unknown; error?: string };
    if (body.ok === false) throw new Error(body.error ?? "Agent Route rejected the request");
    return request.operation === "query" ? body.data : body;
  }, [baseUrl, endpoint, sessionId, upload]);

  const connect = React.useCallback((pane: PaneDefinition) => {
    const frame = frames.current.get(pane.id);
    if (frame?.contentWindow === null || frame?.contentWindow === undefined) return;
    ports.current.get(pane.id)?.close();
    const channel = new MessageChannel();
    ports.current.set(pane.id, channel.port1);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!isPaneRequest(data)) return;
      void serve(pane, data).then(
        (result) => channel.port1.postMessage({ type: "response", id: data.id, ok: true, data: result }),
        (error) => channel.port1.postMessage({ type: "response", id: data.id, ok: false, error: errorMessage(error) }),
      );
    };
    channel.port1.start();
    frame.contentWindow.postMessage({ type: "panes:connect", paneId: pane.id, interactionMode: config.interactionMode }, "*", [channel.port2]);
    if (snapshot !== undefined) channel.port1.postMessage({ type: "snapshot", snapshot });
  }, [config.interactionMode, serve, snapshot]);

  const moveTab = (targetId: PaneId): void => {
    if (draggedId === undefined || draggedId === targetId) return;
    setOrderedIds((current) => {
      const next = current.filter((id) => id !== draggedId);
      next.splice(next.indexOf(targetId), 0, draggedId);
      return next;
    });
    setDraggedId(undefined);
  };

  return (
    <section data-panes-host style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px", borderBottom: "1px solid hsl(var(--border))" }}>
        <nav aria-label="Panes" role="tablist" style={{ display: "flex", flex: 1, gap: 2, minWidth: 0, overflowX: "auto" }}>
          {orderedPanes.map((pane, index) => {
            const selected = pane.id === activeId;
            return (
              <button key={pane.id} type="button" role="tab" aria-selected={selected} aria-controls={`pane-${pane.id}`}
                draggable={config.interactionMode === "advanced" && config.allowTabReorder}
                onDragStart={() => setDraggedId(pane.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveTab(pane.id)}
                title={`${pane.title} · Alt+${index + 1}`} onClick={() => setActiveId(pane.id)}
                style={{ border: 0, borderRadius: 7, padding: "7px 9px", whiteSpace: "nowrap", color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))", background: selected ? "hsl(var(--accent))" : "transparent", cursor: "pointer", font: "inherit" }}>
                <span aria-hidden="true">{pane.icon}</span> {pane.title}
              </button>
            );
          })}
        </nav>
        {config.interactionMode === "advanced" ? <button type="button" aria-label="添加 Pane" title="打开 Pane 列表" onClick={() => setPaletteOpen(true)} style={{ border: 0, borderRadius: 7, padding: "5px 9px", background: "hsl(var(--muted))", color: "inherit", cursor: "pointer", fontSize: 18 }}>+</button> : null}
        <span title="Agent 权威修订号" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>r{snapshot?.revision ?? "—"}</span>
        {config.showCommandPalette ? <button type="button" aria-label="打开 Pane 切换器" title="切换 Pane · Ctrl+K" onClick={() => setPaletteOpen(true)}
          style={{ border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "5px 8px", background: "transparent", color: "inherit", cursor: "pointer" }}>⌘K</button>
          : null}
        {config.interactionMode === "advanced" ? <div style={{ position: "relative" }}><button type="button" aria-label="Pane 菜单" onClick={() => setMenuOpen((open) => !open)} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 6 }}>•••</button>{menuOpen ? <div role="menu" style={{ position: "absolute", zIndex: 30, top: 30, right: 0, width: 180, padding: 6, border: "1px solid hsl(var(--border))", borderRadius: 10, background: "hsl(var(--popover, var(--background)))", boxShadow: "0 14px 32px rgb(0 0 0 / .18)" }}><button role="menuitem" onClick={() => { setOrderedIds(panes.map((pane) => pane.id)); setMenuOpen(false); }} style={{ width: "100%", border: 0, borderRadius: 7, padding: 8, textAlign: "left", background: "transparent", color: "inherit", cursor: "pointer" }}>恢复默认顺序</button><button role="menuitem" onClick={() => { setPaletteOpen(true); setMenuOpen(false); }} style={{ width: "100%", border: 0, borderRadius: 7, padding: 8, textAlign: "left", background: "transparent", color: "inherit", cursor: "pointer" }}>切换 Pane</button></div> : null}</div> : null}
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {panes.map((pane) => (
          <iframe key={pane.id} id={`pane-${pane.id}`} ref={(node) => { if (node === null) frames.current.delete(pane.id); else frames.current.set(pane.id, node); }}
            title={pane.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={pane.document} onLoad={() => connect(pane)}
            style={{ display: activeId === pane.id ? "block" : "none", width: "100%", height: "100%", border: 0 }} />
        ))}
      </div>
      {paletteOpen ? (
        <div role="dialog" aria-modal="true" aria-label="切换 Pane" onMouseDown={() => setPaletteOpen(false)}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "grid", placeItems: "start center", paddingTop: 64, background: "rgb(0 0 0 / .28)" }}>
          <div onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(320px, calc(100% - 24px))", padding: 8, border: "1px solid hsl(var(--border))", borderRadius: 12, background: "hsl(var(--popover, var(--background)))", boxShadow: "0 18px 45px rgb(0 0 0 / .18)" }}>
            {orderedPanes.map((pane, index) => (
              <button key={pane.id} type="button" autoFocus={index === 0} onClick={() => { setActiveId(pane.id); setPaletteOpen(false); }}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", border: 0, borderRadius: 8, padding: "9px 10px", background: pane.id === activeId ? "hsl(var(--accent))" : "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}>
                <span>{pane.icon} {pane.title}</span><kbd>Alt+{index + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
