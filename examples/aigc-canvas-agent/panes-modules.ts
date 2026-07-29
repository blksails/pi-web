/**
 * pane ↔ 自带 tools/routes 的绑定声明(spec isolated-panes「pane 自带 tools」模式)。
 *
 * 迁移前 `index.ts` 是三个扩展平铺 + routes 另列一处:pane 声明了什么、agent 装了什么,
 * 靠人肉对齐。现在两者绑成一个 `PaneAgentModule`,`composePaneAgentModules` 在**装配期**
 * 校验覆盖 —— canvas pane 授予 `gallery-stats`,就必须有模块提供它。
 */
import {
  aigcExtension,
  canvasSurfaceExtension,
  visionExtension,
  type PaneAgentModule,
} from "@blksails/pi-web-tool-kit/runtime";
import { canvasPaneMeta } from "./pane-meta.js";
import { galleryStatsRoute } from "./routes/gallery-stats.js";

export const paneModules: readonly PaneAgentModule[] = [
  {
    pane: canvasPaneMeta,
    // Canvas pane 自带其域全部工具:AAS surface + 图像生成/编辑 + 视觉识别。
    extensions: [canvasSurfaceExtension, aigcExtension, /* visionExtension */],
    // 该 pane 自带的声明式 HTTP route(与 pane-meta 的 routes 授予一一对应)。
    routes: [galleryStatsRoute],
  },
];
