/**
 * surface-demo-agent UI 扩展:agent 权威 surface(agent-authoritative-surface)的「人侧」面板。
 *
 * panelRight 槽渲染 domain="demo" 的权威快照 `{ count, log }`,并提供按钮触发命令:
 *  - 镜像:经宿主注入的 `surface.getState("surface:demo")` + `surface.subscribe(...)` 读快照
 *    (下行 control:"state" 帧,与 agent 命令内 `ctx.setState` 读写同一份权威态);
 *  - 命令:点击 → `surface.run("demo", "increment")` → ui-rpc agent 转发 → 子进程 wireSurfaceBridge
 *    派发 → 快照回流镜像 → 视图计数更新(命令不过 LLM);
 *  - 退化:`surface === undefined`(会话未就绪)或 `surface.hasCommand("surface:demo") === false`
 *    (非该 domain 的 source)→ 只读、不发命令、不报错。
 *
 * slot 组件是独立 bundle,故经 prop 注入 `surface`(WebExtSurfaceAccess,web-kit 不依赖 react,
 * 是 useSurface 在 slot 侧的等价接入)。宿主对 `domain`/快照值不透明(领域无关搬运)。
 */
import * as React from "react";
import { defineWebExtension, type WebExtSurfaceAccess } from "@blksails/pi-web-kit";

interface DemoSnapshot {
  count: number;
  log: string[];
}

const DOMAIN = "demo";
const STATE_KEY = `surface:${DOMAIN}`;
const PROBE = `surface:${DOMAIN}`;

function SurfaceDemoPanel({
  surface,
}: {
  extId: string;
  surface?: WebExtSurfaceAccess;
}): React.JSX.Element {
  const [snap, setSnap] = React.useState<DemoSnapshot | undefined>(() =>
    surface?.getState<DemoSnapshot>(STATE_KEY),
  );
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (surface === undefined) return;
    setSnap(surface.getState<DemoSnapshot>(STATE_KEY));
    return surface.subscribe(STATE_KEY, (v) => setSnap(v as DemoSnapshot | undefined));
  }, [surface]);

  // 能力退化:无接入或探针缺失(非该 domain 的 source)→ 只读。
  const available = surface !== undefined && surface.hasCommand(PROBE);
  const count = snap?.count ?? 0;

  const increment = React.useCallback(() => {
    if (surface === undefined || !available) return;
    setPending(true);
    void surface
      .run(DOMAIN, "increment")
      .finally(() => setPending(false));
  }, [surface, available]);

  return (
    <div
      data-testid="surface-demo-panel"
      data-surface-available={String(available)}
      style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>Agent 权威 surface · demo</div>
      <div data-testid="surface-demo-count" style={{ fontSize: 28, fontWeight: 700 }}>
        {snap === undefined ? "—" : count}
      </div>
      {available ? (
        <button
          type="button"
          data-testid="surface-demo-increment"
          disabled={pending}
          onClick={increment}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          increment(命令)
        </button>
      ) : (
        <div data-testid="surface-demo-degraded" style={{ fontSize: 12, opacity: 0.6 }}>
          surface 不可用 · 只读(该 source 未提供 demo surface)
        </div>
      )}
      {snap !== undefined && snap.log.length > 0 ? (
        <ul data-testid="surface-demo-log" style={{ fontSize: 12, opacity: 0.8, margin: 0 }}>
          {snap.log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default defineWebExtension({
  manifestId: "surface-demo",
  capabilities: ["slots"],
  slots: {
    panelRight: SurfaceDemoPanel,
  },
});
