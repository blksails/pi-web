/**
 * file-session-agent — 配合「文件存储会话」演示的最小 example agent。
 *
 * ⚠️ 重要澄清:`AgentDefinition` **没有、也不该有**会话存储配置。会话存到哪里是
 * **运行时**的事,不是 agent 定义能表达的——本文件里看不到任何 file 存储配置是正常的。
 * 文件存储配置的真正落点见同目录 `README.md`,简述如下:
 *   1. 运行时由 pi SDK 的 `SessionManager` 决定持久化方式;runner 默认
 *      `SessionManager.create(cwd)` → 以 append-only JSONL **文件** 写到
 *      `<agentDir>/sessions/--<cwd 编码>--/<时间戳>_<id>.jsonl`。
 *   2. **存哪个目录**由 runner 的 `--agent-dir <dir>` 控制(→ `<dir>/sessions`);
 *      要改为不落盘则注入 `SessionManager.inMemory()`。
 *   3. `@pi-web/server` 的 `FsSessionEntryStore` 以**完全兼容**该布局读写同一批文件,
 *      因此本 agent 跑出来的会话文件可被 `FsSessionEntryStore` 直接 `list`/`read` 回来。
 *
 * 本 agent 自身只是一个普通的、与存储无关的 {@link AgentDefinition}(由 bootstrap runner
 * 经 jiti 载入);它存在的意义是作为「真实 agent 产出文件 → FsSessionEntryStore 回读」
 * 端到端验证的目标。验证见:
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
