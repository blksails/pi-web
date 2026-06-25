/** webext-runtime-code-agent UI 扩展:Tier1 slot 代码组件(运行时加载验收)。 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

function RuntimeCodePanel(): React.JSX.Element {
  return (
    <div data-testid="runtime-code-panel" style={{ padding: 12 }}>
      <h3>运行时代码 webext</h3>
      <p>本面板由动态加载的签名 .mjs 渲染(import map 单例)。</p>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-runtime-code",
  capabilities: ["slots"],
  slots: {
    headerCenter: (
      <span data-testid="runtime-code-header">Runtime Code Agent</span>
    ),
    panelRight: <RuntimeCodePanel />,
  },
});
