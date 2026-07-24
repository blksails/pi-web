import * as React from "react";
import { Button, Dialog, Notice, Spinner, Toolbar } from "./controls.js";
import { mountPane, usePaneApi, usePaneSnapshot } from "./pane-runtime.js";

interface EditorData { readonly revision: number; readonly files: readonly string[]; readonly file: { readonly path: string; readonly content: string; readonly version: number } | null }

function EditorPane(): React.JSX.Element {
  const api = usePaneApi();
  const snapshot = usePaneSnapshot();
  const [data, setData] = React.useState<EditorData>();
  const [content, setContent] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [pendingPath, setPendingPath] = React.useState<string>();
  const [sidebarWidth, setSidebarWidth] = React.useState(228);
  const [sidebarVisible, setSidebarVisible] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [wrap, setWrap] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "ok" | "error" | "muted"; text: string }>({ tone: "muted", text: "就绪" });
  const load = React.useCallback(async (path?: string): Promise<void> => {
    try {
      const next = await api.query<EditorData>(path === undefined ? {} : { path });
      setData(next); setContent(next.file?.content ?? ""); setDirty(false); setNotice({ tone: "muted", text: `已同步 r${next.revision}` });
    } catch (cause) { setNotice({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) }); }
  }, [api]);
  React.useEffect(() => { if (data === undefined) void load(); }, [data, load]);
  React.useEffect(() => { if (snapshot !== undefined && data !== undefined && snapshot.revision !== data.revision && !dirty) void load(data.file?.path); }, [data, dirty, load, snapshot]);
  const selectPath = (path: string): void => { if (dirty) setPendingPath(path); else void load(path); };
  const save = async (): Promise<void> => {
    if (data?.file === null || data?.file === undefined) return;
    try {
      const result = await api.mutate<{ revision: number }>("write-file", { path: data.file.path, content }, data.revision);
      setData({ ...data, revision: result.revision, file: { ...data.file, content, version: data.file.version + 1 } });
      setDirty(false); setNotice({ tone: "ok", text: `已保存 r${result.revision}` });
    } catch (cause) { setNotice({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) }); }
  };
  const editor = <div className="editor-shell"><div className="change-bar" /><div className="line-numbers" aria-hidden="true">{content.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}</div><textarea className="editor" style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }} spellCheck={false} value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} /></div>;
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (next: PointerEvent): void => setSidebarWidth(Math.max(170, Math.min(420, startWidth + startX - next.clientX)));
    const end = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
  };
  const confirmDialog = <Dialog title="放弃未保存更改？" open={pendingPath !== undefined} onClose={() => setPendingPath(undefined)} actions={<><Button onClick={() => setPendingPath(undefined)}>继续编辑</Button><Button tone="danger" onClick={() => { const path = pendingPath; setPendingPath(undefined); if (path !== undefined) void load(path); }}>放弃并切换</Button></>}>
    当前文件有未保存内容，切换文件会丢弃本地草稿。
  </Dialog>;
  if (data === undefined) return <main className="center"><Spinner /></main>;
  if (api.interactionMode === "advanced") return (
    <main className="pane-layout ide">
      <div className="ide-tabs">
        <button className="ide-tab active"><span>▣</span>{data.file?.path.split("/").pop() ?? "编辑器"}{dirty ? <i>●</i> : <span>×</span>}</button>
        <button className="ide-tab add" aria-label="选择文件" onClick={() => setMenuOpen((open) => !open)}>+</button>
      </div>
      <div className="ide-toolbar">
        <div className="menu-anchor"><Button onClick={() => setMenuOpen((open) => !open)}>视图⌄</Button>{menuOpen ? <div className="ide-menu" role="menu"><button role="menuitem" onClick={() => { setSidebarVisible((visible) => !visible); setMenuOpen(false); }}>文件树 <kbd>Ctrl+P</kbd></button><button role="menuitem" onClick={() => { setWrap((value) => !value); setMenuOpen(false); }}>自动换行 <kbd>Alt+Z</kbd></button><button role="menuitem" onClick={() => { void save(); setMenuOpen(false); }}>保存 <kbd>Ctrl+S</kbd></button></div> : null}</div>
        <span className="revision">r{data.revision}</span><span className="delta">+{content.split("\n").length}</span><span className="delta minus">-{data.file?.version ?? 0}</span>
        <span className="grow" />{dirty ? <span className="badge warning">未保存</span> : null}<Button tone="primary" disabled={!dirty} onClick={() => void save()}>提交或推送⌄</Button>
      </div>
      <div className="breadcrumb">⚛ <span>{data.file?.path ?? "未选择文件"}</span></div>
      <div className="ide-body">
        <section className="ide-main">{editor}</section>
        {sidebarVisible ? <><div className="split-handle" role="separator" aria-orientation="vertical" aria-label="调整文件树宽度" onPointerDown={startResize} /><aside className="file-tree" style={{ width: sidebarWidth }}><input className="tree-filter" placeholder="筛选文件…" aria-label="筛选文件" /><div className="tree"><strong>⌄ examples</strong><div className="tree-indent"><strong>⌄ panes-agent</strong><div className="tree-indent">{data.files.map((path) => <button key={path} aria-current={path === data.file?.path} onClick={() => selectPath(path)}><span>{path.endsWith(".ts") || path.endsWith(".tsx") ? "⚛" : "◇"}</span>{path}<i>{path === data.file?.path && dirty ? "●" : ""}</i></button>)}</div></div></div></aside></> : null}
      </div>
      <Notice tone={notice.tone}>{notice.text}</Notice>
      {confirmDialog}
    </main>
  );
  return (
    <main className="pane-layout">
      <Toolbar>
        <select className="grow" value={data.file?.path ?? ""} onChange={(event) => selectPath(event.target.value)} aria-label="当前文件">{data.files.map((path) => <option key={path}>{path}</option>)}</select>
        {dirty ? <span className="badge warning">未保存</span> : null}
        <Button tone="primary" disabled={!dirty} onClick={() => void save()}>保存</Button>
      </Toolbar>
      {editor}
      <Notice tone={notice.tone}>{notice.text}</Notice>
      {confirmDialog}
    </main>
  );
}

mountPane("editor", EditorPane);
