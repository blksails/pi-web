/**
 * aigc-canvas-agent UI 扩展 —— **pane 声明键形态**(spec panes-only-right-panel 任务 4.1)。
 *
 * ## 三个槽的去向(迁移史)
 *
 * | 槽 | 最初 | isolated-panes Wave 5 | 本次 |
 * |---|---|---|---|
 * | `panelRight` | `CanvasPanel`(同 realm) | 自建 `PanesHost` | **改用 pane 声明键**,宿主实例化 |
 * | `launcherRail` | `CanvasLauncher` | 撤掉(store 不跨 realm) | — |
 * | `promptToolbar` | `AigcQuickSettings` | 原样保留 | 原样保留 |
 *
 * ## ★ 本次消失的那个包装层不是纯包装
 *
 * 迁移前 `panelRight` 挂的是一个自建 `PanesHost` 的包装组件,它带**两处宿主 realm 逻辑** ——
 * 这正是上一个 spec「刻意不动 canvas」的真因。两处都已找到正路:
 *
 * 1. **主题与对话流焦点**:原本本 source 在宿主 realm 挂 MutationObserver + 全局 click 监听
 *    自行计算。那在隔离形态下根本做不到,也不该让每个 agent 各写一份 ⇒ 已内置为宿主信号族
 *    (`host:theme` / `host:transcriptFocus`,任务 1.4)。宿主原用时间戳做连点去重,同毫秒内
 *    连点会失效;内置化时换成单调序号,**严格更强**。
 * 2. **轮末 auto-sync**:原本宿主侧包装层代发 `surface.run("canvas","sync")`,因为当时 pane
 *    协议不传轮末同步信号。现在宿主已把它作为 `host:syncSignal` 推进 pane,而 guest 本就能
 *    执行 surface 命令 ⇒ 该由 pane 自己发,**包装层随之整个消失**(见 `web/panes/canvas.tsx`)。
 *
 * `promptToolbar` 仍保留:它挂在输入区(宿主 realm),经 state 桥与 agent 侧图像工具通信,
 * 与 pane 化无关 —— 它的位置(发送键旁)本身就是它的语义。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { AigcQuickSettings } from "@blksails/pi-web-canvas-ui";
import { panesDefinition } from "./panes/index.js";

export const config = {
  panes: {
    // standard:固定 tab + 基础控件。画廊是单 pane,不需要拖拽重排与命令面板。
    interactionMode: "standard" as const,
    allowTabReorder: false,
    showCommandPalette: false,
  },
  web: {
    // 初始比例 4:6(对话 40% / 画廊 60%):Canvas 是创作台,默认给足空间。
    panelRatio: "4:6" as const,
    // logs 固定 bottom(对话区下方):避免日志面板挤占画廊的右侧 aside。
    logsPanelPosition: "bottom" as const,
  },
};

export default defineWebExtension({
  manifestId: "aigc-canvas",
  capabilities: ["slots", "config"],
  config: config.web,
  slots: {
    // 输入区工具排的模型/尺寸快捷设置(工具设置在 /settings 的「AIGC 图像工具」面板,不在此)。
    promptToolbar: AigcQuickSettings as never,
  },
  panes: {
    ...panesDefinition,
    // 交互配置随声明键交给宿主透传;迁移前它是自建 PanesHost 的直接 prop,
    // 不带上会静默丢失交互模式设定。
    config: config.panes,
  },
});
