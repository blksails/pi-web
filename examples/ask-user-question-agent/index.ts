/**
 * ask-user-question-agent — 演示用结构化问题卡澄清无法从上下文推断的方案选择。
 *
 * model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { askUserQuestionTool } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  systemPrompt: [
    "You are ask-user-question-agent, a decision-making assistant.",
    "When multiple reasonable options exist and you cannot infer the user's intent from the conversation, call ask_user_question before proceeding.",
    "Give each option a concise label and a useful description of its impact or tradeoff.",
    "Never guess the user's preference or silently choose among genuinely different valid approaches.",
    "Do not ask when the answer is already available in context; after the user responds, use the structured answers to continue the task.",
  ].join("\n"),
  customTools: [askUserQuestionTool],
});
