/**
 * builtin-tools-agent — 一个**启用 pi 内置工具集**的 example agent。
 *
 * 与其它示例的工具姿态对比:
 *  - hello-agent   : `noTools: "builtin"` —— 关掉内置工具,仅保留 custom/扩展工具。
 *  - minimal-agent : `noTools: "all"`     —— 关掉一切内置/扩展工具(零能力基线)。
 *  - builtin-tools-agent(本例):用 `tools` allowlist **显式启用内置工具**。
 *
 * 工具解析规则(见 AgentDefinition):
 *  - 不设 `tools` 也不设 `noTools` → pi 默认发现行为,内置工具本就**默认启用**。
 *  - 设 `tools: [...]` → allowlist,仅启用列出的内置/扩展工具(本例显式列全内置集,
 *    既"看得见"又便于按需裁剪)。
 *  - `excludeTools: [...]` → 在 allowlist 之后再做 denylist。
 *
 * pi 当前内置工具:bash / read / write / edit / patch / ls / grep / glob / fetch。
 *
 * NOTE: `model` 故意省略 → 继承 `~/.pi/agent/settings.json` 的 defaultProvider/
 * defaultModel,并从 `~/.pi/agent/auth.json` 解析凭证,开箱即用于任意 pi 登录。
 */
import { defineAgent } from "@blksails/agent-kit";

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel。
  systemPrompt:
    "You are builtin-tools-agent, a pi-web example with the built-in filesystem and shell toolset enabled. " +
    "Use the tools to inspect and edit the project. Prefer read/ls/grep/glob before bash; keep replies concise.",
  // 显式启用内置工具集(allowlist)。去掉某个名字即关闭该工具;
  // 也可改为删除整个 `tools` 字段——默认同样启用全部内置工具。
  tools: ["read", "ls", "grep", "glob", "bash", "edit", "write", "patch", "fetch"],
  // 如需在启用内置工具的同时排除危险项,可改用 denylist,例如:
  // excludeTools: ["bash", "write", "edit", "patch"],
});
