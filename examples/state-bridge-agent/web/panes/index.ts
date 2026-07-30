import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";

export const panesDefinition = definePanes({
  id: "state-bridge",
  initialPaneIds: ["count"],
  panes: [
    {
      id: "count",
      title: "共享状态",
      document: { kind: "inline", srcDoc: paneDocuments.count },
      capabilities: {
        // ★ 读写分离在这里第一次被真实使用:该 pane 既读也写同一个键,
        // 故两张表都要列上 —— 只列 read 的话按钮点了会被拒。
        state: { read: ["count"], write: ["count"] },
      },
    },
  ],
});
