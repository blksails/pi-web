/**
 * aigc-canvas-agent UI 扩展:Canvas(aigc-canvas)入口 + 画廊/工作台面板。
 *
 * - `launcherRail` 具名槽 → `CanvasLauncher`:门控 `NEXT_PUBLIC_PI_WEB_CANVAS` 的入口按钮
 *   (launcherRail slot 拿不到 surface,故仅门控 + 开合 canvasOpenStore);
 * - `panelRight` 具名槽 → `CanvasPanel`:宿主经 prop 注入 `surface`(`useSurface("canvas")` 的 slot
 *   侧等价),读 canvasOpen 开合,展开 `CanvasGallery`/`CanvasWorkbench`(镜像快照 + A/B/C 档二创)。
 *
 * 两个 slot 经 module-level `canvasOpenStore` 联动(同一 app bundle 内共享)。宿主对 `domain`/快照
 * 值不透明(领域无关搬运)。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { CanvasLauncher, CanvasPanel } from "@blksails/pi-web-ui";

export default defineWebExtension({
  manifestId: "aigc-canvas",
  capabilities: ["slots"],
  // panelRight 初始比例 4:6(对话 40% / Canvas 60%,面板主导):Canvas 是创作台,默认给足空间。
  // 宿主段控切换器仍可运行时在 centered / 2:1 / 4:6 / 3:7 间切换。
  config: { panelRatio: "4:6" },
  slots: {
    launcherRail: CanvasLauncher as never,
    panelRight: CanvasPanel as never,
  },
});
