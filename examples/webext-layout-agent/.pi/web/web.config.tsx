/** webext-layout-agent UI 扩展:Tier 1 区域插槽(sidebarLeft / headerCenter)。 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

function InfoPanel(): React.JSX.Element {
  return (
    <div data-testid="layout-panel" style={{ padding: 12 }}>
      <h3>领域检视面板</h3>
      <p>webext-layout-agent 填充的 sidebarLeft。</p>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-layout",
  capabilities: ["slots", "config"],
  // ★ 本夹具原挂右侧面板槽;该槽随 spec panes-only-right-panel 废弃,故改挂 sidebarLeft。
  // 它守的是**区域插槽机制本身**(声明即渲染),与面板形态无关 —— 换个槽承载,保护面不变。
  // panelRatio 一并去掉:那是右侧面板专有的配置,槽换了它就没有意义了。
  slots: {
    headerLeft: <span data-testid="layout-header-left">◧ Nav</span>,
    headerCenter: <span data-testid="layout-header">Layout Agent</span>,
    headerRight: <span data-testid="layout-header-right">Help ?</span>,
    sidebarLeft: <InfoPanel />,
    footer: (
      <div data-testid="layout-footer" style={{ padding: 8, fontSize: 12 }}>
        webext-layout-agent footer
      </div>
    ),
  },
});
