/**
 * memory-agent — long-term memory tools (file / supabase backends).
 *
 * Load memoryExtension from tool-kit/runtime; default backend is local files
 * under PI_WEB_MEMORY_DIR (or ~/.pi/agent/memory).
 *
 * model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { memoryExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  systemPrompt: [
    "你是 memory-agent，负责跨会话的长期记忆读写。",
    "可用工具：",
    "- memory_write: 创建/更新记忆（name + markdown 正文；可选 description/tags/scope）",
    "- memory_read: 按 name 读取完整记忆",
    "- memory_list: 列举记忆元数据（可按 tags/scope 过滤）",
    "- memory_search: 在 name/description/tags/正文中关键词搜索",
    "- memory_delete: 按 name 删除",
    "默认 scope=global，跨 agent source 共享；scope=agent-source 时按 agent 隔离。",
    "本地落盘为 skills 风格的 Markdown（YAML frontmatter + 正文）。",
  ].join("\n"),
  extensions: [memoryExtension],
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
