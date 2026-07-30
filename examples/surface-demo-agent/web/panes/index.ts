import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";

export const panesDefinition = definePanes({
  id: "surface-demo",
  initialPaneIds: ["demo"],
  panes: [
    {
      id: "demo",
      title: "Demo Surface",
      document: { kind: "inline", srcDoc: paneDocuments.demo },
      capabilities: {
        // 读该 domain 的权威快照 + 执行 increment 命令。逐项授予,不多给。
        surfaceKeys: ["surface:demo"],
        surfaceCommands: [{ domain: "demo", actions: ["increment"] }],
      },
    },
  ],
});
