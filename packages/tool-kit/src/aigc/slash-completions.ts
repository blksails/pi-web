/**
 * AIGC slash 补全候选声明(spec agent-slash-completion)。
 *
 * **声明层 / 前端安全**:纯数据 + 仅类型导入(无 pi SDK 值导入),经 tool-kit **主入口**
 * 导出(与 `aigcExtension` 执行层分离)。agent 经 `AgentDefinition.slashCompletions`
 * 引用,使 `/img-gen`、`/img-edit` 出现在输入补全;选中只填入、不执行,补词后作为普通
 * 消息发给 LLM,由 system prompt 驱动 LLM 调用 `image_generation` / `image_edit`。
 */
import type { SlashCompletionDecl } from "@blksails/pi-web-agent-kit";

/** AIGC 图像工具的 slash 命令补全候选。 */
export const aigcSlashCompletions: SlashCompletionDecl[] = [
  {
    name: "img-gen",
    description: "用提示词生成图像(image_generation)",
    insertText: "/img-gen ",
  },
  {
    name: "img-edit",
    description: "编辑最近上传的图像(image_edit)",
    insertText: "/img-edit ",
  },
];
