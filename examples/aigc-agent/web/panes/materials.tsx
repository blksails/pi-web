/**
 * 素材 pane 的 Guest 应用(隔离 iframe 内运行,Wave 5 · 6.1 隔离形态第二例)。
 *
 * 验证隔离 pane 的全通道谱(搜索例只用 route POST):
 *  - route GET:guest.query("assets-list") → Page<AssetRecord>(生成素材列表);
 *  - surface 订阅:subscribe("surface:materials") 收敛选中态(权威在 agent,单写者);
 *  - surface 命令:run("materials","select"/"set-filter")(经宿主 surfaceCommands 授权);
 *  - conversation 直送:submitUserMessage(text, {attachmentIds})(「带入对话」)。
 * 不复刻 MaterialDrawer 全 UI,核心交互齐:列表/多选/全选/带入对话/刷新。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";

interface AssetItem {
  readonly assetId: string;
  readonly attachmentId?: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta?: { readonly name?: string } & Record<string, unknown>;
}

function unwrapItems(raw: unknown): AssetItem[] {
  const o = (raw ?? {}) as { items?: unknown; data?: unknown };
  const inner = Array.isArray(o.items)
    ? o.items
    : ((o.data ?? {}) as { items?: unknown }).items;
  return Array.isArray(inner) ? (inner as AssetItem[]) : [];
}

function MaterialsApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const [items, setItems] = React.useState<AssetItem[]>([]);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = React.useState<"busy" | "done" | "error">("busy");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async (): Promise<void> => {
    setPhase("busy");
    try {
      setItems(unwrapItems(await guest.query("assets-list", { kind: "image", limit: "200" })));
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [guest]);
  React.useEffect(() => {
    void load();
  }, [load]);

  // 选中态权威在 agent(surface:materials):命令上行,订阅回流收敛。
  React.useEffect(
    () =>
      guest.surface.subscribe("surface:materials", (v) => {
        const ids = (v as { selectedIds?: unknown } | null)?.selectedIds;
        if (Array.isArray(ids)) {
          setPicked(new Set(ids.filter((x): x is string => typeof x === "string")));
        }
      }),
    [guest],
  );
  const applyPicked = (next: ReadonlySet<string>): void => {
    setPicked(next);
    void guest.surface.run("materials", "select", { ids: [...next] }).catch(() => undefined);
  };
  const toggle = (attachmentId: string): void => {
    const next = new Set(picked);
    if (next.has(attachmentId)) next.delete(attachmentId);
    else next.add(attachmentId);
    applyPicked(next);
  };

  const selectable = items.filter((a) => typeof a.attachmentId === "string");
  const allPicked = selectable.length > 0 && selectable.every((a) => picked.has(a.attachmentId!));
  const bring = async (): Promise<void> => {
    const refs = [...picked];
    if (refs.length === 0) return;
    await guest.submitUserMessage(`带入对话(共 ${refs.length} 项制品)`, { attachmentIds: refs });
    applyPicked(new Set());
  };

  return (
    <div className="pane-layout">
      <div className="toolbar">
        <span className="muted grow">{picked.size > 0 ? `已选 ${picked.size}` : `${items.length} 个素材`}</span>
        <button type="button" className="button" onClick={() => applyPicked(allPicked ? new Set() : new Set(selectable.map((a) => a.attachmentId!)))}>
          {allPicked ? "清空" : "全选"}
        </button>
        <button type="button" className="button button-primary" disabled={picked.size === 0} onClick={() => void bring()}>
          带入对话
        </button>
        <button type="button" className="button" onClick={() => void load()} disabled={phase === "busy"}>
          刷新
        </button>
      </div>
      <div className="content scroll" style={{ flex: 1, minHeight: 0 }}>
        {phase === "busy" ? <div className="empty">加载中…</div> : null}
        {phase === "error" ? <div className="empty error">{message}</div> : null}
        {phase === "done" && items.length === 0 ? <div className="empty">本会话暂无生成素材</div> : null}
        <div className="grid">
          {items.map((a) => {
            const id = a.attachmentId;
            const on = id !== undefined && picked.has(id);
            return (
              <figure key={a.assetId} className={`card${on ? " on" : ""}`}>
                <button
                  type="button"
                  className="imgbtn"
                  disabled={id === undefined}
                  aria-pressed={on}
                  onClick={() => id !== undefined && toggle(id)}
                >
                  <img src={a.displayUrl} alt={a.meta?.name ?? a.assetId} loading="lazy" />
                </button>
                <figcaption>
                  <span className="name">{a.meta?.name ?? a.assetId}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="materials" fallback={<main className="center muted">正在连接会话…</main>}>
      <MaterialsApp />
    </PaneGuestProvider>,
  );
}
