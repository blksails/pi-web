/**
 * agents/aigc 的完整 ③ Web UI 扩展(自声明 · 可移植)。
 *
 * 关键:本源**自带完整 ③**——canvas 画廊/工作台 + skill 管理入口 + 图片渲染器,全部在此
 * 一份 `defineWebExtension` 里声明。import 只触及**宿主提供的包**(`@blksails/pi-web-canvas-ui`
 * / `-kit` / `-ui`)与本源自身文件,不 bundle 依赖、不借 vendor 范例——任何 pi-web 宿主加载
 * `./agents/aigc` 即得到同一套 UI(蓝图 §0.1 可嵌入多 agent 宿主)。
 *
 * 槽位(**本仓库宿主**:canvas + 素材抽屉经 `panelRight` slot(WorkspacePanel)承载,承接原型 `.rightcol`
 * 一体机;宿主 chat-app 据此弃用 host-level CanvasRegion + conversationApiRef):
 *  - `promptToolbar` → AigcPromptToolbar:严格照原型 `.prompt-toolbar` 的快捷 pill 排
 *    (⚡技能▾ + 文生图/图生图 + 模型/尺寸/数量;模型/尺寸写同一会话偏好 KV,图像工具执行时读同键)。
 *  - `dialogLayer` → SkillPanel:技能管理 modal(由 ⚡技能▾ 的「管理技能…」经 skill-panel-store 打开)。
 *  - `panelRight` → WorkspacePanel:右栏工作区容器(模块 Tab + Activity 保活);canvas 由 slot 注入的原生 conversation 驱动。
 * 渲染器:image_generation / image_edit 产物渲成 `<img>`(见 ./image-renderer)。
 * config:panelRatio centered(宿主 chat-app 依边栏开合以显式 panelRatio prop 覆盖)+ logs 固定底部。
 *
 * canvas 未开门控时优雅退化(不影响图片渲染)。本仓库 panelRight(WorkspacePanel)引用 host components 故不可移植;
 * 其他 pi-web 宿主仍可用可移植的纯画布 `AigcCanvasPanel`(仍导出于 ./canvas-panel)。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { AigcPromptToolbar } from "./prompt-toolbar.js";
import { imageRendererExtension } from "./image-renderer.js";
// panelRight 工作区容器(模块 Tab 条 + Activity 保活):本仓库宿主用它承载右栏,模块由此拿
// slot 注入的原生 conversation(替代 conversationApiRef 接缝)。注:引用 host components →
// 本仓库 panelRight 不可移植;其他 pi-web 宿主仍可用可移植的 AigcCanvasPanel(纯画布)。
// 导入 workspace-modules 即注册内置模块(画布 / 素材),副作用 import 顺序须在容器之前。
import "./workspace/workspace-modules.js"; // [迁移变换 B] 壳层路径→迁移后 workspace/(副作用注册,须在容器 import 前)
import {
  AigcDialogLayer,
  AigcWorkspacePanel,
  AigcWorkspaceRail,
} from "./workspace/host-adapter.js"; // [迁移变换 B] 经宿主适配层接入(QueryProvider 自包 + 三槽)
import { mediaRendererExtension } from "./media-renderer.js";

export default defineWebExtension({
  manifestId: "aigc-studio",
  capabilities: ["slots", "renderers"],
  config: {
    panelRatio: "centered",
    logsPanelPosition: "bottom",
    // 空态:aigc 专属标题/副标题 + 起手式;mergeCommands:"replace" 覆盖宿主默认建议
    // (含漏出的 surface 通道建议 chip),只呈现这些图像起手式。
    empty: {
      // 短标题:对话列在右栏展开时只有 ~420–600px,长标题(原「花影 AIGC · 图像工作台」)
      // 在 vendor 的大字号空态下必折两三行。品牌由 agent 源自身的名字承载,空态不重复。
      title: "图像工作台",
      subtitle: "描述画面直接生成;或上传图片做局部重绘 / 风格迁移 / 扩图。",
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
  slots: {
    promptToolbar: AigcPromptToolbar as never,
    dialogLayer: AigcDialogLayer as never,
    // 右栏工作区容器(可注册模块 + Tab 条 + Activity 保活)。声明 panelRight → PiChat 注入
    // 原生 conversation + 开空闲控制流;宿主 chat-app 据此弃用 host-level CanvasRegion。
    panelRight: AigcWorkspacePanel as never,
    sidebarLeft: AigcWorkspaceRail as never,
  },
  // 图像(image_generation/image_edit)+ 媒体(视频/音频/ffmpeg 13 工具)渲染器合并。
  renderers: {
    tools: {
      ...(imageRendererExtension.renderers?.tools ?? {}),
      ...(mediaRendererExtension.renderers?.tools ?? {}),
    },
  },
});
