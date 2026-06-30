/**
 * state-bridge-agent UI 扩展:状态注入桥(state-injection-bridge)的「人侧」面板。
 *
 * panelRight 槽渲染共享状态 `count` 的当前值,并提供按钮经写回端点 +1。它与 agent 的
 * `increment` 工具读写**同一份**会话级状态(context 外):工具写 → 此处实时更新;此处点击 →
 * 工具下次 `read_state` 读到新值。这就是「人机共驾」。
 *
 * 宿主经 prop 注入 `state`(WebExtStateAccess):读 `state.get(key)`、订阅 `state.subscribe`、
 * 写回 `state.set(key,value)`。slot 组件是独立打包 bundle,故经 prop 注入(非 React context)。
 */
import * as React from "react";
import { defineWebExtension, type WebExtStateAccess } from "@blksails/pi-web-kit";

function CountPanel({ state }: { extId: string; state?: WebExtStateAccess }): React.JSX.Element {
  const [count, setCount] = React.useState<number | undefined>(() =>
    state?.get<number>("count"),
  );
  React.useEffect(() => {
    if (state === undefined) return;
    setCount(state.get<number>("count"));
    return state.subscribe("count", (v) => setCount(v as number | undefined));
  }, [state]);

  return (
    <div
      data-testid="state-bridge-panel"
      style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>共享状态 · count</div>
      <div data-testid="state-bridge-count" style={{ fontSize: 28, fontWeight: 700 }}>
        {count ?? "—"}
      </div>
      <button
        type="button"
        data-testid="state-bridge-increment"
        onClick={() => {
          void state?.set("count", (typeof count === "number" ? count : 0) + 1);
        }}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid hsl(var(--border))",
          background: "hsl(var(--muted))",
          cursor: "pointer",
        }}
      >
        +1（写回）
      </button>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "state-bridge",
  capabilities: ["slots"],
  slots: {
    panelRight: CountPanel,
  },
});
