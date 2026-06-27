# Implementation Plan

> 把扩展安装从 host 命令 `/plugin` + 模态面板，改为经 `forcedExtensionPaths` 强制注入每个 agent 的「扩展管理扩展」（registerTool install/uninstall/list + registerCommand reload-runtime），用 `ctx.ui` 呈现、`pi.exec` 装包、`sendUserMessage(followUp)` 触发 reload、`checkAllowlist` 门控。

## 1. 工具侧门控（gate）

- [ ] 1.1 抽取/确认 `checkAllowlist` 可被 tool-kit 复用
  - 确认 `packages/server/src/extensions/install/source-allowlist.ts` 的 `checkAllowlist` + `assembleInstallArgs`(install-args.ts) 为纯函数、无重依赖；tool-kit 能 import（依赖方向不成环）。若成环/拉重依赖，把 allowlist 解析抽到独立小模块。
  - 观察完成：tool-kit 测试能 import 并调用 checkAllowlist 通过编译。
  - _Requirements: 4.4_

- [ ] 1.2 `gate.ts`：读门控 env + checkAllowlist 封装
  - `packages/tool-kit/src/extension-tools/gate.ts`：`gateInstall(source): {allowed, source?, reason?}` 读 `PI_WEB_EXT_ADMIN_ALLOW_ANY`/`PI_WEB_EXT_ALLOW_LOCAL`/`PI_WEB_EXT_ALLOW_NPM` 组装 allowlist → checkAllowlist。
  - 观察完成：单测覆盖「门控全关拒绝 / ALLOW_LOCAL 放行 local / ALLOW_NPM 放行 npm / 非白名单拒绝」。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: extension-tools/gate_

## 2. 扩展管理扩展（核心）

- [ ] 2.1 扩展骨架 + reload-runtime 命令
  - `packages/tool-kit/src/extension-tools/extension-manager.ts`：默认导出 `(pi) => {…}`，`pi.registerCommand("reload-runtime", { handler: async (_a, ctx) => { await ctx.reload(); } })`。
  - 观察完成：单测（注入假 pi）断言注册了 reload-runtime 命令、handler 调 `ctx.reload()`。
  - _Requirements: 3.1, 3.2_
  - _Boundary: extension-tools/extension-manager_

- [ ] 2.2 `install_extension` 工具：门控 + ctx.ui 进度 + pi.exec + 排队 reload
  - registerTool install_extension({source, local?})：先 `ctx.ui.setStatus("ext-install","安装中: <source>…")`；`gateInstall` 不过 → `ctx.ui.notify(来源被拒,error)` + 清状态 + 返回；过 → `pi.exec("pi",["install",sourceArg,"--no-approve",...(local?["-l"]:[])])`；非零 → notify 失败 + 清状态；成功 → 清状态 + `notify("已安装…")` + `pi.sendUserMessage("/reload-runtime",{deliverAs:"followUp"})`。
  - 观察完成：单测断言（假 pi/ctx）顺序：setStatus(安装中) 先于 exec；门控拒绝不调 exec；成功调 sendUserMessage(followUp)；失败 notify。
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 3.1, 4.1, 5.1_
  - _Boundary: extension-tools/extension-manager_
  - _Depends: 1.2, 2.1_

- [ ] 2.3 `uninstall_extension` + `list_extensions` 工具
  - uninstall：`pi.exec("pi",["remove",name])` + ctx.ui 进度/结果 + 排队 reload。list：`pi.exec("pi",["list"])` 解析 → `ctx.ui.setWidget("ext-list",[lines])`。
  - 观察完成：单测断言 uninstall 调 remove + 排队 reload；list 调 setWidget 含解析行。
  - _Requirements: 1.3, 1.4, 2.4, 3.1, 5.1_
  - _Boundary: extension-tools/extension-manager_

- [ ] 2.4 barrel + 路径解析导出
  - `packages/tool-kit/src/extension-tools/index.ts` 导出扩展；新增解析「扩展文件绝对路径」的工具函数（standalone 可重定位，参照 resolvePiCliEntry 思路）供 server/app 调。
  - 观察完成：导出可被 server 包 import；路径解析返回存在的文件。
  - _Requirements: 1.1_

## 3. 强制注入接线（server + app）

- [ ] 3.1 option-mapper：forcedExtensionPaths 追加扩展工具入口
  - `packages/server/src/runner/option-mapper.ts`：在 `PI_WEB_SANDBOX_ENTRY` 之外读 `PI_WEB_EXT_TOOLS_ENTRY`，非空则 push 进 forcedExtensionPaths。
  - 观察完成：单测——env 设置时路径进 forcedExtensionPaths；空时不进；与 sandbox entry 并存。
  - _Requirements: 1.1, 1.5_
  - _Boundary: runner/option-mapper_

- [ ] 3.2 pi-handler：下发扩展入口 + 门控 spawn env
  - `lib/app/pi-handler.ts`：解析扩展管理扩展文件路径 → `spawnSpec.env.PI_WEB_EXT_TOOLS_ENTRY`；新增 `extToolsSpawnEnv()` 把门控 env 经 spawnSpec.env 下发（仿 attachmentSpawnEnv）。
  - 观察完成：起会话后子进程 env 含 PI_WEB_EXT_TOOLS_ENTRY + 门控开关；不污染主进程。
  - _Requirements: 1.1, 4.4, 5.2_
  - _Depends: 2.4, 3.1_

- [ ] 3.3 standalone 打包纳入扩展文件
  - `next.config.ts` outputFileTracingIncludes 纳入扩展管理扩展文件（CLI 模式可加载）。
  - 观察完成：build:cli 后产物含该扩展文件（或 e2e:cli 加载成功）。
  - _Requirements: 1.1_

## 4. 清理：移除 /plugin host 命令 + 模态面板

- [ ] 4.1 移除 host 命令 /plugin
  - 删 `lib/app/plugin-command/plugin-host-command.ts`；`pi-handler.ts` hostCommands 去掉 plugin 注册（留 createClearHostCommand）。
  - 观察完成：`/plugin` 不再注册为 host 命令；/clear 仍在。
  - _Requirements: 6.1, 6.4_

- [ ] 4.2 移除内置斜杠命令 /plugin
  - `packages/tool-kit/src/commands/builtin.ts`：BUILTIN_COMMANDS 去掉 PLUGIN 留 CLEAR。
  - 观察完成：BUILTIN_COMMANDS 仅含 clear；builtin-command-merge / host-command-routes 测试期待更新通过。
  - _Requirements: 6.1, 6.3_

- [ ] 4.3 移除前端模态面板与 wiring
  - 删 `components/plugin-panel.tsx`；`components/chat-app.tsx` 删 plugin state（pluginPanelOpen/Items/Error/Busy）、applyCommandOutcome、onPluginExecute、beginPluginCommand、`<PluginPanel>`、相关 import；`packages/ui/src/chat/pi-chat.tsx` 删本会话临时加的 onCommandStart prop/调用/deps（保留 onCommandResult 供 /clear）。
  - 观察完成：构建无 PluginPanel；输入 /plugin 不开面板；/clear clear-transcript 仍工作。
  - _Requirements: 6.2, 6.3, 6.4_

- [ ] 4.4 清理相关测试
  - 删 `test/plugin-host-command.test.ts`、`e2e/browser/plugin-command.e2e.ts`；改 `test/chat-app.test.tsx`（删本会话加的 2 个 plugin 测试）、`test/builtin-command-merge.test.ts`、`packages/server/test/http/host-command-routes.test.ts`（去 plugin 期待）。
  - 观察完成：全包单测绿，无 plugin/PluginPanel 悬空引用。
  - _Requirements: 6.5_
  - _Depends: 4.1, 4.2, 4.3_

## 5. 验收：单测 + e2e

- [ ] 5.1 扩展工具单测齐全
  - 汇总 task 1.2/2.1/2.2/2.3 的单测 + option-mapper 注入单测（3.1）；覆盖装包/门控/排队 reload/list/ctx.ui。
  - 观察完成：`pnpm --filter @blksails/pi-web-tool-kit test` + server option-mapper 测试绿。
  - _Requirements: 6.5_

- [ ] 5.2 node e2e（隔离 stub）
  - stub sentinel 模拟扩展工具发的 setStatus/notify 帧 → 经 translate → SSE control:extension-ui 回流可见。
  - 观察完成：`pnpm e2e:node` 相关用例绿。
  - _Requirements: 2.1, 2.2, 2.5_

- [ ] 5.3 browser e2e（隔离 HOME + 真实 pi）
  - 隔离 HOME + 真实 runner + 最小稳定 source（不依赖易删 example）：触发 install_extension → StatusBar「安装中→已安装」可见、`<HOME>/.pi/agent/settings.json` 写入、reload 后生效、真实 ~/.pi 零污染；门控关拒绝非白名单源；/plugin 不再开面板。须 `rm -rf .next-e2e` 全量重建 + `PI_WEB_DISABLE_STANDALONE=1`。
  - 观察完成：playwright 用例绿（新鲜运行取证）。
  - _Requirements: 2.1, 2.2, 2.5, 3.1, 4.1, 5.1, 5.2, 6.2_
  - _Depends: 2.2, 3.2, 4.3_
