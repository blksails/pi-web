import { definePanes } from "@blksails/pi-web-panes-kit";
import { paneDocuments } from "../pane-documents.generated.js";
import { canvasPaneMeta } from "../../../aigc-canvas-agent/pane-meta.js";

/** 与 aigc-canvas 同一份 pane 元信息;差别只在文档里多打包了贴纸插件捆。 */
export const panesDefinition = definePanes({
  id: "canvas-plugin-stickers",
  initialPaneIds: ["canvas"],
  maxOpenPanes: 4,
  panes: [
    {
      ...canvasPaneMeta,
      document: { kind: "inline", srcDoc: paneDocuments.canvas },
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
