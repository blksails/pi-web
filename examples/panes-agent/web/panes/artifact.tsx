import * as React from "react";
import { Button, Dialog, Notice, Spinner, Toolbar } from "./controls.js";
import { mountPane, usePaneApi, usePaneSnapshot } from "./pane-runtime.js";

type ArtifactStatus = "draft" | "review" | "published";
interface ArtifactItem { readonly id: string; readonly title: string; readonly body: string; readonly status: ArtifactStatus; readonly updatedAt: string }
interface ArtifactData { readonly revision: number; readonly artifacts: readonly ArtifactItem[] }

const STATUS_LABEL: Record<ArtifactStatus, string> = { draft: "草稿", review: "待审核", published: "已发布" };

function ArtifactPane(): React.JSX.Element {
  const api = usePaneApi();
  const snapshot = usePaneSnapshot();
  const [data, setData] = React.useState<ArtifactData>();
  const [selectedId, setSelectedId] = React.useState<string>();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string>();
  const load = React.useCallback(() => api.query<ArtifactData>().then((next) => { setData(next); setSelectedId((current) => current ?? next.artifacts[0]?.id); }).catch((cause: unknown) => setError(String(cause))), [api]);
  React.useEffect(() => { void load(); }, [load, snapshot?.revision]);
  const selected = data?.artifacts.find((item) => item.id === selectedId) ?? data?.artifacts[0];
  const create = async (): Promise<void> => {
    try { const result = await api.mutate<{ artifactId: string }>("create-artifact", { title, body }, data?.revision); setDialogOpen(false); setTitle(""); setBody(""); setSelectedId(result.artifactId); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const transition = async (status: ArtifactStatus): Promise<void> => {
    if (selected === undefined) return;
    try { await api.mutate("set-artifact-status", { artifactId: selected.id, status }, data?.revision); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <main className="pane-layout">
      <Toolbar><strong className="grow">Artifact</strong><span className="badge">{data?.artifacts.length ?? 0}</span><Button tone="primary" onClick={() => setDialogOpen(true)}>新建</Button></Toolbar>
      {data === undefined ? <div className="center"><Spinner /></div> : data.artifacts.length === 0 ? <div className="empty">暂无 Artifact，创建一个可审核和发布的内容卡片。</div> : (
        <div className="artifact-grid">
          <aside className="artifact-list scroll">{data.artifacts.map((item) => <button key={item.id} className="artifact-nav" aria-current={item.id === selected?.id} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><span className={`status status-${item.status}`}>{STATUS_LABEL[item.status]}</span></button>)}</aside>
          {selected === undefined ? null : <article className="artifact-preview"><div className="artifact-paper"><span className={`status status-${selected.status}`}>{STATUS_LABEL[selected.status]}</span><h1>{selected.title}</h1><p>{selected.body}</p><small>更新于 {selected.updatedAt}</small></div><footer className="artifact-actions"><Button disabled={selected.status === "draft"} onClick={() => void transition("draft")}>退回草稿</Button><Button disabled={selected.status === "review"} onClick={() => void transition("review")}>提交审核</Button><Button tone="primary" disabled={selected.status === "published"} onClick={() => void transition("published")}>发布</Button></footer></article>}
        </div>
      )}
      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      <Dialog title="新建 Artifact" open={dialogOpen} onClose={() => setDialogOpen(false)} actions={<><Button onClick={() => setDialogOpen(false)}>取消</Button><Button tone="primary" disabled={title.trim() === "" || body.trim() === ""} onClick={() => void create()}>创建草稿</Button></>}>
        <label className="field"><span>标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field"><span>内容</span><textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      </Dialog>
    </main>
  );
}

mountPane("artifact", ArtifactPane);
