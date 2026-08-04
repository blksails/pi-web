import { paneDocuments } from "../pane-documents.generated.js";
import { definePanes } from "@blksails/pi-web-panes-kit";

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

/**
 * pane 文档现由 `pi-web build` 统一产出为可寻址的 URL 形态资产(`pane-<id>.html`,
 * 与本 webext 产物同处一个 `outDir`,spec cli-agent-build 任务 5.1 迁移)——不再依赖
 * 构建期生成、构建后即删的 `pane-documents.generated.ts` 模块。
 */
export const panesDefinition = definePanes({
  id: "state-bridge",
  initialPaneIds: ["count"],
  panes: [
    {
      id: "count",
      title: "共享状态",
      document: inlineDoc("count"),
      capabilities: {
        // ★ 读写分离在这里第一次被真实使用:该 pane 既读也写同一个键,
        // 故两张表都要列上 —— 只列 read 的话按钮点了会被拒。
        state: { read: ["count"], write: ["count"] },
      },
    },
  ],
});
