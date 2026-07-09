/**
 * vision-agent — 视觉识别(图像理解)的**端到端示例 agent**(spec image-vision-tool)。
 *
 * 演示本特性的核心价值:**让 agent「回看」已落库的图**。
 *
 * 背景:用户上传的图会作为多模态 image part 直接送给主模型,但**落库之后**(AIGC 生成图、
 * 工具产出图)在上下文里只剩 `[attachment id=att_… …]` 文本标记 —— 模型读得到 id,读不到像素。
 * `image_vision` 把该 id 解析回图像字节,交给一个**支持图像输入的模型**,取回文字结论。
 *
 * 同时装载 `aigcExtension` 是刻意的:它让「生成一张图 → 再让 agent 描述它画了什么」
 * 这个闭环可以在**单个 agent 内**跑通 —— 这正是本特性存在之前做不到的事。
 *
 * 两个入口(共用同一内核,行为一致):
 *  - `image_vision` 工具 —— LLM 在推理中自主调用;可用 `image` 指定 `att_` id,省略则看最近一张图。
 *  - `/img_vision` 命令 —— 用户主动触发;整段参数作为提问,固定看最近一张图,
 *    结论经 `ctx.ui` 通知呈现(扩展命令不进消息历史)。
 *
 * 模型来源:候选 = `~/.pi/agent/models.json` 中**支持图像输入且凭据可用**的模型。
 * 有交互界面时弹层选择;无界面时按 `PI_WEB_VISION_MODEL`(`provider/modelId`)→ 候选首个 降级。
 * 新增一个支持图像输入的模型无需改动任何代码。
 *
 * 执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程
 * 加载,不进 Next 服务端 bundle)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcExtension, visionExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
  // 注意:主模型**无须**支持图像输入 —— 识别被委派给候选清单里的视觉模型。
  systemPrompt: [
    "You are vision-agent, a pi-web example that can *look at* images.",
    "",
    "- Use `image_vision` to inspect an image and answer a question about it.",
    "  Past images appear in your context only as `[attachment id=att_… …]` text",
    "  markers, NOT as pixels. To actually see one, call `image_vision` and copy the",
    "  public id verbatim into its `image` parameter.",
    "  Omit `image` to look at the most recent image in the session.",
    "- Use `image_generation` / `image_edit` to produce images.",
    "",
    "A natural loop: generate an image, then call `image_vision` on the returned",
    "attachment id to describe what was actually drawn.",
    "",
    "Pass `question` in the user's original language, verbatim; do NOT translate it.",
    "Keep replies concise and report the attachment id you inspected.",
  ].join("\n"),
  // 视觉识别 + AIGC 生成:两者都是进程内 ExtensionFactory。
  extensions: [aigcExtension, visionExtension],
  // Self-contained:关掉内置工具,仅暴露扩展工具。
  noTools: "builtin",
  // 关掉磁盘发现的系统 skills,保持示例 hermetic。
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
