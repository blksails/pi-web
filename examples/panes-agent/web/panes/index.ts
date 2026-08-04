import { paneDocuments } from "../pane-documents.generated.js";
import { definePanes } from "@blksails/pi-web-panes-kit";
import {
  artifactPaneMeta,
  canvasPaneMeta,
  diffPaneMeta,
  editorPaneMeta,
  filesPaneMeta,
} from "../../pane-meta.js";

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
  id: "panes-example",
  initialPaneIds: ["editor", "files", "canvas"],
  maxOpenPanes: 12,
  panes: [
    { ...filesPaneMeta, document: inlineDoc("files"), lifecycle: {} },
    { ...editorPaneMeta, document: inlineDoc("editor"), lifecycle: {} },
    { ...diffPaneMeta, document: inlineDoc("diff"), lifecycle: {} },
    { ...canvasPaneMeta, document: inlineDoc("canvas"), lifecycle: {} },
    { ...artifactPaneMeta, document: inlineDoc("artifact"), lifecycle: {} },
  ],
});
