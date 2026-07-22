import * as React from "react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { modules } from "./modules/index.js";
import type { WorkbenchModule, WorkbenchSnapshot } from "./workbench-types.js";

type UploadFn = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ attachment: { id: string }; displayUrl: string }>;

interface WorkbenchHostProps {
  readonly extId: string;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly surface?: WebExtSurfaceAccess;
  readonly upload?: UploadFn;
}

interface GuestRequest {
  readonly type: "request";
  readonly id: string;
  readonly operation: "query" | "mutate" | "attach";
  readonly payload?: unknown;
}

function isGuestRequest(value: unknown): value is GuestRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<GuestRequest>;
  return (
    request.type === "request" &&
    typeof request.id === "string" &&
    (request.operation === "query" || request.operation === "mutate" || request.operation === "attach")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkbenchHost({ baseUrl, sessionId, surface, upload }: WorkbenchHostProps): React.JSX.Element {
  const [activeId, setActiveId] = React.useState<WorkbenchModule["id"]>(modules[0].id);
  const [snapshot, setSnapshot] = React.useState<WorkbenchSnapshot | undefined>(() =>
    surface?.getState<WorkbenchSnapshot>("surface:workbench"),
  );
  const frames = React.useRef(new Map<WorkbenchModule["id"], HTMLIFrameElement>());
  const ports = React.useRef(new Map<WorkbenchModule["id"], MessagePort>());

  React.useEffect(() => {
    if (surface === undefined) return;
    setSnapshot(surface.getState<WorkbenchSnapshot>("surface:workbench"));
    return surface.subscribe("surface:workbench", (value) => {
      const next = value as WorkbenchSnapshot | undefined;
      setSnapshot(next);
      if (next !== undefined) {
        for (const port of ports.current.values()) port.postMessage({ type: "snapshot", snapshot: next });
      }
    });
  }, [surface]);

  React.useEffect(() => () => {
    for (const port of ports.current.values()) port.close();
    ports.current.clear();
  }, []);

  const endpoint =
    baseUrl !== undefined && sessionId !== undefined
      ? `${baseUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}/agent-routes/workbench-data`
      : undefined;

  const serve = React.useCallback(async (module: WorkbenchModule, request: GuestRequest): Promise<unknown> => {
    if (endpoint === undefined) throw new Error("会话数据面尚未就绪");
    if (request.operation === "attach") {
      if (!module.capabilities.attachments || upload === undefined || baseUrl === undefined || sessionId === undefined) {
        throw new Error("该模块没有附件能力");
      }
      const payload = request.payload as { name?: unknown; type?: unknown; bytes?: unknown } | undefined;
      if (typeof payload?.name !== "string" || !(payload.bytes instanceof ArrayBuffer) || payload.bytes.byteLength > 5 * 1024 * 1024) {
        throw new Error("附件无效或超过 5 MiB");
      }
      const result = await upload(baseUrl, sessionId, new File([payload.bytes], payload.name, {
        type: typeof payload.type === "string" ? payload.type : "application/octet-stream",
      }));
      return { attachmentId: result.attachment.id, displayUrl: result.displayUrl };
    }
    if (request.operation === "mutate" && !module.capabilities.write) throw new Error("该模块是只读模块");
    const payload = typeof request.payload === "object" && request.payload !== null
      ? (request.payload as Record<string, unknown>)
      : {};
    const response = request.operation === "query"
      ? await fetch(`${endpoint}?${new URLSearchParams({
          module: module.id,
          ...(typeof payload["path"] === "string" ? { path: payload["path"] } : {}),
        })}`)
      : await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, moduleId: module.id }),
        });
    if (!response.ok) throw new Error(`Agent Route HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; data?: unknown; error?: string };
    if (body.ok === false) throw new Error(body.error ?? "Agent Route rejected the request");
    return request.operation === "query" ? body.data : body;
  }, [baseUrl, endpoint, sessionId, upload]);

  const connect = React.useCallback((module: WorkbenchModule) => {
    const frame = frames.current.get(module.id);
    if (frame?.contentWindow === null || frame?.contentWindow === undefined) return;
    ports.current.get(module.id)?.close();
    const channel = new MessageChannel();
    ports.current.set(module.id, channel.port1);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!isGuestRequest(data)) return;
      void serve(module, data).then(
        (result) => channel.port1.postMessage({ type: "response", id: data.id, ok: true, data: result }),
        (error) => channel.port1.postMessage({ type: "response", id: data.id, ok: false, error: errorMessage(error) }),
      );
    };
    channel.port1.start();
    frame.contentWindow.postMessage({ type: "workbench:connect", moduleId: module.id }, "*", [channel.port2]);
    if (snapshot !== undefined) channel.port1.postMessage({ type: "snapshot", snapshot });
  }, [serve, snapshot]);

  return (
    <section data-workbench-host style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "#090e1a", color: "#e5e7eb" }}>
      <header style={{ padding: "12px 14px 8px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong style={{ flex: 1 }}>模块工作台</strong>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>rev {snapshot?.revision ?? "—"}</span>
        </div>
        <nav aria-label="工作台模块" role="tablist" style={{ display: "flex", gap: 4, overflowX: "auto" }}>
          {modules.map((module) => {
            const selected = module.id === activeId;
            return (
              <button key={module.id} type="button" role="tab" aria-selected={selected} onClick={() => setActiveId(module.id)}
                style={{ border: 0, borderRadius: 8, padding: "7px 10px", whiteSpace: "nowrap", color: selected ? "#fff" : "#94a3b8", background: selected ? "#1e293b" : "transparent", cursor: "pointer" }}>
                <span aria-hidden="true">{module.icon}</span> {module.title}
              </button>
            );
          })}
        </nav>
      </header>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {modules.map((module) => (
          <iframe key={module.id} ref={(node) => { if (node === null) frames.current.delete(module.id); else frames.current.set(module.id, node); }}
            title={module.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={module.document} onLoad={() => connect(module)}
            style={{ display: activeId === module.id ? "block" : "none", width: "100%", height: "100%", border: 0 }} />
        ))}
      </div>
    </section>
  );
}
