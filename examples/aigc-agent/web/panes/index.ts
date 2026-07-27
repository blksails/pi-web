/**
 * aigc 隔离 pane 工作区定义(Wave 5 · 6.1 隔离形态:搜索 / 素材 / 画布三域)。
 *
 * 与 React 无涉,node 测试可直接消费。capability 即授权白名单:宿主 PanesHost 按此逐请求
 * 校验,越权即拒。srcDoc 由 build.ts 从 web/panes/<id>.tsx 打成自含 HTML(严格 CSP)。
 */
import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";

export const aigcPanesDefinition = definePanes({
  id: "aigc-panes",
  panes: [
    {
      id: "search",
      title: "搜图",
      icon: "⌕",
      document: { kind: "inline", srcDoc: paneDocuments.search },
      capabilities: {
        routes: [{ name: "creative-search", methods: ["POST"] }],
      },
    },
    {
      id: "materials",
      title: "素材",
      icon: "▦",
      document: { kind: "inline", srcDoc: paneDocuments.materials },
      capabilities: {
        routes: [{ name: "assets-list", methods: ["GET"] }],
        surfaceKeys: ["surface:materials"],
        // 授权面须覆盖 guest 实际会发的每条命令 —— 白名单外的一律被 PanesHost 逐请求拒掉。
        // 目录树(建/改名/移动/删)、素材归类与素材改名都在控制面,故一并授权。
        surfaceCommands: [
          {
            domain: "materials",
            actions: [
              "select",
              "set-filter",
              "create-folder",
              "rename-folder",
              "move-folder",
              "delete-folder",
              "move-items",
              "rename-item",
            ],
          },
        ],
        // 素材上传经宿主附件端口落库(大二进制走制品面,不进帧)。
        attachments: "read-write",
        conversation: "submit",
      },
    },
    {
      id: "canvas",
      title: "画布",
      icon: "◇",
      document: { kind: "inline", srcDoc: paneDocuments.canvas },
      // 授权面照 examples/panes-agent canvasPaneMeta(F3 已验):A 档命令全集 + 附件读写 + 直送。
      capabilities: {
        surfaceKeys: ["surface:canvas"],
        surfaceCommands: [
          {
            domain: "canvas",
            actions: ["sync", "register", "edit", "inpaint", "reference", "variants", "outpaint", "reframe", "delete"],
          },
        ],
        attachments: "read-write",
        conversation: "submit",
      },
    },
  ],
});
