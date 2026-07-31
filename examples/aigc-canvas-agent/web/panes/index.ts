/**
 * pane 定义汇总:元信息(`pane-meta.ts`,与 agent 侧同源)+ web 侧才有的 document/lifecycle。
 *
 * `paneDocuments` 由 `build.ts` 用 esbuild 打出、以 `pane-documents.generated.ts` 落盘,
 * 构建结束即删(仅 `.d.ts` 垫片入库)。**不要把生成物提交进仓** —— 那正是本会话反复踩到的
 * 「本地绿是因为工作树里躺着没人生成的产物」那类坑。
 */
import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";
import { canvasPaneMeta } from "../../pane-meta.js";

export const panesDefinition = definePanes({
  id: "aigc-canvas",
  // 画廊就是这个 agent 的主界面,开箱即在。
  initialPaneIds: ["canvas"],
  maxOpenPanes: 4,
  panes: [
    {
      ...canvasPaneMeta,
      document: { kind: "inline", srcDoc: paneDocuments.canvas },
      // 画廊持有 surface 订阅与本地工作台状态,隐藏时保活;重建代价远高于驻留代价。
      lifecycle: { keepAlive: true, suspendWhenHidden: false },
    },
  ],
});
