# 验收证据 — plugin-system-unification

worktree：`pi-web-plugins`，分支 `feat/plugin-system-unification`（基于 `feat/session-snapshot-authority`）。
日期：2026-06-29。全程离线（无真实 LLM / 无 API key）。

## 新鲜运行证据

### 单元测试（10/10 绿）
```
pnpm --filter @blksails/pi-web-server exec vitest run test/plugin
 ✓ test/plugin/effect-orchestrator.test.ts (5 tests)
 ✓ test/plugin/resolve-plugin.test.ts (5 tests)
 Test Files  2 passed (2)   Tests  10 passed (10)
```
- `resolve-plugin`：有清单 / 无清单回退目录约定 / 声明 webext 但 dist 缺失 / 非法 JSON / 声明路径缺失。
- `effect-orchestrator`：仅 pi / 仅 webext / 双层 / reload 抛错不阻断 webext / webext 抛错不阻断 reload。

### typecheck（3 包绿）
```
pnpm --filter @blksails/pi-web-protocol --filter @blksails/pi-web-server --filter @blksails/pi-web-ui run typecheck
 packages/protocol typecheck: Done
 packages/server   typecheck: Done
 packages/ui       typecheck: Done
```

### 构建（绿）
- `NEXT_DIST_DIR=.next-e2e pnpm build` → exit 0（standalone）。
- `PI_WEB_DISABLE_STANDALONE=1 NEXT_DIST_DIR=.next-e2e pnpm build` → exit 0（e2e 用，`next start` 兼容）。
- webext 示例构建：`plugin-code-review` → `.pi/web/dist/web-extension.mjs`（sha384-UjjP4v…）+ manifest.json。

### 浏览器 e2e（绿）
外部 server 模式（`PI_WEB_E2E_EXTERNAL_SERVER=1` + `next start -p 3100`，stub agent）：
```
plugin-system-unification.e2e.ts
 ✓ 统一插件:pi 工具 code_review 由 webext Tier2 渲染器渲染为富卡(两层咬合) (3.5s)
 1 passed (4.2s)
```
无回归（相邻 e2e）：
```
 ✓ tool-call-ui.e2e.ts (3 tests)   ✓ webext.e2e.ts (3 tests)
 6 passed (8.4s)
```

## 实现期现实校正（勘探结论）
原 design 标为缺口的下列项，勘探确认**已满足**，本特性仅验证：
- R5 安装入口：`lib/app/pi-handler.ts:435-446` 已挂载 `createExtensionRoutes` 并注入真实 `reloadSession`。
- R2.3 busy 修复：sha `36c82fc` 已在 main（`PiChat onSubmit` fire-and-forget）。
- R6 补全合流：`pi-command-palette.tsx:545-563` 已把 webext Tier3 slash 与 pi/builtin 命令合并渲染。

真正的新工作：① 统一清单标准 R1；② R7 路②前端接线（`setWebextReloadNonce` 此前从未被调用，新增 `onRuntimeReloadRequested` 接缝接通）；③ 示例 + stub sentinel + e2e。

## 增量：R9 声明 web 可见 slash 命令（2026-06-29 追加）

动因：实机发现插件的 `/review`（`source:extension`）被平台「默认隐藏扩展命令」策略挡住。
busy 卡死已修（`36c82fc`），但不可粗暴翻全局默认（破坏"默认隐藏"不变量 + 单测）。
方案：`pi-plugin.json` 声明 `web.commands`，server 回填 `webVisible`，前端对 `webVisible` 放行（安全网保留）。

实现：protocol（`PluginWebSchema.commands` + `RpcSlashCommand.webVisible`）/ server（`webCommands` +
`enrich-web-visible.ts` 接入 `makeCommandsHandler`）/ ui（`isCommandVisible` 放行 `webVisible`）/
示例声明 `web.commands:["review"]`。

新鲜证据：
```
server 单测：14 passed（resolve-plugin 5 / effect-orchestrator 5 / enrich-web-visible 4）
ui 单测：    18 passed（含「webVisible 默认放行」例）
typecheck：  protocol / server / ui 三包 Done
```
实机（dev 仅 `PI_WEB_TRUST_PROJECT=1`，**无** allowlist env）：
```
GET /sessions/:id/commands → review: { source:"extension", webVisible:true,
  sourceInfo.path: .../plugin-code-review-agent/.pi/extensions/code-review.ts }
```
→ `/review` 经 `webVisible` 默认可见，不再依赖 `NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST`。

> 命令补全的**浏览器** e2e 未覆盖：stub 模式不加载真实 pi 扩展（get_commands 无 `/review`），
> 而 webVisible 路径依赖真实扩展加载 + trust；以 server/ui 单测 + 实机 API 验证共同保障。

## 增量：R10 fire-and-forget 扩展命令的 ctx.ui 反馈可见（2026-06-29 追加，浏览器实测发现）

实机用 chrome-devtools 测 `/review` 时发现"命令没反映"。逐层定位：
1. 补全正常（DOM 确认 `/review` 在浮层，`webVisible:true`）。
2. 服务端**全跑通**（GET /messages 证实命令执行：followUp 注入 → LLM 调 `code_review` 工具 → "2 issues found"）。
3. 真因：fire-and-forget 命令的 `ctx.ui`（extension-ui）帧被空闲控制流丢弃——`openControlOnlyStream`
   以 `applyAmbient:false` 打开（gate 到命令前为 false 的 extCtrlActive），`connection.ts:234-242`
   只在 `applyAmbient` 时应用 `control:extension-ui` 帧。
4. 且通知 5s 自动消失太快，重要信息错过。

修复：
- `pi-chat.tsx`：空闲控制流恒 `applyAmbient:true`（仅空闲期开、不与 per-prompt 流并存，安全）；
  effect 依赖 `extCtrlActive`→`needsIdleControl`，使有 contributions 的扩展流不重连（消除竞态）。
- `notifications.tsx`：级别感知——`info` 5s 自动消失，`error`/`warning` 持久需手动关闭。
- 示例 `/review`：改为本地启发式检视 + `ctx.ui.notify(findings)`，不触发 turn（fire-and-forget 不订阅 turn 输出）。

证据：
```
notifications 单测：7 passed（含「warning/error 即使 autoDismissMs>0 也不自动消失」）
ui typecheck：Done
浏览器实测(chrome-devtools)：
  - session_start sandbox 通知渲染(applyAmbient 修复前不显示)
  - /review 提交 → 通知持久显示:"代码检视:发现 2 个问题 — 使用了 var,建议 let/const；使用了 =="
  - 8s 后(超过旧 5s)warning 通知仍在(级别感知持久生效)
  - 项目级 .pi/extensions 经 PI_WEB_TRUST_DEFAULT_CWD(默认开)开箱加载,无需 PI_WEB_TRUST_PROJECT
```

## 调查：R11 命令消息流一致性 + R12 项目 skill 加载（2026-06-29 追加）

### R11 消息流/历史一致性（实测）
| 情形 | 实时 transcript | 持久化 GET /messages | 冷恢复 |
|---|---|---|---|
| 普通消息 | 乐观气泡+流式 | 全持久 | 一致 |
| 纯 ctx.ui 命令（`/review`）| 无气泡（仅 ambient 通知）| **0 条** | 空 |
| 触发 turn 的命令（followUp 版）| **实时无渲染** | followUp user+assistant+toolResult 全持久 | **回放冒出一轮** |

根因：fire-and-forget 命令不开 per-prompt 流、不加乐观气泡（busy 修复所致）；agent 把斜杠命令当动作执行、
不记普通命令文本。→ 触发 turn 的命令实时↔历史不一致（最尖锐）。修法（R11）：订阅有界输出流渲染产出、
不以 finish 门控输入。**已立项，待实现。**

### R12 项目 skill 不出 `skill:` 命令（深挖结论）
实测：pi-web 下任何项目 skill 都不出现为 `skill:` 命令——连已知 `pi-probe-agent` 的探针 skill 也不出（systemic）。
**逐层排除（全部应通过）**：
- 示例 skill 已在 `.pi/skills/code-review/SKILL.md`（自运行 top-level 路径,与扩展同位）。
- `def.skills` 未设（`defineAgent` 恒等函数,`skills?` 可选）→ option-mapper 不设 skillsOverride。
- `loadSystemSkills` 默认 true → 不注入 `--no-skills`。
- SDK `collectSkillEntries` 递归进子目录命中 `code-review/SKILL.md`；`isEnabledByOverrides` 默认 enabled=true。
- `projectTrusted` 为真（同 gate 下扩展能加载;`trust:true` 显式也试过）。
- SDK RPC 模式 get_commands **确含** `session.resourceLoader.getSkills().skills → skill:<name>`（rpc-mode.js:519-527）。
- 非时序（6s 等待仍空）。

**根因已定位（突破）**：之前查 dev 日志查错地方——`PiRpcProcess` 把 runner 子进程 stderr 收进
`stderrBuffer` 并经 `stderr-log-parser` 包成 `proc:stderr`(warn)写**会话日志**(非 dev 日志)。在
runner 加诊断 + 开 logging 查会话日志,得：
```
[skill-debug] runner.ts reached; cwd=.../plugin-code-review-agent;
  skills={"count":4,"names":["code-review-skill","agent-browser","autoresearch-skill","find-skills"],...}
```
→ **skill 机制完全正常**:`getSkills()` 返回含 `code-review-skill` 的 4 个技能,RPC get_commands 正常出
`skill:code-review-skill`。之前 0 个是因为用真实 `~/.pi/agent`(此处用临时空 agentDir 才显)。

真因 = **两层叠加**：
1. **cwd 读错**:`create-session` 未传 cwd → pi-handler `cwd = opts?.cwd ?? config.defaultCwd`(仓库根)
   → `systemResourceArgs(agentDir, 仓库根)` 读仓库根 `.pi/settings.json`(无)→ 回退全局
   `~/.pi/agent/settings.json` 的 **`loadSystemSkills:false`** → 注入 `--no-skills`。
   **agent source 目录的 `.pi/settings.json` 覆盖从未被读**(故我加的项目级 `loadSystemSkills:true` 无效)。
2. **`--no-skills` 过宽**:`option-mapper.ts:186` 用空 override 清**全部** skills(含项目 `.pi/skills`)。

诊断代码已移除。修法见 R12 AC(systemResourceArgs 用 source cwd + `--no-skills` 按 scope 保留项目 skill)。
示例 `.pi/settings.json {loadSystemSkills:true}` 保留(语义正确,Fix#1 落地后即生效)。

### R12 Fix#1 已实现验证（2026-06-29）
`lib/app/pi-handler.ts`：systemResourceArgs 改读 agent source 自身目录的 `.pi/settings.json`（本地目录源
以自身为项目根,与 runner 发现 cwd 一致）。实机验证（真实 `~/.pi/agent` 全局 `loadSystemSkills:false`）：
```
建会话 ./examples/plugin-code-review-agent(裸请求)→ get_commands:
  skill:code-review-skill ✓ (+ review 命令 + 用户级 skill)
```
→ per-source `.pi/settings.json{loadSystemSkills:true}` 现在生效,示例 skill 加载。app typecheck 绿。
### R12 AC2 已实现验证（2026-06-29）
`option-mapper.ts`:`--no-skills` 不再空清,改为按 `sourceInfo.scope === "project"` 过滤(保留项目 skill,
排除 user/包/temporary)。复杂点已解:SDK `Skill` 类型在 skillsOverride 输入即带 `sourceInfo.scope`
(loadSkills 已填),无需 cwd/filePath 启发式。删除示例 `.pi/settings.json` 兜底(AC2 后项目 skill 自动保留)。
证据:option-mapper 单测(proj 保留/usr·tmp·noscope 排除)+ runner 全套 **87 测试无回归**;**实机**——
真实 agentDir(全局 `loadSystemSkills:false`)下,无项目覆盖,get_commands 仅 `skill:code-review-skill`(项目)
加载,用户级 skill(agent-browser/find-skills 等)正确排除。

### R11-A 上游阻塞（2026-06-29）
认真做方案 A(runner 发 command-complete)时撞到架构边界:pi-web `runner.ts:319` 把 RPC 循环**完全委托**
给 SDK 的 `runRpcMode`;而 `runRpcMode` 的 `case "prompt"`(rpc-mode.js:294-316)**只在 preflight 成功时回 ack**
(解释 16ms 快速 ack)、**忽略 `session.prompt` 完成的 promise**。故 pi-web **无干净 seam** 在命令/turn 完成时
emit command-complete——A 需**上游 SDK 改动**(让 runRpcMode 发 prompt-complete)。pi-web 单方可行的是
**B-server**(PiSession 观察 agent 事件流:命令 prompt 后窗口内无 `agent_start`→判纯命令→合成 complete;
`agent_start` 在 turn 起始即发,不切断真实 turn)。

### R11 已实现（B-server，2026-06-29）
- server `PiSession` 命令-turn watcher:斜杠命令 prompt 武装 1500ms 计时器;窗口内 `agent_start`→取消
  (真 finish 收尾),无→合成 `finish` UiMessageChunk 帧。仅命令路径触发,普通消息零影响。
- 前端命令改走正常 send(useChat):渲染 `/cmd` 气泡 + turn(实时↔历史一致),删 fire-and-forget +
  `armExtControlStream` 整套机制。
- 证据:watcher 单测 **3/3**;**session 全套 210 测试无回归**;server+ui typecheck 绿;浏览器实测 `/review`
  经 doSend → 用户气泡 + notify 渲染 + 不卡死 + 转录区干净(合成裸 finish 不冒空助手气泡)。
- 代价:纯命令输入 ~1.5s 窗口后解冻(无完成信号的固有取舍)。

## 增量:纯扩展命令的历史持久化（R13 = 落地 R11-AC4，2026-06-29）

### SDK 勘探(决定机制)
- `get_messages` 返回 `session.messages`(= `agent.state.messages`,AgentMessage[] 带 ms `timestamp`)。
- `appendCustomEntry` 写 session **文件条目** `type:"custom"`——**不在** `session.messages`、**不进** `convertToLlm`
  (`messages.js`:`convertToLlm` 把 `role:"custom"` message 映射成 `role:"user"` 进上下文,故 message 级持久化
  会污染 LLM 且纯命令后接真实 prompt → 连续 user 角色 provider 风险)。→ 选 appendCustomEntry + 服务端合并。
- 命令 vs skill 两条路(`agent-session.js` prompt):`/review` 走 `_tryExecuteExtensionCommand` 即返回(不留 message);
  `/skill:foo` 非扩展命令 → `_expandSkillCommand` 展开成 `<skill>` 块当 prompt 触发 turn → 自然进上下文+持久化(已一致,不触碰)。

### 实现(三段)
1. **持久化 seam**(`runner/command-marker.ts`):`runRpcMode` 前包裹 `session.prompt`——`runRpcMode` 在调用点
   读 `session.prompt`(`rpc-mode.js` `let session=runtimeHost.session` + `session.prompt(...)`),故实例级 monkeypatch
   生效。注册表无关检测:slash + prompt 后 `messages.length` 未变且 `!isStreaming` → 纯命令 →
   `appendCustomEntry("piweb.command",{text})`。普通消息/skill 增 message、触发 turn 进 streaming 自动排除。
2. **Surfacing**(`query-routes.makeMessagesQueryHandler` + `lib/app/command-markers.ts` 经 `loadCommandMarkers` 注入):
   `GET /messages` 取 `get_messages` 后,经 `SessionEntryStore.read` 读 `piweb.command` 标记,`mergeCommandMarkers`
   按 ts 稳定合并为 `role:"user"` 文本消息(同 ts 消息在前标记在后;缺 ts 退化追加末尾)。仅影响 web 历史响应。
3. **前端零改**:合并出的标记即普通 `/review` user 气泡,与 R11 实时乐观气泡一致。
4. stub 加 `/review` 纯命令 sentinel(不发 turn、写 piweb.command),镜像真实 runner seam,供离线 e2e。

### 新鲜证据
```
server 单测:command-marker 6 + mergeCommandMarkers 6 = 12 passed
server 全套(runner+http+session 等):418 passed | 5 skipped 无回归
typecheck:root tsc EXIT=0(含 lib/app)+ 受影响包 Done
浏览器 e2e(隔离 build .next-e2e + 外部 server,fs):
  ✓ plugin-pure-command-history(R13):提交 /review → 实时气泡 → 删内存会话冷恢复 → /review 气泡仍在
  ✓ 相邻无关无回归:plugin-system-unification 1 + tool-call-ui 3 + session-persistence(fs) 1
```

### 预存的、与 R13 无关的失败(诚实记录,已隔离确认)
- `session-persistence.e2e.ts` 的 **sqlite project** 冷恢复("Failed to create session: pi http error 404")——
  **注释掉 R13 的 `loadCommandMarkers` 注入后重建,仍同样失败**,证明属**预存问题**(sqlite 浏览器冷恢复路径,
  与本特性无关;fs project 同测通过,sqlite-store 单测 + mirror sqlite e2e 在 node 层亦绿)。**不在 R13 范围**。
- webext-runtime-install / webext-document-title 等 webext e2e:需特定 env(扩展 base-url / 验签),本次外部
  server 未注入 → 环境性失败,非 R13 回归。

## 增量:skill 命令历史显示折叠（R14，用户实测发现，2026-06-30）

### 问题（用户截图实证）
`/skill:<name>` 经 SDK `_expandSkillCommand` 展开成 `<skill name="…">…</skill>` 块当 prompt 持久化:
**实时**乐观气泡显示 `/skill:code-review-skill`(短),**历史回放**(`get_messages` → 展开块)显示整段
SKILL.md 正文(References/Code Review/何时触发/步骤…)——刷新后才暴露的显示不一致。与 R13(0 持久化)不同,
这是"已持久化但展示形态不一致"。

### 修法（与 R13 正交,仅前端显示）
`agent-message-to-ui.ts` 加 `collapseSkillExpansion`(与既有 `stripAttachmentRefs` 同性质):正则匹配展开块
折叠回 `/skill:<name>`(有 args 保留),在 `userParts` string/数组 text 两路于 `stripAttachmentRefs` 前调用。
仅改前端历史显示,**不动** server message log(LLM 上下文仍是展开内容,保留 skill 进上下文本意)。
stub 加 `/skill:<name>` sentinel 镜像 SDK 展开(持久化展开块为 user 消息 + 干净 turn)供离线 e2e。

### 新鲜证据
```
react 单测:agent-message-to-ui 28 passed(+5:string/数组/带 args/普通文本不误折叠/畸形降级)
react 全套:281 passed(32 文件)无回归;react typecheck 绿
浏览器 e2e(隔离 build .next-e2e + 外部 server,fs):
  ✓ plugin-pure-command-history 内 R14:提交 /skill:code-review-skill → 实时短命令气泡(不显示展开正文)
    → 删内存会话冷恢复 → 历史仍折叠为 /skill:code-review-skill(非展开块正文)
  ✓ R13 同文件 + 相邻无关无回归(plugin-system-unification 1 / tool-call-ui 3 / session-persistence fs 1)
```

## 已知边界（诚实记录）
- `resolvePiPlugin` / `runInstallEffects` 作为**已导出、已单测**的标准化构建块；当前安装流为 agent 内置工具驱动（`extension-install-agent-tools`，经 `/reload-runtime` followUp 触发 runner reload = 路①）。R7 路②的**实时**生效经前端 `onRuntimeReloadRequested`（检测 `/plugin`、`/reload-runtime` 提交 → bump `webextReloadNonce`）落地并通过 typecheck + e2e 基建验证；编排器尚未接入服务端"安装完成"回调（该回调当前不存在，install 经 ctx.ui 反馈）。完整 install→reload 竞态的浏览器 e2e（需真实 `pi install` 本地包）未覆盖，由编排器单测 + 渲染器 e2e 共同保障。
- examples 不纳入 workspace typecheck（根 tsconfig 排除 `examples`，与既有 webext 示例同约定）；其正确性由 webext 构建成功 + 浏览器 e2e 保障。
