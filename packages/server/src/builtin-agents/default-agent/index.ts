/**
 * default-agent — pi-web 内置默认 agent(随 `@blksails/pi-web-server` 包发布)。
 *
 * 目的:让「未显式指定 source」的新建会话有一个**自包含、随包可用**的 custom-mode agent,
 * 而不是退回 cli 模式(在仓库根/任意 cwd 上跑通用 pi,缺少 runner 期特性如自动标题)。
 * 经保留 source `builtin:default-agent` 由 AgentSourceResolver 映射到本文件 → custom 模式,
 * 因此 auto-title / attachment bridge / state bridge 等 runner 期接缝全部生效。
 *
 * 设计:
 * - **零运行时依赖**:仅 `import type`(编译期擦除),default export 是纯数据对象,runner 经 jiti
 *   载入时无需解析任何外部包 —— 保证 standalone / 任意机器都能载入。
 * - **model 省略** → 继承 `~/.pi/agent/settings.json` 的 defaultProvider/defaultModel(与 examples 一致,
 *   开箱即用于任意 pi 登录)。
 * - **保留内置工具**(不设 `noTools`):read/write/edit/bash 等在位,当通用编码/问答助手用。cwd 由
 *   resolver 设为**用户工作目录**(非本文件所在的包内目录),故它操作的是用户项目、而非 pi-web 内部。
 */
import type { AgentDefinition } from "../../runner/agent-definition.js";

const definition: AgentDefinition = {
  // model 省略 → 继承 ~/.pi/agent/settings.json 默认模型。
  systemPrompt:
    "You are the pi-web default assistant — a helpful, general-purpose coding and " +
    "Q&A agent running in the user's working directory. Be concise and accurate. " +
    "Use the available tools (read/write/edit/bash) to inspect and modify files when asked.",
};

export default definition;
