import * as React from "react";
import { Button, Dialog, Notice, Spinner, Toolbar } from "./controls.js";
import { mountPane, usePaneApi, usePaneSnapshot } from "./pane-runtime.js";

interface CanvasData {
  readonly revision: number;
  readonly shapes: ReadonlyArray<{ readonly id: string; readonly kind: "circle" | "rect"; readonly x: number; readonly y: number; readonly color: string }>;
  readonly attachments: ReadonlyArray<{ readonly attachmentId: string; readonly name: string }>;
}

const COLORS = ["#2563eb", "#7c3aed", "#059669", "#ea580c"] as const;

function CanvasPane(): React.JSX.Element {
  const api = usePaneApi();
  const snapshot = usePaneSnapshot();
  const [data, setData] = React.useState<CanvasData>();
  const [kind, setKind] = React.useState<"circle" | "rect">("circle");
  const [color, setColor] = React.useState<string>(COLORS[0]);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "muted" | "ok" | "error"; text: string }>({ tone: "muted", text: "点击画布添加图形" });
  const load = React.useCallback(() => api.query<CanvasData>().then(setData).catch((cause: unknown) => setNotice({ tone: "error", text: String(cause) })), [api]);
  React.useEffect(() => { void load(); }, [load, snapshot?.revision]);
  const mutate = async (operation: string, payload: Record<string, unknown>): Promise<void> => {
    try { await api.mutate(operation, payload, data?.revision); await load(); }
    catch (cause) { setNotice({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) }); }
  };
  const onStageClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * 640 / rect.width;
    const y = (event.clientY - rect.top) * 360 / rect.height;
    void mutate("add-shape", { x, y, color, kind });
  };
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; event.target.value = ""; if (file === undefined) return;
    try {
      const uploaded = await api.attach(file);
      await api.mutate("link-attachment", { attachmentId: uploaded.attachmentId, name: file.name }, data?.revision);
      setNotice({ tone: "ok", text: `${file.name} 已落库为附件引用` }); await load();
    } catch (cause) { setNotice({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) }); }
  };
  return (
    <main className="pane-layout">
      <Toolbar>
        <div className="segmented"><Button aria-pressed={kind === "circle"} onClick={() => setKind("circle")}>圆形</Button><Button aria-pressed={kind === "rect"} onClick={() => setKind("rect")}>矩形</Button></div>
        <div className="swatches" aria-label="颜色">{COLORS.map((item) => <button key={item} className="swatch" aria-label={item} aria-pressed={color === item} style={{ background: item }} onClick={() => setColor(item)} />)}</div>
        <label className="button">导入图片<input hidden type="file" accept="image/*" onChange={(event) => void onFile(event)} /></label>
        <Button tone="danger" disabled={!data?.shapes.length} onClick={() => setConfirmClear(true)}>清空</Button>
      </Toolbar>
      <section className="canvas-wrap">{data === undefined ? <Spinner /> : <svg className="stage" viewBox="0 0 640 360" onClick={onStageClick} role="application" aria-label="画布">{data.shapes.map((shape) => shape.kind === "rect" ? <rect key={shape.id} x={shape.x - 22} y={shape.y - 16} width="44" height="32" rx="6" fill={shape.color} /> : <circle key={shape.id} cx={shape.x} cy={shape.y} r="19" fill={shape.color} />)}</svg>}</section>
      <Notice tone={notice.tone}>{notice.text}{data?.attachments.length ? ` · ${data.attachments.length} 个附件` : ""}</Notice>
      <Dialog title="清空画布？" open={confirmClear} onClose={() => setConfirmClear(false)} actions={<><Button onClick={() => setConfirmClear(false)}>取消</Button><Button tone="danger" onClick={() => { setConfirmClear(false); void mutate("clear-canvas", {}); }}>确认清空</Button></>}>
        此操作会创建一个新修订，其他 Pane 会立即收到 Surface 摘要。
      </Dialog>
    </main>
  );
}

mountPane("canvas", CanvasPane);
