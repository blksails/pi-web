/**
 * aigc-agent 专用：左栏 Canvas 入口走 panes workspace（open-or-activate 画布 tab）。
 * 不改共享 `CanvasLauncher` 默认行为，避免 aigc-canvas-agent 等 panelRight 路径回归。
 */
import * as React from "react";
import { CanvasLauncher } from "@blksails/pi-web-canvas-ui";
import { canvasPaneModule } from "@blksails/pi-web-canvas-ui/pane";

export function AigcCanvasPanesLauncher(
  props: React.ComponentProps<typeof CanvasLauncher>,
): React.JSX.Element | null {
  return <CanvasLauncher {...props} workspacePaneId={canvasPaneModule.id} />;
}
