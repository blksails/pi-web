/**
 * webext-renderer-agent — Tier 2 渲染器示例。
 * `.pi/web` 注册自定义渲染器:`data-metric` data-part + `echo` 工具(见 web.config.tsx)。
 *
 * 触发自定义工具渲染器(R8)的两条路:
 *  - stub:`PI_WEB_STUB_AGENT=1` 每轮发 `echo` 工具(无 LLM,e2e 用)。
 *  - 真实 LLM(本文件):注册一个 `echo` customTool,LLM 被要求回显时调用它 →
 *    产出 `tool-echo` part → 命中 `.pi/web` 的 `EchoToolRenderer`(data-testid="echo-tool-card")。
 *
 * 注:`data-metric` data-part 渲染器目前无产出点(示例缺陷,非测试问题);
 * model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
 */
import { defineAgent } from "@pi-web/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** echo:回显入参文本。工具名 `echo` 对齐 web.config 的 `renderers.tools.echo`,
 *  命中后由扩展的 EchoToolRenderer 渲染(而非默认工具卡)。 */
const echo = defineTool({
  name: "echo",
  label: "Echo",
  description:
    "Echo back the given text. Call this whenever the user asks to echo, repeat, " +
    "or mirror something — do not answer in plain text, let the tool render.",
  parameters: Type.Object({
    text: Type.String({ description: "The text to echo back." }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const text = (params as { text?: string }).text ?? "";
    return { content: [{ type: "text" as const, text }], details: undefined };
  },
});

export default defineAgent({
  systemPrompt:
    "You are webext-renderer-agent. Custom renderers come from .pi/web. " +
    "When the user asks you to echo/repeat/mirror anything, call the `echo` tool " +
    "with that text instead of replying in prose — the extension renders the result.",
  customTools: [echo],
  // 自包含:不拉入系统内置工具与磁盘技能,仅暴露本文件的 echo 工具,
  // 让 LLM 在被要求回显时稳定命中 echo(无其它工具干扰)。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
