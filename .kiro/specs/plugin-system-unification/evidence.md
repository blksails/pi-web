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

→ `resourceLoader.getSkills()` 仍为空,根因落在 **SDK/runner 子进程边界**。临时在 `runner.ts` 加 `[skill-debug]`
打印 getSkills,但 dev 日志**没接住**（runner 子进程 stderr 路由 / 或 `module.createRequire failed parsing argument`
暗示 custom runRpcMode 未执行/回退到 `pi --mode rpc`）。**下一步**：专门捕获 runner 子进程 stderr 的调试,
确认运行模式与 getSkills 实际返回,再定位 SDK 内部成因。诊断代码已移除,不留库。

## 已知边界（诚实记录）
- `resolvePiPlugin` / `runInstallEffects` 作为**已导出、已单测**的标准化构建块；当前安装流为 agent 内置工具驱动（`extension-install-agent-tools`，经 `/reload-runtime` followUp 触发 runner reload = 路①）。R7 路②的**实时**生效经前端 `onRuntimeReloadRequested`（检测 `/plugin`、`/reload-runtime` 提交 → bump `webextReloadNonce`）落地并通过 typecheck + e2e 基建验证；编排器尚未接入服务端"安装完成"回调（该回调当前不存在，install 经 ctx.ui 反馈）。完整 install→reload 竞态的浏览器 e2e（需真实 `pi install` 本地包）未覆盖，由编排器单测 + 渲染器 e2e 共同保障。
- examples 不纳入 workspace typecheck（根 tsconfig 排除 `examples`，与既有 webext 示例同约定）；其正确性由 webext 构建成功 + 浏览器 e2e 保障。
