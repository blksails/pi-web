/** build 集成测试 fixture:一个最小 WebExtension(react + web-kit 均 external)。 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

function Panel(): React.JSX.Element {
  return <div className="pw-ext-a-panel">hello from ext-a</div>;
}

export default defineWebExtension({
  manifestId: "ext-a",
  slots: { panelRight: <Panel /> },
  capabilities: ["slots"],
});
