import { paneDocuments } from "../pane-documents.generated.js";
import { definePanes } from "@blksails/pi-web-panes-kit";
import { canvasPaneMeta } from "../../../aigc-canvas-agent/pane-meta.js";

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
  id: "canvas-plugin-stickers",
  initialPaneIds: ["canvas"],
  maxOpenPanes: 4,
  panes: [
    {
      ...canvasPaneMeta,
      document: inlineDoc("canvas"),
      lifecycle: { keepAlive: true, suspendWhenHidden: false },
      // ★ 插件贡献的命令需要**显式授予**:共享的 canvasPaneMeta 只列了内置动作,
      // 不含贴纸插件的 style-transfer。旧槽形态下面板走宿主访问器、不受 pane 白名单约束,
      // pane 形态下受约束 —— 这不是回归,是隔离模型本该有的行为:
      // 一个 source 带来的插件,其命令必须由该 source 的 pane 定义自己声明。
      capabilities: {
        ...canvasPaneMeta.capabilities,
        surfaceCommands: [
          {
            domain: "canvas",
            actions: [
              ...(canvasPaneMeta.capabilities?.surfaceCommands?.[0]?.actions ?? []),
              // ★ 命令名是 **style_transfer(下划线)** —— 插件里的 `id: "style-transfer"`
              // 是**动作的 UI 标识**(命名空间前缀后为 canvas-plugin-stickers:style-transfer),
              // 两者不是一回事。授错了的表现是:按钮在、点得动、命令发出去却没有任何回流。
              // 插件的 `match` 还用 `capability.actions.includes("style_transfer")` 做能力匹配,
              // 故授权名不对时该动作根本不会启用。
              "style_transfer",
            ],
          },
        ],
      },
    },
  ],
});
