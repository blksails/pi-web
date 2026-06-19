/** webext-layout-agent UI 扩展:Tier 1 区域插槽(panelRight / headerCenter)。 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

function InfoPanel(): React.JSX.Element {
  return (
    <div data-testid="layout-panel" style={{ padding: 12 }}>
      <h3>领域检视面板</h3>
      <p>webext-layout-agent 填充的 panelRight。</p>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-layout",
  capabilities: ["slots"],
  slots: {
    headerLeft: <span data-testid="layout-header-left">◧ Nav</span>,
    headerCenter: <span data-testid="layout-header">Layout Agent</span>,
    headerRight: <span data-testid="layout-header-right">Help ?</span>,
    panelRight: <InfoPanel />,
    footer: (
      <div data-testid="layout-footer" style={{ padding: 8, fontSize: 12 }}>
        webext-layout-agent footer
      </div>
    ),
  },
});
