/**
 * ui-demo-agent — 演示 extension UI(select / confirm)交互的 example agent。
 *
 * 工具 `execute` 的第 5 个参数是 `ctx: ExtensionContext`,经 `ctx.ui.*` 触发交互式弹窗:
 *   - ctx.ui.select(title, options[])  → 单选,返回选中字符串(取消返回 undefined)
 *   - ctx.ui.confirm(title, message)   → 确认,返回 boolean
 *   - ctx.ui.input(title, placeholder?) → 文本输入,返回字符串(取消 undefined)
 *   - ctx.ui.notify(message, type?)    → 通知(不阻塞)
 *
 * 在 pi-web 里它们经 RPC 发 `extension_ui_request` 帧,前端弹 <PiPermissionDialog>,
 * 用户应答经 `ui-response` 回传;在 pi CLI 里渲染成终端弹窗。
 *
 * 不花钱的闭环验证(stub agent 驱动 select→confirm,无 LLM):
 *   e2e/node/extension-ui-select.e2e.test.ts
 *
 * 注:pi SDK 的 confirm/select 是**位置参数**(非对象);model 省略 → 继承 pi 配置。
 */
import { defineAgent } from "@pi-web/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** 部署工具:先 select 环境,再 confirm,演示两类交互。 */
const deploy = defineTool({
  name: "deploy",
  label: "Deploy",
  description: "Deploy to an environment. Asks the user to select an environment and confirm.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const env = await ctx.ui.select("Select environment", ["dev", "staging", "prod"]);
    if (env === undefined) {
      return { content: [{ type: "text", text: "Cancelled: no environment selected." }], details: undefined };
    }
    const ok = await ctx.ui.confirm("Confirm deploy", `Deploy to ${env}?`);
    if (!ok) {
      return { content: [{ type: "text", text: `Deploy to ${env} denied by user.` }], details: undefined };
    }
    ctx.ui.notify(`Deploying to ${env}…`, "info");
    return { content: [{ type: "text", text: `Deployed to ${env}.` }], details: undefined };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are ui-demo-agent. When asked to deploy, call the deploy tool — it will ask the user to pick an environment and confirm.",
  customTools: [deploy],
});
