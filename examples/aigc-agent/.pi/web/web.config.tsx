/**
 * examples/aigc-agent 的 ③ Web UI 扩展 —— 隔离 PanesHost 形态。
 *
 * 弃自造工作区壳(WorkspacePanel/rail/toolbar/主题),转 pi-web 基础风格(以 aigc-canvas-agent 为基准)。
 * 右侧三业务域(搜图 / 素材 / 画布)各为独立 iframe pane(sandbox="allow-scripts"、不透明 origin、
 * MessageChannel + epoch 握手),经通用 PanesHost(panes-kit)+ 本源 aigcPanesDefinition 承载;
 * 数据按 capability 白名单经 Agent Routes、Surface、附件系统收敛,Guest 不持宿主对象/会话凭证。
 *
 * import 只触及宿主提供的公开包(`@blksails/pi-web-kit` / `-panes-kit`)与本源文件,不 bundle 依赖——
 * 任何 pi-web 宿主加载 ./examples/aigc-agent 即得同一套 UI。
 *
 * 渲染器:image_generation/image_edit 产物渲成 <img>;媒体工具(视频/音频)产物同法渲染。
 */
import * as React from "react";
import { defineWebExtension, type SlotRenderProps } from "@blksails/pi-web-kit";
import { PanesHost } from "@blksails/pi-web-panes-kit/react";
import { aigcPanesDefinition } from "../../web/panes/index.js";
import { imageRendererExtension } from "./image-renderer.js";
import { mediaRendererExtension } from "./media-renderer.js";

// advanced:可拖拽 tabs、IDE 分栏、命令面板(与 examples/panes-agent 同姿态)。
const panesConfig = {
  interactionMode: "advanced" as const,
  allowTabReorder: true,
  showCommandPalette: true,
};

function ConfiguredPanesHost(props: SlotRenderProps): React.JSX.Element {
  return <PanesHost {...props} definition={aigcPanesDefinition} config={panesConfig} />;
}

export default defineWebExtension({
  manifestId: "aigc-studio",
  capabilities: ["slots", "renderers", "config"],
  config: {
    panelRatio: "centered",
    logsPanelPosition: "bottom",
    // 空态:图像起手式;mergeCommands:"replace" 覆盖宿主默认建议,只呈现这些图像起手式。
    empty: {
      title: "图像工作台",
      subtitle: "描述画面直接生成;或上传图片做局部重绘 / 风格迁移 / 扩图。右侧可开搜图 / 素材 / 画布面板。",
      starters: [
        {
          id: "gen-poster",
          label: "生成海报",
          value: "生成一张国潮风格的新年海报,主体是一只戴红围巾的兔子,竖版",
          mode: "fill",
        },
        {
          id: "gen-ip",
          label: "IP 三视图",
          value: "为一个圆脸猫咪 IP 设计正面 / 侧面 / 背面三视图设定,扁平插画风",
          mode: "fill",
        },
        {
          id: "edit-inpaint",
          label: "局部重绘",
          value: "把图中背景替换为夕阳海滩(请先在输入框上传要编辑的图片)",
          mode: "fill",
        },
      ],
      mergeCommands: "replace",
    },
  },
  // 唯一槽:右栏挂通用 PanesHost。宿主只负责 placement 与能力注入,pane 隔离由 panes-kit 承担。
  slots: {
    panelRight: ConfiguredPanesHost,
  },
  // 图像(image_generation/image_edit)+ 媒体(视频/音频/ffmpeg)渲染器合并。
  renderers: {
    tools: {
      ...(imageRendererExtension.renderers?.tools ?? {}),
      ...(mediaRendererExtension.renderers?.tools ?? {}),
    },
  },
});
