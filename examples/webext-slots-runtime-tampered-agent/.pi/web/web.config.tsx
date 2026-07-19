/** webext-slots-runtime-tampered-agent UI 扩展:与 webext-slots-runtime-agent 同构,dist 构建后被篡改(任务 6.4 降级验收)。 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

function Slot({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <div data-testid={`slot-${id}`} style={{ padding: "2px 6px", fontSize: 12 }}>
      {label}
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-slots-runtime-tampered",
  capabilities: ["slots", "config"],
  config: {
    documentTitle: "Slots Runtime Tampered · pi-web",
  },
  slots: {
    headerCenter: <Slot id="header-center" label="Header C" />,
    panelRight: <Slot id="panel-right" label="Panel Right" />,
  },
});
