/**
 * 贴纸 source 的画廊 pane 入口(spec panes-only-right-panel 任务 4.3)。
 *
 * ★ 插件在**构建期**与画布组件一起打包,不跨 realm 传递 —— pane 文档已是自足 bundle。
 * 命名空间必须与 source 标识一致:插件的工具/图层锚点都带这个前缀。
 */
import { mountCanvasPane } from "../../../aigc-canvas-agent/web/panes/canvas.js";
import { stickersBundle } from "../stickers.js";

mountCanvasPane([stickersBundle], "canvas-plugin-stickers");
