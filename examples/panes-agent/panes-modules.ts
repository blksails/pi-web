/**
 * pane ↔ 自带 tools/routes 的绑定声明(spec isolated-panes「pane 自带 tools」模式)。
 *
 * 每个 pane 一个 `PaneAgentModule`:元信息 + 该 pane 的 extensions + routes。agent 入口
 * 只 `composePaneAgentModules(paneModules)` 一次,新增 pane 加一行,无需再去适配
 * extensions/routes 清单;capability 声明的 route 未被提供会在装配时抛错。
 */
import {
  aigcExtension,
  canvasSurfaceExtension,
  visionExtension,
  type PaneAgentModule,
} from "@blksails/pi-web-tool-kit/runtime";
import { panesSurfaceExtension } from "./panes-extension.js";
import { paneDataRoute } from "./routes/pane-data.js";
import {
  artifactPaneMeta,
  canvasPaneMeta,
  diffPaneMeta,
  editorPaneMeta,
  filesPaneMeta,
  type PaneMeta,
} from "./pane-meta.js";

/** 数据类 pane 共用 panes surface 与 pane-data route(composer 恒等去重,只装一次)。 */
const dataPane = (pane: PaneMeta): PaneAgentModule => ({
  pane,
  extensions: [panesSurfaceExtension],
  routes: [paneDataRoute],
});

export const paneModules: readonly PaneAgentModule[] = [
  dataPane(filesPaneMeta),
  dataPane(editorPaneMeta),
  dataPane(diffPaneMeta),
  dataPane(artifactPaneMeta),
  // Canvas pane 自带其域工具:AAS surface + 图像生成/编辑 + 视觉。
  { pane: canvasPaneMeta, extensions: [canvasSurfaceExtension, aigcExtension, visionExtension] },
];
