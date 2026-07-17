/**
 * `ask_user_question` 工具 — 一次抛出 1–4 道带选项描述的结构化问题,收敛用户作答为结构化结果。
 *
 * 背景:本特性零协议帧改动,能力经「约定式富载荷」搭载在既有 `ctx.ui.select` 交互上——
 * 把问题组编码进 `select` 请求的 title(见 {@link encodeAskRequest}),前端识别哨兵后渲染富卡片,
 * 作答经 `select` 的返回值(旧协议里就是 `extension_ui_response.value`)回传,本工具再用
 * {@link decodeAskAnswers} 解码收敛。详见 design.md「Tool (tool-kit runtime) > askUserQuestionTool」。
 *
 * 归属 tool-kit `./runtime`(node-only)入口链——依赖 pi SDK 值导入,禁止从主 barrel(`src/index.ts`,
 * 前端安全)导出。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
  AskQuestionGroupSchema,
  encodeAskRequest,
  decodeAskAnswers,
  type AskQuestionGroup,
} from "@blksails/pi-web-protocol";

/** 文本结果助手(对齐 pi 工具结果形状;镜像 examples/ui-demo-agent 的写法)。 */
function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** `defineTool` 的 parameters:1–4 题,每题 2–4 个带 label+description 的选项。 */
const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ description: "该题的短标签(≤ 约 12 字),用于卡片标题。" }),
      question: Type.String({ description: "向用户展示的完整问题文本。" }),
      multiSelect: Type.Boolean({ description: "是否允许多选;false 表示单选。" }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: "选项短标签(1–5 词)。" }),
          description: Type.String({ description: "该选项的含义/代价说明。" }),
        }),
        { minItems: 2, maxItems: 4, description: "该题的候选选项,2–4 个。" },
      ),
      allowOther: Type.Optional(
        Type.Boolean({ description: "是否额外提供 Other 自由输入框。" }),
      ),
    }),
    { minItems: 1, maxItems: 4, description: "问题列表,1–4 道。" },
  ),
});

/**
 * `ask_user_question` — agent 可调用的富提问工具。
 *
 * 何时该用:当存在多个合理的实现/设计方案、且无法从当前上下文、代码惯例或既有约定中
 * 可靠推断用户意图时,一次性提出 1–4 道问题(每题 2–4 个带说明的选项),把推荐项放在首位
 * 并在其 label 中标注「推荐」。
 *
 * 何时不该用:不要用来确认显而易见、已有唯一合理答案的事情;不要用来询问可以从代码库、
 * 文档或运行结果中直接查到的事实——那些应该自己去查,而不是打断用户。
 */
export const askUserQuestionTool = defineTool({
  name: "ask_user_question",
  label: "Ask user question",
  description:
    "Ask the user 1–4 structured questions when there are multiple reasonable approaches and " +
    "the user's intent cannot be reliably inferred from context, code conventions, or prior " +
    "instructions. Each question offers 2–4 labeled options with a short description of what " +
    "each option means/costs; put the recommended option first and mark it as recommended in " +
    "its label. Do NOT use this to confirm something obvious, or to ask about facts that can be " +
    "looked up in the codebase, docs, or tool output instead of asking the user.",
  parameters,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
    // R1.5 双保险:defineTool 的 Type.Object 约束之外,再以 codec 的 zod schema 复校。
    // 校验失败时绝不发起任何 ctx.ui 交互。
    const parsed = AskQuestionGroupSchema.safeParse(params);
    if (!parsed.success) {
      return textResult(
        "ask_user_question 入参不合法:questions 须为 1–4 道问题,每道问题的 options " +
          "须为 2–4 个(每个含 label 与 description)。请修正后重试。",
      );
    }
    const group: AskQuestionGroup = parsed.data;

    const { title, options } = encodeAskRequest(group);
    const raw = await ctx.ui.select(title, options);

    if (raw === undefined) {
      // R3.3:用户取消,不含臆造答案。
      return textResult("用户已取消提问,未提供任何答案。");
    }

    const decoded = decodeAskAnswers(raw, group);
    if (decoded.kind === "rich") {
      // R3.2:结构化答案,供模型解析。
      return textResult(JSON.stringify(decoded.answers, null, 2));
    }

    // R4.2:旧前端降级——仅收到裸选项 value,不抛错,标注降级供模型理解。
    return textResult(
      `降级作答:前端不支持富问题卡片,仅收到原生 select 的裸选项文本: ${JSON.stringify(decoded.rawValue)}`,
    );
  },
});
