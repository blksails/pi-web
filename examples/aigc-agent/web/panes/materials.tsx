/**
 * 素材 pane 的 Guest 应用(隔离 iframe 内运行)。
 *
 * 全通道谱:
 *  - route GET:`guest.query("assets-list")` → 素材列表(数据面,只读 R-0a);
 *  - surface 订阅:`surface:materials` 回流选中集 / 目录树 / 归属(权威在 agent,单写者 C1-2);
 *  - surface 命令(**控制面写通道**):select / set-filter / create-folder / rename-folder /
 *    move-folder / delete-folder / move-items;
 *  - conversation 直送:`submitUserMessage(text, { attachmentIds })`(「带入对话」);
 *  - 拖放发端:`text/att-id`(+ `text/uri-list` / `text/plain` 便于外部落点)拖入宿主输入框,
 *    零上传入列为已落库引用(受口见 packages/ui `attachment-dnd`)。
 *
 * sandbox 只给 allow-scripts —— **无 allow-modals**,故不得用 `prompt()`/`confirm()`,
 * 新建/改名走内联输入框,删除走「点两次确认」。
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

interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
}

interface MaterialsSnapshot {
  readonly selectedIds?: readonly string[];
  readonly folders?: readonly Folder[];
  readonly itemFolder?: Readonly<Record<string, string>>;
}

function unwrapItems(raw: unknown): AssetItem[] {
  const o = (raw ?? {}) as { items?: unknown; data?: unknown };
  const inner = Array.isArray(o.items) ? o.items : ((o.data ?? {}) as { items?: unknown }).items;
  return Array.isArray(inner) ? (inner as AssetItem[]) : [];
}

/** 目录树按 parentId 归层;顺序即创建序(与快照一致,不另排序)。 */
function childrenOf(folders: readonly Folder[], parentId: string | undefined): Folder[] {
  return folders.filter((f) => f.parentId === parentId);
}

function MaterialsApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const [items, setItems] = React.useState<AssetItem[]>([]);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [folders, setFolders] = React.useState<readonly Folder[]>([]);
  const [itemFolder, setItemFolder] = React.useState<Readonly<Record<string, string>>>({});
  const [phase, setPhase] = React.useState<"busy" | "done" | "error">("busy");
  const [message, setMessage] = React.useState("");
  /** 视图态(不入快照):当前浏览的目录、内联输入、删除确认。 */
  const [view, setView] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ kind: "create" | "rename"; id?: string; value: string } | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<string | null>(null);
  /**
   * 刚上传的素材(乐观入列)。数据面 `assets-list` 的权威来自平台后端;后端未接时它恒回
   * `{ error:"platform_unavailable", items: [] }`,故上传结果先在本地可见,后端接上后
   * 由 route 返回的真实列表覆盖(按 attachmentId 去重)。
   */
  const [uploaded, setUploaded] = React.useState<readonly AssetItem[]>([]);
  const [busyUp, setBusyUp] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  // 权威态回流(选中 / 目录树 / 归属)——UI 只发命令,不直写。
  React.useEffect(
    () =>
      guest.surface.subscribe("surface:materials", (v) => {
        const s = (v ?? {}) as MaterialsSnapshot;
        if (Array.isArray(s.selectedIds)) {
          setPicked(new Set(s.selectedIds.filter((x): x is string => typeof x === "string")));
        }
        if (Array.isArray(s.folders)) setFolders(s.folders);
        if (s.itemFolder !== undefined && s.itemFolder !== null) setItemFolder(s.itemFolder);
      }),
    [guest],
  );

  const run = React.useCallback(
    async (action: string, args: unknown): Promise<void> => {
      try {
        await guest.surface.run("materials", action, args);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [guest],
  );

  const applyPicked = (next: ReadonlySet<string>): void => {
    setPicked(next);
    void run("select", { ids: [...next] });
  };
  const toggle = (attachmentId: string): void => {
    const next = new Set(picked);
    if (next.has(attachmentId)) next.delete(attachmentId);
    else next.add(attachmentId);
    applyPicked(next);
  };

  /**
   * 上传写-读回环:`guest.upload` 经宿主附件端口落库(大二进制走制品面,不进帧 R-0b)→
   * 得 attachmentId → 以引用走 `move-items` 登记进当前目录(控制面写)→ 本地乐观入列。
   */
  const uploadFiles = React.useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0) return;
      setBusyUp(true);
      const added: AssetItem[] = [];
      try {
        for (const file of files) {
          const r = await guest.upload(file);
          added.push({
            assetId: r.attachmentId,
            attachmentId: r.attachmentId,
            displayUrl: r.displayUrl,
            createdAt: "",
            meta: { name: file.name },
          });
        }
        if (added.length > 0) {
          setUploaded((prev) => [...added, ...prev]);
          if (view !== null && view !== "__none") {
            await run("move-items", { ids: added.map((a) => a.attachmentId as string), folderId: view });
          }
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyUp(false);
      }
    },
    [guest, run, view],
  );

  // 乐观项在前;route 返回同一 attachmentId 时以 route 为准(权威在数据面)。
  const seen = new Set(items.map((a) => a.attachmentId).filter((x): x is string => typeof x === "string"));
  const merged = [...uploaded.filter((a) => a.attachmentId === undefined || !seen.has(a.attachmentId)), ...items];

  // 当前目录过滤:null=全部;"__none"=未分类。
  const visible = merged.filter((a) => {
    if (view === null) return true;
    const id = a.attachmentId;
    if (id === undefined) return view === "__none";
    const owner = itemFolder[id];
    return view === "__none" ? owner === undefined : owner === view;
  });
  const selectable = visible.filter((a) => typeof a.attachmentId === "string");
  const allPicked = selectable.length > 0 && selectable.every((a) => picked.has(a.attachmentId as string));

  const bring = async (): Promise<void> => {
    const refs = [...picked];
    if (refs.length === 0) return;
    await guest.submitUserMessage(`带入对话(共 ${refs.length} 项制品)`, { attachmentIds: refs });
    applyPicked(new Set());
  };

  const submitDraft = (): void => {
    if (draft === null) return;
    const name = draft.value.trim();
    if (name === "") {
      setDraft(null);
      return;
    }
    if (draft.kind === "create") {
      void run("create-folder", { name, ...(view !== null && view !== "__none" ? { parentId: view } : {}) });
    } else if (draft.id !== undefined) {
      void run("rename-folder", { id: draft.id, name });
    }
    setDraft(null);
  };

  /** 拖放发端:多选时整批带走(受口按空白切分);单项另附 uri/名便于外部落点。 */
  const onDragStart = (e: React.DragEvent, asset: AssetItem): void => {
    const id = asset.attachmentId;
    if (id === undefined) return;
    const ids = picked.has(id) ? [...picked] : [id];
    e.dataTransfer.setData("text/att-id", ids.join(" "));
    if (ids.length === 1) {
      e.dataTransfer.setData("text/uri-list", asset.displayUrl);
      e.dataTransfer.setData("text/plain", asset.meta?.name ?? asset.assetId);
    }
    e.dataTransfer.effectAllowed = "copy";
  };

  const renderTree = (parentId: string | undefined, depth: number): React.JSX.Element[] =>
    childrenOf(folders, parentId).flatMap((f) => [
      <div key={f.id} className={view === f.id ? "tree-row on" : "tree-row"} style={{ paddingLeft: 8 + depth * 12 }}>
        {draft?.kind === "rename" && draft.id === f.id ? (
          <input
            className="grow"
            autoFocus
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            onBlur={submitDraft}
          />
        ) : (
          <>
            <button type="button" className="tree-name" onClick={() => setView(f.id)} title={f.name}>
              {f.name}
            </button>
            <button type="button" className="tree-act" title="改名" onClick={() => setDraft({ kind: "rename", id: f.id, value: f.name })}>
              ✎
            </button>
            <button
              type="button"
              className={confirmDel === f.id ? "tree-act danger" : "tree-act"}
              title={confirmDel === f.id ? "再点一次删除(含子目录)" : "删除"}
              onClick={() => {
                if (confirmDel === f.id) {
                  void run("delete-folder", { id: f.id });
                  setConfirmDel(null);
                  if (view === f.id) setView(null);
                } else setConfirmDel(f.id);
              }}
            >
              {confirmDel === f.id ? "确认?" : "✕"}
            </button>
          </>
        )}
      </div>,
      ...renderTree(f.id, depth + 1),
    ]);

  return (
    <div className="pane-layout">
      <div className="toolbar">
        <span className="muted grow">{picked.size > 0 ? `已选 ${picked.size}` : `${visible.length} 个素材`}</span>
        {picked.size > 0 ? (
          <select
            className="button"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              void run("move-items", { ids: [...picked], folderId: v === "__none" ? null : v });
            }}
          >
            <option value="">移入目录…</option>
            <option value="__none">移出目录</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="button"
          onClick={() => applyPicked(allPicked ? new Set() : new Set(selectable.map((a) => a.attachmentId as string)))}
        >
          {allPicked ? "清空" : "全选"}
        </button>
        <button type="button" className="button button-primary" disabled={picked.size === 0} onClick={() => void bring()}>
          带入对话
        </button>
        <button type="button" className="button" onClick={() => fileRef.current?.click()} disabled={busyUp}>
          {busyUp ? "上传中…" : "上传"}
        </button>
        <button type="button" className="button" onClick={() => void load()} disabled={phase === "busy"}>
          刷新
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="split">
        <aside className="side scroll">
          <div className={view === null ? "tree-row on" : "tree-row"}>
            <button type="button" className="tree-name" onClick={() => setView(null)}>
              全部素材
            </button>
          </div>
          <div className={view === "__none" ? "tree-row on" : "tree-row"}>
            <button type="button" className="tree-name" onClick={() => setView("__none")}>
              未分类
            </button>
          </div>
          {renderTree(undefined, 0)}
          {draft?.kind === "create" ? (
            <div className="tree-row">
              <input
                className="grow"
                autoFocus
                placeholder="目录名"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitDraft();
                  if (e.key === "Escape") setDraft(null);
                }}
                onBlur={submitDraft}
              />
            </div>
          ) : (
            <button type="button" className="tree-add" onClick={() => setDraft({ kind: "create", value: "" })}>
              ＋ 新建目录{view !== null && view !== "__none" ? "(在当前目录下)" : ""}
            </button>
          )}
        </aside>

        <div
          className="content scroll grow"
          style={{ minHeight: 0 }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files];
            if (files.length === 0) return;
            e.preventDefault();
            void uploadFiles(files);
          }}
        >
          {phase === "busy" ? <div className="empty">加载中…</div> : null}
          {phase === "error" ? <div className="empty error">{message}</div> : null}
          {phase === "done" && visible.length === 0 ? <div className="empty">此处暂无素材</div> : null}
          <div className="grid">
            {visible.map((a) => {
              const id = a.attachmentId;
              const on = id !== undefined && picked.has(id);
              return (
                <figure
                  key={a.assetId}
                  className={`card${on ? " on" : ""}`}
                  draggable={id !== undefined}
                  onDragStart={(e) => onDragStart(e, a)}
                  title={id !== undefined ? "可拖入对话输入框" : undefined}
                >
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
