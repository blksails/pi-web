/**
 * server-driven-ui-agent — 演示 server-driven UI(data-pi-ui)的 example agent。
 *
 * agent 从**后端**声明富 UI,前端零配置渲染。产帧通道:工具 `execute` 的第 4 个参数
 * `onUpdate` 经 `emitUi(onUpdate, spec)` 发出 UiSpec(见 @blksails/pi-web-agent-kit);pi SDK 产生
 * `tool_execution_update` 事件,server 翻译层识别约定 key 后产出 `data-pi-ui` 帧,
 * 前端 <PiChat> 经注册的 PiUiPart 渲染(内置白名单组件 / 沙箱解释器)。
 *
 * 覆盖两条信任路径:
 *   - kind:"builtin" → 内置白名单组件(metric / table …),仅传组件名 + JSON props。
 *   - kind:"sandbox" → 声明式节点树,受限解释器渲染(无代码执行 / 协议白名单 / 只读)。
 *
 * 注:emitUi 仅在工具执行期间有效 —— agent 想发 UI 就在某个工具里 emitUi。
 */
import { defineAgent, emitUi } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** show_dashboard:经 emitUi 发出内置组件 + 沙箱组件,演示 server-driven UI。 */
const showDashboard = defineTool({
  name: "show_dashboard",
  label: "Show Dashboard",
  description:
    "Render a metrics dashboard as server-driven UI. Emits builtin components (metric/table) " +
    "and a sandbox node tree directly from the backend; the web UI renders them zero-config.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, onUpdate) {
    // 内置白名单组件:指标卡。
    emitUi(onUpdate, {
      kind: "builtin",
      component: "metric",
      title: "今日概览",
      props: { label: "活跃用户", value: "1,284", delta: "+12% vs 昨日", tone: "success" },
    });

    // 内置白名单组件:数据表。
    emitUi(onUpdate, {
      kind: "builtin",
      component: "table",
      title: "服务状态",
      props: {
        columns: ["服务", "状态", "延迟"],
        rows: [
          ["api", "OK", "42ms"],
          ["web", "OK", "12ms"],
          ["db", "降级", "210ms"],
        ],
      },
    });

    // 沙箱组件:声明式节点树(自定义布局)。
    emitUi(onUpdate, {
      kind: "sandbox",
      title: "发布说明",
      root: {
        el: "box",
        direction: "col",
        style: { gap: "sm" },
        children: [
          { el: "heading", level: 2, text: "v1.4.2 已发布" },
          { el: "badge", text: "stable", style: { tone: "success" } },
          {
            el: "list",
            items: ["修复登录重定向", "冷启动优化 30%", "新增导出 CSV"],
          },
          { el: "link", text: "查看完整 changelog", href: "https://example.com/changelog" },
        ],
      },
    });

    return {
      content: [{ type: "text" as const, text: "已生成仪表盘(server-driven UI)。" }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are server-driven-ui-agent. When the user asks to show a dashboard, metrics, or status, " +
    "call the show_dashboard tool — it renders rich UI directly from the backend via data-pi-ui. " +
    "Do not describe the UI in text; let the tool render it.",
  customTools: [showDashboard],
});
