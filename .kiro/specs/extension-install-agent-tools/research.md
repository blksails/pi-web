# Research Log — extension-install-agent-tools

## Discovery 范围

集成式 discovery（对既有 pi-web + pi SDK 的扩展）。聚焦四个机制：①内置工具/扩展如何注入所有 agent；②agent 工具内如何执行装包；③工具如何触发 reload（排队 follow-up）；④门控 env 如何到工具侧 + /plugin 清理面。

## 关键发现

### F1. 强制注入机制：`forcedExtensionPaths`（架构支点）
- `packages/server/src/runner/option-mapper.ts:242-253`：`buildRuntimeFactory` 读 `PI_WEB_SANDBOX_ENTRY` → `forcedExtensionPaths: string[]` → `mapResourceLoaderOptions` → `createAgentSessionServices`。**这是「无论用户 agent 是什么，强制给每个会话注入一个 pi 扩展（按文件路径）」的现成机制**（沙箱 enforcement 已用它）。
- **结论**：把 pi-web 自带的「扩展管理扩展」文件路径加入 `forcedExtensionPaths`，即可对所有 agent 生效，无需改用户 agent 的 `customTools`。pi 扩展可 `registerTool` + `registerCommand`，承载工具 + reload 命令。
- 对比：`customTools`（option-mapper.ts:291）只透传用户 agent 自声明的工具；attachment 经 globalThis seam 注入 context（`attachment-wiring.ts:150`）——都不是「强制注入工具」。故选 forcedExtensionPaths。

### F2. 工具内装包：`pi.exec("pi", ["install", …])`
- pi SDK 不向 `ExtensionContext` 暴露 PackageManager（`dist/core/extensions/types.d.ts:208-241` 无 packageManager）。`DefaultPackageManager`（`dist/core/package-manager.d.ts`）仅运行时内部用。
- **唯一可行**：扩展经 `pi.exec("pi", ["install", source, ...flags], { signal, timeout })` spawn pi CLI（docs `extensions.md:1526-1533` 有示例）。装到当前会话 agent 的 `PI_CODING_AGENT_DIR`（子进程 env 决定，落到 `<HOME>/.pi/agent` 或显式 agentDir）。

### F3. 排队 reload：`pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" })`
- 工具不能 `ctx.reload()`（`ExtensionContext` 无 reload；只有命令的 `ExtensionCommandContext.reload()`，`dist/core/extensions/types.d.ts:246-283`），直接调会死锁。
- **标准模式**（官方示例 `examples/extensions/reload-runtime.ts`）：扩展 `pi.registerCommand("reload-runtime", { handler: async (_a, ctx) => { await ctx.reload(); } })` + 工具 `pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" })`（`docs/extensions.md:1343-1369`；`steer`=本回合后立即投递，`followUp`=空闲后投递）。
- 内置 `/reload` 仅 TUI 模式硬编码，**RPC 模式无内置 reload**，须 pi-web 自定义 `/reload-runtime`。

### F4. ctx.ui 在工具内 RPC 模式可用
- `dist/modes/rpc/rpc-mode.js:82-135`：`notify`/`setStatus`/`setWidget` 在 RPC 模式**真实发帧**（extension_ui_request）。`setWidget` RPC 仅支持字符串数组（不支持组件工厂）。`custom` 是空操作（无关本特性）。
- 这些帧在 agent 回合内经已开的 per-prompt SSE 流 → translate → control:extension-ui → ControlStore → StatusBar/通知/Widgets 渲染（既有链路，无需改）。

### F5. 门控 env 传递
- 门控 env（`PI_WEB_EXT_ADMIN_ALLOW_ANY` / `PI_WEB_EXT_ALLOW_LOCAL` / `PI_WEB_EXT_ALLOW_NPM`）现仅主进程 pi-handler 读（`pi-handler.ts:320-327`）。
- spawn env 下发范本：`attachmentSpawnEnv()`（`pi-handler.ts:171-180`）+ `PI_WEB_SANDBOX_ENTRY`（`pi-handler.ts:308`）经 `spawnSpec.env` 下发，子进程读（`option-mapper.ts:244` / `attachment-wiring.ts:141`）。
- **结论**：把门控 env 经 `spawnSpec.env` 下发给 agent 子进程，扩展读 `process.env` + 复用 `checkAllowlist`（`source-allowlist.ts`，纯函数，可由扩展 import）做白名单判定后才装。

### F6. /plugin 清理面（彻底替换）
- 删整文件：`lib/app/plugin-command/plugin-host-command.ts`、`components/plugin-panel.tsx`、`test/plugin-host-command.test.ts`、`e2e/browser/plugin-command.e2e.ts`。
- 改：`pi-handler.ts`（hostCommands 去掉 plugin，留 clear）、`packages/tool-kit/src/commands/builtin.ts`（BUILTIN_COMMANDS 去掉 PLUGIN，留 CLEAR）、`components/chat-app.tsx`（删 plugin state/wiring/PluginPanel/onCommandStart 接线，本会话刚加的也回退）、`packages/ui/src/chat/pi-chat.tsx`（删 onCommandStart prop，本会话刚加的）、`test/chat-app.test.tsx`（删本会话加的 2 个 plugin 测试）、`test/builtin-command-merge.test.ts` / `packages/server/test/http/host-command-routes.test.ts`（去掉 plugin 期待）。
- 保留：`source-allowlist.ts` / `install-args.ts` / `pi-cli.ts`（REST /extensions 路由仍用；新扩展也复用 allowlist）；`/clear` 全链路；`onCommandResult`（clear-transcript 仍用）。

## 设计决策（synthesis）

- **D1（注入方式）**：采用 **forcedExtensionPaths 强制注入 pi-web 自带「扩展管理扩展」**，而非 customTools。理由：要对所有 agent 生效（用户决策），customTools 只能用户 agent 自声明。复用既有沙箱 enforcement 同款机制。
- **D2（装包）**：扩展内 `pi.exec("pi install …")`（pi 未暴露 in-process 包管理 API）。装到会话自身 agentDir。
- **D3（reload）**：扩展自带 `/reload-runtime` 命令 + 工具排队 `followUp`（pi 原生模式，RPC 无内置 reload）。
- **D4（门控）**：门控 env 经 spawn env 下发，扩展复用 `checkAllowlist` 在装前判定（安全不回归）。第一个调研子代理建议「install 留主进程」与用户决策（彻底改 agent 工具）冲突——以**用户决策为准**，但门控逻辑（白名单）必须随之搬到工具侧执行。
- **D5（呈现）**：复用 `ctx.ui.setStatus/notify`（进度/结果）+ `setWidget`（list）→ 既有 StatusBar/通知/Widgets，零前端模态。

## 风险

- **R1 reload 可靠性**：`pi.sendUserMessage(followUp)` 依赖 RPC 模式正确投递 follow-up 用户消息且触发命令。须 e2e 验真实管道（reload 后扩展生效）。降级（R3.3）：reload 失败提示手动重启。
- **R2 跨包 import**：扩展（agent 子进程加载）import `@blksails/pi-web-server` 的 `checkAllowlist`——纯函数、轻依赖，确认不会把重依赖拉进子进程 bundle；必要时把 allowlist 抽成更小的可共享模块。
- **R3 强制扩展加载失败**：forcedExtensionPaths 指向的扩展文件解析/加载失败会影响所有会话启动 → 须优雅降级（加载失败不阻塞会话，仅扩展管理不可用），并有诊断。
- **R4 standalone 打包**：扩展文件须被 next standalone 产物纳入（outputFileTracingIncludes），否则 CLI 模式找不到（参照 runner/pi SDK 既有 includes）。
