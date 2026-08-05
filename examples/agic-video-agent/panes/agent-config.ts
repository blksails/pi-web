/**
 * Agent 视频工作室宿主侧配置(panelRight 宽度 / panes host 配置)。
 * 单源:运行时宿主(`.pi/web/web.config.tsx`)与构建期(`build.ts` 烘焙进 panes.json sidecar,
 * 供 Pi-clouds adapter 静态发现)共用,避免双份漂移。
 */
import { CANVAS_OPEN_ATTACHMENTS_EVENT } from "@blksails/pi-web-canvas-ui/pane";

/** panelRight 连续宽度档(config 驱动,宿主据此渲染连续拖拽分隔条)。 */
export const AIGC_AGENT_PANEL_CONFIG = {
  panelRatio: "centered",
  // 右侧素材库保持紧凑；仍可经分隔条扩展。
  panelWidth: 620,
  minPanelWidth: 320,
  maxPanelWidth: 960,
  maxPanelWidthRatio: 0.7,
} as const;

/** PanesHost 宿主侧交互配置(不含 persistenceKey —— 那是 host 私有 localStorage 键)。 */
export const AIGC_PANES_CONFIG = {
  interactionMode: "advanced",
  allowTabReorder: true,
  showCommandPalette: true,
  eventTargets: { [CANVAS_OPEN_ATTACHMENTS_EVENT]: "canvas" },
} as const;
