import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";
import { canvasPaneMeta } from "../../../aigc-canvas-agent/pane-meta.js";

/**
 * 与 aigc-canvas 同一份 pane 元信息与同一个 guest 入口 —— 差异**只在 agent 侧**
 * (index.ts 不装 canvas surface 扩展)。这正是本示例要验的:同样的面板,
 * 在没有对应权威表面时退化为只读图库,而不是崩溃或空白。
 */
export const panesDefinition = definePanes({
  id: "aigc-canvas-nosurface",
  initialPaneIds: ["canvas"],
  maxOpenPanes: 4,
  panes: [
    {
      ...canvasPaneMeta,
      document: { kind: "inline", srcDoc: paneDocuments.canvas },
      lifecycle: { keepAlive: true, suspendWhenHidden: false },
    },
  ],
});
