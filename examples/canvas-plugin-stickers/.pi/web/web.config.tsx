/**
 * canvas-plugin-stickers UI 扩展:复用 Canvas 表面 + 贴纸插件捆(canvas-plugins-m3 · Req 6.1/6.4)。
 *
 * 与 aigc-canvas 同构地挂 Canvas 的三个具名槽(`launcherRail`/`panelRight`/`promptToolbar`),
 * 额外经 `canvasPlugins:[stickersBundle]` 走**车道①**(source 自带插件):宿主领域中立地把本扩展
 * 描述符搬运进 CanvasPanel → `collectCanvasPluginBundles`(namespace = manifestId)→ CanvasWorkbench
 * 的 `registerPluginBundles` 施加 `canvas-plugin-stickers:` 前缀与 requires 拓扑校验后接入工具轨/
 * 图层渲染/动作决策。
 *
 * 门控 `NEXT_PUBLIC_PI_WEB_CANVAS`(与 aigc-canvas 同);插件捆见 `./stickers`。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { CanvasLauncher, CanvasPanel, AigcQuickSettings } from "@blksails/pi-web-canvas-ui";
import { stickersBundle } from "./stickers";

export default defineWebExtension({
  manifestId: "canvas-plugin-stickers",
  capabilities: ["slots"],
  // panelRight 初始比例 4:6(对话 40% / Canvas 60%):Canvas 是创作台,默认给足空间(与 aigc-canvas 同)。
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  slots: {
    launcherRail: CanvasLauncher as never,
    panelRight: CanvasPanel as never,
    promptToolbar: AigcQuickSettings as never,
  },
  // 车道①:source 自带 canvas 插件捆(贴纸图层/工具 + 风格迁移动作)。
  canvasPlugins: [stickersBundle],
});
