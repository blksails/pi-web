import * as React from "react";
import { Button, Dialog, Notice, Spinner, Toolbar } from "./controls.js";
import { mountPane, usePaneApi, usePaneSnapshot } from "./pane-runtime.js";

interface FilesData { readonly revision: number; readonly files: ReadonlyArray<{ readonly path: string; readonly version: number }> }

function FilesPane(): React.JSX.Element {
  const api = usePaneApi();
  const snapshot = usePaneSnapshot();
  const [data, setData] = React.useState<FilesData>();
  const [query, setQuery] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [path, setPath] = React.useState("");
  const [error, setError] = React.useState<string>();
  const load = React.useCallback(() => api.query<FilesData>().then(setData).catch((cause: unknown) => setError(String(cause))), [api]);
  React.useEffect(() => { void load(); }, [load, snapshot?.revision]);
  const files = data?.files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  const create = async (): Promise<void> => {
    try {
      await api.mutate("add-file", { path }, data?.revision);
      setPath(""); setDialogOpen(false); setError(undefined); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <main className="pane-layout">
      <Toolbar>
        <input className="grow" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选文件…" aria-label="筛选文件" />
        <Button tone="primary" onClick={() => setDialogOpen(true)}>新建</Button>
      </Toolbar>
      <section className="content scroll">
        {data === undefined ? <div className="center"><Spinner /></div> : files.length === 0 ? <div className="empty">没有匹配文件</div> : (
          <div className="list">{files.map((file) => <article className="list-row" key={file.path}><span className="file-icon">◇</span><strong className="grow">{file.path}</strong><span className="badge">v{file.version}</span></article>)}</div>
        )}
        {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      </section>
      <Dialog title="新建文件" open={dialogOpen} onClose={() => setDialogOpen(false)} actions={<><Button onClick={() => setDialogOpen(false)}>取消</Button><Button tone="primary" disabled={path.trim() === ""} onClick={() => void create()}>创建</Button></>}>
        <label className="field"><span>相对路径</span><input autoFocus value={path} onChange={(event) => setPath(event.target.value)} placeholder="notes/idea.md" onKeyDown={(event) => { if (event.key === "Enter") void create(); }} /></label>
      </Dialog>
    </main>
  );
}

mountPane("files", FilesPane);
