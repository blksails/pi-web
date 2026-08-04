import { paneDocuments } from "../pane-documents.generated.js";
/**
 * pane 定义汇总:元信息(`pane-meta.ts`,与 agent 侧同源)+ web 侧才有的 document/lifecycle。
 *
 * `paneDocuments` 由 `build.ts` 用 esbuild 打出、以 `pane-documents.generated.ts` 落盘,
 * 构建结束即删(仅 `.d.ts` 垫片入库)。**不要把生成物提交进仓** —— 那正是本会话反复踩到的
 * 「本地绿是因为工作树里躺着没人生成的产物」那类坑。
 */
import { definePanes } from "@blksails/pi-web-panes-kit";
import { canvasPaneMeta } from "../../pane-meta.js";

/**
 * pane 文档用**内联**形态（`{kind:"inline", srcDoc}`）：`pi-web build` 在 webext 打包
 * **之前**把各 pane 的自足 HTML 落成 `web/pane-documents.generated.ts`（构建产物，
 * 已被 .gitignore 排除），故此处静态 import 恒可解析。
 *
 * ★ 不用 `{kind:"html", src:"pane-<id>.html"}`：那是**相对路径**，而这些示例走宿主的
 * 构建期静态集成车道，PanesHost 会把 src 原样交给 iframe（无 baseUrl 拼接），最终相对
 * 宿主页面解析成 `http://<host>/pane-<id>.html` → 404、面板空白。
 */
const inlineDoc = (paneId: keyof typeof paneDocuments) =>
  ({ kind: "inline", srcDoc: paneDocuments[paneId] }) as const;

export const panesDefinition = definePanes({
  id: "aigc-canvas",
  // 画廊就是这个 agent 的主界面,开箱即在。
  initialPaneIds: ["canvas"],
  maxOpenPanes: 4,
  panes: [
    {
      ...canvasPaneMeta,
      document: inlineDoc("canvas"),
      // 画廊持有 surface 订阅与本地工作台状态,隐藏时保活;重建代价远高于驻留代价。
      lifecycle: { keepAlive: true, suspendWhenHidden: false },
    },
  ],
});
