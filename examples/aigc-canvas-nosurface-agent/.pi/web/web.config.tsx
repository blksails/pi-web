/**
 * aigc-canvas-nosurface-agent UI 扩展:Canvas 入口 + 面板,但 agent 无 canvas surface。
 *
 * 与 `aigc-canvas-agent/.pi/web/web.config.tsx` 的 slot 贡献一致(`launcherRail` →
 * `CanvasLauncher`、`panelRight` → `CanvasPanel`),使 Canvas 面板在此 source 下仍可见。
 * 差异在 agent 侧(index.ts 不装 `canvasSurfaceExtension`)—— 面板挂载后因
 * `surface.hasCommand("surface:canvas")` 为假而退化为只读图库(Req 8.6/8.7 降级验证)。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { CanvasLauncher, CanvasPanel } from "@blksails/pi-web-ui";

export default defineWebExtension({
  manifestId: "aigc-canvas-nosurface",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,
    panelRight: CanvasPanel as never,
  },
});
