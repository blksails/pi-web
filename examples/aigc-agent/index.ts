/**
 * aigc-agent — `@blksails/pi-web-tool-kit` AIGC 生成工具的**端到端示例 agent**(spec aigc-generation-tools,task 6)。
 *
 * 经 `extensions: [aigcExtension]` 装载 AIGC 工具(`image_generation` / `image_edit`,pi.registerTool
 * 形态)演示完整接入:
 *  - 用户发文本 prompt → 模型调 `image_generation({ prompt })` → provider 生成 → 产物经 attachment
 *    store 落库 → 工具回 `att_<id>` 引用,默认工具卡片展示;
 *  - 用户上传图(主进程注入 `[attachment id=att_… …]` 引用)→ 模型把 att_id 抄进
 *    `image_edit({ image, prompt })` → 编辑器解析输入附件为 data URI → provider 编辑 →
 *    产物落库回引用。
 *
 * 工具在 runner 子进程内经注入的 AttachmentToolContext(globalThis seam)落库;装配缺失 / provider
 * 密钥缺失时,工具仍加载并返回「能力不可用 / 缺少配置」降级,而非崩溃(Req 5.3)。
 *
 * provider 密钥经环境变量提供(如 `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `NEWAPI_API_KEY`);
 * 缺失则对应变体调用降级。
 *
 * NOTE: `model` 故意省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel,
 * 开箱即用于任意 pi 登录(与 hello-agent 同姿态)。
 *
 * 工具执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程加载,
 * 不进 Next 服务端 bundle)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
  systemPrompt: [
    "You are aigc-agent, a pi-web example exposing AIGC generation tools.",
    "- Use `image_generation` to generate one or more images from a text prompt.",
    "- Use `image_edit` to edit an uploaded image: copy the public id from the",
    "  [attachment id=att_… …] marker verbatim into the tool's `image` parameter.",
    "Each tool persists its output as an attachment and returns a reference; report the",
    "produced attachment id back to the user. Keep replies concise.",
  ].join("\n"),
  // AIGC 工具经进程内 ExtensionFactory 装载(detoolspec-unify-builtin-tools)。
  extensions: [aigcExtension],
  // Self-contained:关掉内置工具,仅暴露 AIGC 扩展工具。
  noTools: "builtin",
  // 关掉磁盘发现的系统 skills,保持示例 hermetic。
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
