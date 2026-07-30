/**
 * state-bridge-agent UI 扩展 —— **pane 形态**(spec panes-only-right-panel 任务 3.1)。
 *
 * 迁移前:`slots.panelRight` 交一个宿主同 realm 的 React 面板,经 prop 拿到共享状态访问器。
 * 迁移后:交一份 pane 定义,面板在隔离环境内经**受管的共享状态通道**读写同一份会话状态。
 *
 * ★ 它是本 spec 新增通道的唯一真实消费者,也是那条通道的活体验证。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { panesDefinition } from "./panes/index.js";

export default defineWebExtension({
  manifestId: "state-bridge",
  capabilities: [],
  panes: panesDefinition,
});
