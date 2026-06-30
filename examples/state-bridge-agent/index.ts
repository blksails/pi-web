/**
 * state-bridge-agent — 状态注入桥(state-injection-bridge)的端到端示例 agent。
 *
 * 演示「人机共驾」的会话级共享状态:
 *  - AI 侧:`increment` / `read_state` 工具经 runner 注入的状态核(context 外)同步读写;
 *  - 人侧:`.pi/web` 用 `useExtensionState("count")` 渲染当前值并提供按钮写回;
 *  - 双方读写同一份实时状态,经下行 control:"state" 帧 + 写回端点双向同步。
 *
 * 状态接入点由 runner 的 `wireStateBridge` 装配(子进程权威 KV + globalThis seam);本文件仅声明
 * agent 与 customTools。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { incrementTool, readStateTool } from "./tools/state-tools.js";

export default defineAgent({
  systemPrompt: [
    "You are state-bridge-agent, a pi-web example demonstrating the bidirectional shared-state bridge.",
    "Use the `increment` tool to bump a shared counter, and `read_state` to inspect current state.",
    "The shared state is visible to and editable by the user in the UI in real time.",
    "Keep replies concise and report the resulting state value.",
  ].join("\n"),
  customTools: [incrementTool, readStateTool],
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
