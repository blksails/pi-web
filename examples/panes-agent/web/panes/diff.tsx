import * as React from "react";
import { Button, Notice, Spinner, Toolbar } from "./controls.js";
import { mountPane, usePaneApi, usePaneSnapshot } from "./pane-runtime.js";

interface DiffData { readonly revision: number; readonly files: ReadonlyArray<{ readonly path: string; readonly before: string; readonly after: string }> }

function DiffPane(): React.JSX.Element {
  const api = usePaneApi();
  const snapshot = usePaneSnapshot();
  const [data, setData] = React.useState<DiffData>();
  const [view, setView] = React.useState<"split" | "unified">("split");
  const [selected, setSelected] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const load = React.useCallback(() => api.query<DiffData>().then((next) => { setData(next); setSelected((current) => current ?? next.files[0]?.path); }).catch((cause: unknown) => setError(String(cause))), [api]);
  React.useEffect(() => { void load(); }, [load, snapshot?.revision]);
  const file = data?.files.find((item) => item.path === selected) ?? data?.files[0];
  return (
    <main className="pane-layout">
      <Toolbar>
        <select className="grow" value={file?.path ?? ""} onChange={(event) => setSelected(event.target.value)} disabled={!file}>{data?.files.map((item) => <option key={item.path}>{item.path}</option>)}</select>
        <div className="segmented" aria-label="Diff 布局"><Button aria-pressed={view === "split"} onClick={() => setView("split")}>并排</Button><Button aria-pressed={view === "unified"} onClick={() => setView("unified")}>统一</Button></div>
        <Button onClick={() => void load()}>刷新</Button>
      </Toolbar>
      <section className="content scroll">
        {data === undefined ? <div className="center"><Spinner /></div> : file === undefined ? <div className="empty">暂无改动</div> : view === "split" ? (
          <div className="diff-grid"><pre className="diff before"><code>{file.before}</code></pre><pre className="diff after"><code>{file.after}</code></pre></div>
        ) : <pre className="diff unified"><code>{file.before.split("\n").map((line, index) => <span className="removed" key={`b${index}`}>- {line}{"\n"}</span>)}{file.after.split("\n").map((line, index) => <span className="added" key={`a${index}`}>+ {line}{"\n"}</span>)}</code></pre>}
        {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      </section>
    </main>
  );
}

mountPane("diff", DiffPane);
