/**
 * system-status-agent — 组合演示 server-driven UI(data-pi-ui)+ ambient 状态/通知 的 example agent。
 *
 * 与既有示例的区别:`server-driven-ui-agent` 只发 UI、`ui-demo-agent` 只做交互/ambient;
 * 本示例在**一个工具**里把两条链路组合起来,演示一次"健康检查"的真实形态:
 *
 *   health_check(execute 的第 4 参 onUpdate = 发 UI;第 5 参 ctx = ambient):
 *     - ctx.ui.setStatus(key, text|undefined)  → 顶部状态条进度(不阻塞);传 undefined 清除
 *     - emitUi(onUpdate, { kind:"builtin", component:"metric"|"table" })  → 内置白名单组件
 *     - emitUi(onUpdate, { kind:"sandbox", root })                        → 受限节点树(只读)
 *     - ctx.ui.notify(message, "info")          → 通知浮层(不阻塞)
 *
 * 在 pi-web:UI 经 `data-pi-ui` 帧由 <PiChat> 零配置渲染(内置组件 / 沙箱解释器);
 * ambient 经 `extension_ui_request` 推送到状态条 / 通知浮层。同一份 agent 在 pi CLI 亦通用。
 *
 * 注:emitUi / ctx.ui 仅在工具执行期间有效;model 省略 → 继承 ~/.pi/agent/settings.json。
 */
import { defineAgent, emitUi } from "@blksails/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** 文本结果助手(对齐 pi 工具结果形状)。 */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

/** 可中止的延时,模拟分步工作以便 setStatus 进度在前端可见。 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/** health_check:分步推进状态条 + 发出指标卡/服务表/发布说明沙箱树 + 完成通知。 */
const healthCheck = defineTool({
  name: "health_check",
  label: "Health Check",
  description:
    "Run a system health check. Streams progress on the status bar and renders a " +
    "metric card, a service table, and a release-note panel as server-driven UI.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, signal, onUpdate, ctx) {
    // (1/3) 收集指标 —— ambient 状态条。
    ctx.ui.setStatus("health", "(1/3) 收集指标…");
    await sleep(300, signal);
    emitUi(onUpdate, {
      kind: "builtin",
      component: "metric",
      title: "服务概览",
      props: {
        label: "在线服务",
        value: "8 / 8",
        delta: "全部健康",
        tone: "success",
      },
    });

    // (2/3) 渲染明细 —— 内置表格。
    ctx.ui.setStatus("health", "(2/3) 渲染明细…");
    await sleep(300, signal);
    emitUi(onUpdate, {
      kind: "builtin",
      component: "table",
      title: "服务状态",
      props: {
        columns: ["服务", "状态", "延迟"],
        rows: [
          ["api", "OK", "42ms"],
          ["web", "OK", "12ms"],
          ["db", "OK", "31ms"],
        ],
      },
    });

    // (3/3) 报告 —— 沙箱节点树(受限白名单,只读)。
    ctx.ui.setStatus("health", "(3/3) 生成报告…");
    await sleep(300, signal);
    emitUi(onUpdate, {
      kind: "sandbox",
      title: "本次检查",
      root: {
        el: "box",
        direction: "col",
        style: { gap: "sm" },
        children: [
          { el: "heading", level: 2, text: "健康检查通过" },
          { el: "badge", text: "healthy", style: { tone: "success" } },
          {
            el: "list",
            items: ["8/8 服务在线", "P95 延迟 42ms", "无告警"],
          },
          {
            el: "link",
            text: "查看完整监控面板",
            href: "https://example.com/status",
          },
        ],
      },
    });

    // 完成:清除状态条 + 通知浮层。
    ctx.ui.setStatus("health", undefined);
    ctx.ui.notify("健康检查完成:8/8 服务在线。", "info");

    return textResult("健康检查完成(server-driven UI 已渲染)。");
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are system-status-agent. When the user asks for system status, health, " +
    "or a status check, call the health_check tool — it streams progress and renders " +
    "rich UI from the backend. Do not describe the UI in text; let the tool render it.",
  customTools: [healthCheck],
  // 自包含:不拉入系统内置工具与磁盘技能,仅用本文件声明的能力。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
