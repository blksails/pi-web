/**
 * ui-demo-agent — 演示 extension UI 全部常用交互的 example agent。
 *
 * 工具 `execute` 的第 5 个参数是 `ctx: ExtensionContext`,经 `ctx.ui.*` 触发交互 / 推送状态。
 * 本示例用两个工具覆盖 pi-web 支持的全部 extension UI surface:
 *
 *   deploy(交互类,阻塞,弹窗):
 *     - ctx.ui.select(title, options[])       → 单选,返回选中字符串(取消返回 undefined)
 *     - ctx.ui.confirm(title, message)        → 确认,返回 boolean
 *
 *   create_project(表单 + ambient 状态):
 *     - ctx.ui.input(title, placeholder?)      → 文本输入,返回字符串(取消返回 undefined)
 *     - ctx.ui.setStatus(key, text|undefined)  → 顶部状态条;传 undefined 清除该 key(不阻塞)
 *     - ctx.ui.notify(message, type?)          → 通知浮层 info|warning|error(不阻塞)
 *
 * 在 pi-web 里:交互类经 RPC 发 `extension_ui_request` 帧 → 前端弹 <PiPermissionDialog> →
 * 应答经 `ui-response` 回传;ambient 类(notify/setStatus)推送到前端通知浮层 / 状态条。
 * 在 pi CLI 里则渲染成终端弹窗 / 状态行 / 通知。同一份 agent 两端通用。
 *
 * 不花钱的闭环验证(stub agent 驱动 select→confirm,无 LLM):
 *   e2e/node/extension-ui-select.e2e.test.ts
 *
 * 注:pi SDK 的 select/confirm/input 是**位置参数**(非对象);model 省略 → 继承 pi 配置。
 */
import { defineAgent } from "@pi-web/agent-kit";
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

/** deploy:先 select 环境,再 confirm,演示交互类弹窗 + notify。 */
const deploy = defineTool({
  name: "deploy",
  label: "Deploy",
  description: "Deploy to an environment. Asks the user to select an environment and confirm.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const env = await ctx.ui.select("Select environment", ["dev", "staging", "prod"]);
    if (env === undefined) {
      return textResult("Cancelled: no environment selected.");
    }
    const ok = await ctx.ui.confirm("Confirm deploy", `Deploy to ${env}?`);
    if (!ok) {
      return textResult(`Deploy to ${env} denied by user.`);
    }
    ctx.ui.notify(`Deploying to ${env}…`, "info");
    return textResult(`Deployed to ${env}.`);
  },
});

/** create_project:input 收集表单 + setStatus 推进度 + notify 反馈。 */
const createProject = defineTool({
  name: "create_project",
  label: "Create Project",
  description:
    "Scaffold a new project. Asks the user for a project name and author via input dialogs, " +
    "shows step progress in the status bar, and notifies on completion.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
    // input(必填):取消(undefined)或空串 → 提示并结束。
    const name = await ctx.ui.input("项目名称", "my-app");
    if (name === undefined || name.trim() === "") {
      ctx.ui.notify("已取消:未提供项目名称", "warning");
      return textResult("Cancelled: no project name provided.");
    }

    // input(可选):留空则用默认作者。
    const authorRaw = await ctx.ui.input("作者(可留空)", "anonymous");
    const author =
      authorRaw === undefined || authorRaw.trim() === "" ? "anonymous" : authorRaw.trim();

    // setStatus:分步进度(ambient,前端顶部状态条逐步更新)。
    const steps = ["创建目录", "写入 package.json", "安装依赖", "初始化 git 仓库"];
    try {
      for (let i = 0; i < steps.length; i++) {
        ctx.ui.setStatus("scaffold", `(${i + 1}/${steps.length}) ${steps[i]}…`);
        await sleep(600, signal);
      }
    } catch {
      // 用户中止:清除状态并通知。
      ctx.ui.setStatus("scaffold", undefined);
      ctx.ui.notify("创建已中止", "warning");
      return textResult("Aborted by user.");
    }

    // 清除状态条 + 成功通知。
    ctx.ui.setStatus("scaffold", undefined);
    ctx.ui.notify(`项目「${name}」创建完成(作者:${author})`, "info");
    return textResult(`Created project "${name}" by ${author}.`);
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are ui-demo-agent, a showcase for extension UI interactions. " +
    "When asked to deploy, call the deploy tool — it asks the user to pick an environment and confirm. " +
    "When asked to create or scaffold a project, call the create_project tool — it collects a project " +
    "name and author from the user, shows progress, and reports the result. " +
    "Do not invent the inputs yourself; let the tools ask the user.",
  customTools: [deploy, createProject],
});
