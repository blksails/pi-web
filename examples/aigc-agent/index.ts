/**
 * aigc-agent — `@blksails/pi-web-tool-kit` AIGC 生成工具的**端到端示例 agent**(spec aigc-generation-tools,task 6)。
 *
 * 经 `extensions: [aigcExtension, visionExtension]` 装载 AIGC 工具(`image_generation` / `image_edit`,
 * pi.registerTool 形态)+ 视觉识别(`image_vision` 工具 + `/img_vision` 命令,spec image-vision-tool)
 * 演示完整接入:
 *  - 用户发文本 prompt → 模型调 `image_generation({ prompt })` → provider 生成 → 产物经 attachment
 *    store 落库 → 工具回 `att_<id>` 引用,默认工具卡片展示;
 *  - 用户上传图(主进程注入 `[attachment id=att_… …]` 引用)→ 模型把 att_id 抄进
 *    `image_edit({ image, prompt })` → 编辑器解析输入附件为 data URI → provider 编辑 →
 *    产物落库回引用。
 *  - **回看**:落库后的图在上下文里只剩 att_ 文本标记(读得到 id、读不到像素)。模型把 att_id
 *    抄进 `image_vision({ image, question })` → 取回字节 → 委派给一个支持图像输入的模型 →
 *    返回文字结论。于是「生成一张图 → 描述它到底画了什么」这个闭环得以成立。
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
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { aigcExtension, visionExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
  systemPrompt: [
    "You are aigc-agent, a pi-web example exposing AIGC generation tools.",
    "- Use `image_generation` to generate one or more images from a text prompt.",
    "- Use `image_edit` to edit an uploaded image: copy the public id from the",
    "  [attachment id=att_… …] marker verbatim into the tool's `image` parameter.",
    "- Use `image_vision` to *look at* an image and answer a question about it.",
    "  Images you generated earlier appear in your context only as",
    "  [attachment id=att_… …] text markers — you can read the id, NOT the pixels.",
    "  To actually see one, call `image_vision` with that id in its `image` parameter",
    "  (omit `image` to look at the most recent image in the session).",
    "  Use it to verify what you actually drew, or to answer questions about an image.",
    "",
    "Slash 命令快捷写法(用户可能这样发消息;它们会作为普通用户消息到达你这里,",
    "请据此**直接调用对应工具**,不要把命令文本当普通问题来解释或回答):",
    "- `/img-gen <提示词>` → 调用 `image_generation` 工具生成图像",
    "  (把 `<提示词>` 原样作为工具的 `prompt`,保持用户原语言,不要翻译)。",
    "- `/img-edit <提示词>` → 调用 `image_edit` 工具编辑最近上传的图像",
    "  (从对话中最近的 [attachment id=att_… …] 取 id 填入工具的 `image` 参数,",
    "  `<提示词>` 作为编辑指令)。",
    "",
    "Each tool persists its output as an attachment and returns a reference; report the",
    "produced attachment id back to the user. Keep replies concise.",
  ].join("\n"),
  // AIGC 工具经进程内 ExtensionFactory 装载(detoolspec-unify-builtin-tools)。
  // 同时装载 visionExtension:`image_vision` 工具 + `/img_vision` 命令(spec image-vision-tool),
  // 让 agent 能「回看」自己产出的图 —— 落库后它在上下文里只剩 att_ 文本标记,没有像素。
  extensions: [aigcExtension, visionExtension],
  // slash 补全候选(agent-slash-completion):/img-gen、/img-edit 出现在输入补全,
  // 选中只填入、不执行;补词后作为普通消息发给 LLM,由上面的 system prompt 驱动调工具。
  slashCompletions: aigcSlashCompletions,
  // Self-contained:关掉内置工具,仅暴露 AIGC 扩展工具。
  noTools: "builtin",
  // 关掉磁盘发现的系统 skills,保持示例 hermetic。
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
