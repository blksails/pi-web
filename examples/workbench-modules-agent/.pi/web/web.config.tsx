import { defineWebExtension } from "@blksails/pi-web-kit";
import { WorkbenchHost } from "./workbench-host.js";

export default defineWebExtension({
  manifestId: "workbench-modules",
  capabilities: ["slots"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom", documentTitle: "模块工作台 · pi-web" },
  // 当前 pi-web 的落位适配只存在于这一行；Workbench/Guest/Agent 数据面均不依赖宿主插槽概念。
  slots: { panelRight: WorkbenchHost as never },
});
