/**
 * file-session-agent — 演示「文件存储会话」的最小 example agent。
 *
 * 这个 agent 本身和 hello-agent 一样是一个普通 {@link AgentDefinition}(由 bootstrap
 * runner 经 jiti 载入到 pi 会话运行时)。它的特别之处在于**会话如何被持久化**:
 *
 *   pi 运行时的会话由第三方 SDK 的 `SessionManager` 以 append-only 的 JSONL **文件**
 *   持久化到 `<agentDir>/sessions/--<cwd 编码>--/<时间戳>_<id>.jsonl`。`@pi-web/server`
 *   的 `FsSessionEntryStore` 正是以**完全兼容**该布局的方式读写同一批文件——因此本
 *   agent 跑出来的会话文件,可以被 `FsSessionEntryStore` 直接 `list`/`read` 回来(并在
 *   领域层重建事件树)。
 *
 * 对应的端到端验证见:
 *   packages/server/test/session-store/file-session-agent.e2e.test.ts
 *
 * NOTE: `model` 故意省略 → 继承 `~/.pi/agent/settings.json` 的 defaultProvider/
 * defaultModel,并从 `~/.pi/agent/auth.json` 解析凭证,开箱即用于任意 pi 登录。
 */
import { defineAgent } from "@pi-web/agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** 一个把内容“记入会话”的小工具——它的调用会作为 toolResult 进入会话事件树并落盘。 */
const note = defineTool({
  name: "note",
  label: "Note",
  description: "Record a short note. Its content becomes part of the persisted session.",
  parameters: Type.Object({
    text: Type.String({ description: "Note text to persist into the session." }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `noted: ${params.text}` }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are file-session-agent, a pi-web example whose conversation is persisted to a JSONL session file. Keep replies short.",
  customTools: [note],
});
