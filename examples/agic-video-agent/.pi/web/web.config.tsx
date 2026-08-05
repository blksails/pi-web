/** Agent 视频工作室运行时 WebExtension：媒体预览、右栏 panes 与视频流程入口。 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import {
  canvasConversationImageAction,
} from "@blksails/pi-web-canvas-ui/pane";
import {
  definePaneDefinition,
  definePanes,
} from "@blksails/pi-web-panes-kit";
import { AIGC_PANES_ID, aigcPaneModules } from "../../panes/modules.js";
import { AIGC_AGENT_PANEL_CONFIG, AIGC_PANES_CONFIG } from "../../panes/agent-config.js";
import { LOGS_PANE_ID } from "../../panes/logs-pane-document.js";
import { AigcCanvasPanesLauncher } from "./canvas-panes-launcher.js";
import { imageRendererExtension } from "./image-renderer.js";
import { mediaRendererExtension } from "./media-renderer.js";
import { AigcPromptToolbar } from "./prompt-toolbar.js";
import { MediaPreviewHost } from "./media-preview-host.js";

const MAX_PANE_INSTANCES = 2;
const extensionReload = new URL(import.meta.url).searchParams.get("t");

function paneDocumentUrl(paneId: string): string {
  const url = new URL(`./pane-${paneId}.html`, import.meta.url);
  if (extensionReload !== null) url.searchParams.set("t", extensionReload);
  return url.href;
}

export const aigcPanesDefinition = definePanes({
  id: AIGC_PANES_ID,
  initialPaneIds: [...aigcPaneModules.map((pane) => pane.id), LOGS_PANE_ID],
  maxOpenPanes: (aigcPaneModules.length + 1) * MAX_PANE_INSTANCES,
  panes: [
    ...aigcPaneModules.map(({ entry: _entry, canvasStyles: _canvasStyles, ...pane }) =>
      definePaneDefinition({
        ...pane,
        allowMultiple: true,
        maxInstances: MAX_PANE_INSTANCES,
        document: {
          kind: "html",
          src: paneDocumentUrl(pane.id),
        },
      }),
    ),
    definePaneDefinition({
      id: LOGS_PANE_ID,
      title: "日志",
      icon: "scroll-text",
      allowMultiple: true,
      maxInstances: MAX_PANE_INSTANCES,
      document: { kind: "html", src: paneDocumentUrl(LOGS_PANE_ID) },
      capabilities: {
        routes: [{ name: "session.logs", methods: ["GET"], maxResponseBytes: 2 * 1024 * 1024 }],
      },
    }),
  ],
});

const panesConfig = {
  ...AIGC_PANES_CONFIG,
  // 旧键缺日志；升版令四个宿主 WebView 均按 initialPaneIds 首次展开。
  persistenceKey: "pi-web:agic-video-studio:panes:v1",
};

export default defineWebExtension({
  manifestId: "agic-video-studio",
  capabilities: ["slots", "renderers", "config"],
  config: {
    ...AIGC_AGENT_PANEL_CONFIG,
    empty: {
      title: "视频工作室",
      subtitle: "从创意简报拆镜头，逐镜头生成、实时介入、复核并导出；图像与媒体工具可作参考素材。",
      starters: [
        { id: "video-plan", label: "拆视频镜头", value: "把这个创意拆成 15 秒视频镜头方案：清晨海边咖啡店，一只橘猫追着纸飞机，温暖电影感，竖版。", mode: "fill" },
        { id: "video-auto", label: "自动生成首版", value: "为当前视频项目按镜头顺序自动生成首版，完成一镜再继续下一镜。", mode: "fill" },
        { id: "video-revise", label: "修改当前镜头", value: "暂停当前视频镜头，把镜头动作改得更克制，保留主体连续性。", mode: "fill" },
      ],
      mergeCommands: "replace",
    },
  },
  slots: {
    // aigc-agent 专属：左栏开/切「画布」pane tab（非 panelRight 旧画廊）。
    launcherRail: AigcCanvasPanesLauncher as never,
    promptToolbar: AigcPromptToolbar,
    dialogLayer: MediaPreviewHost,
  },
  // WebExtension 契约承载定义本身；`definition` 仅属 PanesHost prop/宿主内部 PaneSource。
  panes: { ...aigcPanesDefinition, config: panesConfig },
  conversationImageActions: [canvasConversationImageAction],
  renderers: {
    tools: {
      ...(imageRendererExtension.renderers?.tools ?? {}),
      ...(mediaRendererExtension.renderers?.tools ?? {}),
    },
  },
});
