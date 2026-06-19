/** webext-renderer-agent UI 扩展:Tier 2 自定义 data-part 渲染器。 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

function MetricRenderer({ part }: { part: { data?: unknown } }): React.JSX.Element {
  const data = (part.data ?? {}) as { label?: string; value?: number };
  return (
    <div data-testid="metric-card" style={{ padding: 8, border: "1px solid #ddd" }}>
      <strong>{data.label ?? "metric"}</strong>: <span>{data.value ?? 0}</span>
    </div>
  );
}

/** Tier2 自定义 tool 渲染器(R8):命中 `tool-echo` part 时由本渲染器渲染。 */
function EchoToolRenderer(): React.JSX.Element {
  return (
    <div data-testid="echo-tool-card" style={{ padding: 8, border: "1px solid #7c3aed", borderRadius: 6 }}>
      🔧 扩展自定义 echo 工具渲染器(webext-renderer)
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-renderer",
  capabilities: ["renderers"],
  renderers: {
    dataParts: {
      // 命中 message 的 `data-metric` part 时由本渲染器渲染。
      "data-metric": MetricRenderer as never,
    },
    tools: {
      // 命中 `tool-echo`(stub 每轮发 echo 工具)时由本渲染器渲染。
      echo: EchoToolRenderer as never,
    },
  },
});
