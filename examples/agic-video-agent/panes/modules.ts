import { canvasPaneModule } from "@blksails/pi-web-canvas-ui/pane";
import type { AigcPaneModule } from "./module.js";
import { materialsPaneModule } from "../packages/materials-pane/src/module.js";
import { searchPaneModule } from "../packages/search-pane/src/module.js";
import { videoStudioPaneModule } from "../video-studio/module.js";

/** 增删 pane 只改此组合清单；单项元数据与 Guest 页面可独立迁移。 */
export const AIGC_PANES_ID = "agic-video-panes";

export const aigcPaneModules: readonly AigcPaneModule[] = [
  searchPaneModule,
  materialsPaneModule,
  canvasPaneModule,
  videoStudioPaneModule,
];
