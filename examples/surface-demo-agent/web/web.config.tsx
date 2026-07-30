/**
 * surface-demo-agent UI 扩展 —— **pane 形态**(spec panes-only-right-panel 任务 2.2)。
 *
 * 迁移前:`slots.panelRight` 交一个宿主同 realm 的 React 面板。
 * 迁移后:交一份**可枚举的 pane 定义**,宿主实例化面板宿主并与内置 pane 合并。
 *
 * ★ 零协议新增。guest SDK 的 surface 四件套(读快照 / 订阅 / 执行命令 / 探测可用性)
 * 早已具备,故这次是纯 UI 改写 —— 面板逻辑逐字搬进 iframe,testid 与降级文案一个不改。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { panesDefinition } from "./panes/index.js";

export default defineWebExtension({
  manifestId: "surface-demo",
  capabilities: [],
  panes: panesDefinition,
});
