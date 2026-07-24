/**
 * 搜索 pane 的 Guest 应用(隔离 iframe 内运行,Wave 5 · 6.1 隔离形态首例)。
 *
 * 经 panes-kit Guest SDK 连宿主:检索走 pane 授权的 creative-search route
 * (guest.mutate → 宿主 PanesHost 转发 /api/sessions/:id/agent-routes/creative-search),
 * 不持有宿主 DOM/凭证/任意 URL 能力。由 scripts/build-panes.mjs 打成 inline srcDoc。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";

interface Hit {
  readonly id: string;
  readonly similarity: number;
  readonly payload: {
    readonly image_url?: string;
    readonly generation_params?: { readonly name?: string };
  } & Record<string, unknown>;
}

/** route 响应容错解包:creative-search 直返 {items};泛化兼容 {data:{items}} 包裹。 */
function unwrapItems(raw: unknown): { items: Hit[]; error?: string } {
  const o = (raw ?? {}) as { items?: unknown; error?: unknown; data?: unknown };
  const inner =
    Array.isArray(o.items) || typeof o.error === "string"
      ? o
      : ((o.data ?? {}) as { items?: unknown; error?: unknown });
  return {
    items: Array.isArray(inner.items) ? (inner.items as Hit[]) : [],
    ...(typeof inner.error === "string" ? { error: inner.error } : {}),
  };
}

function SearchApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [phase, setPhase] = React.useState<"idle" | "busy" | "empty" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");

  const search = async (): Promise<void> => {
    const query = q.trim();
    if (query === "" || phase === "busy") return;
    setPhase("busy");
    try {
      const r = unwrapItems(await guest.mutate("creative-search", { query, limit: 24 }));
      if (r.error !== undefined) {
        setMessage(r.error);
        setHits([]);
        setPhase("error");
        return;
      }
      setHits(r.items);
      setPhase(r.items.length > 0 ? "done" : "empty");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setHits([]);
      setPhase("error");
    }
  };

  return (
    <div className="pane-layout">
      <div className="toolbar">
        <input
          className="grow"
          placeholder="以词搜图:描述想找的素材…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <button type="button" className="button button-primary" disabled={phase === "busy"} onClick={() => void search()}>
          {phase === "busy" ? "检索中…" : "搜索"}
        </button>
      </div>
      <div className="content scroll" style={{ flex: 1, minHeight: 0 }}>
        {phase === "idle" ? <div className="empty">输入描述词,语义检索历史生成素材</div> : null}
        {phase === "empty" ? <div className="empty">无匹配素材</div> : null}
        {phase === "error" ? <div className="empty error">{message}</div> : null}
        <div className="grid">
          {hits.map((h) => (
            <figure key={h.id} className="card">
              {typeof h.payload.image_url === "string" ? (
                <img src={h.payload.image_url} alt={h.payload.generation_params?.name ?? ""} loading="lazy" />
              ) : (
                <div className="noimg">无预览</div>
              )}
              <figcaption>
                <span className="badge">{Math.round(h.similarity * 100)}%</span>
                <span className="name">{h.payload.generation_params?.name ?? h.id}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="search" fallback={<main className="center muted">正在连接会话…</main>}>
      <SearchApp />
    </PaneGuestProvider>,
  );
}
