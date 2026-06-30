# Research & Discovery Log — agent-slash-completion

## Discovery Scope

Extension(集成到现有系统)型特性。核心未知是 **go/no-go blocker**:agent(运行在 runner 子进程)能否经现有能力把一组**静态** slash 补全候选声明送到 server 主进程,供 completion 按会话读取——约束是**不可改外部 pi SDK**(`@earendil-works/*`)。四路并行 codebase 调研(基于真实 `node_modules` d.ts 与源码,非猜测):① pi SDK extension API 能力;② 装配期/启动期 agent→server 通道;③ ui-rpc seam 跨进程发帧能力;④ 前端 completion 框架与 `/` 双浮层协调。

## Key Findings

### F1 — agent→server 运行时"推/拉"结构化数据:真实环境不可行(决定性)
- 真实(非 stub)agent 子进程跑的是 **pi SDK 的 `runRpcMode`**(`runner.ts:19` 从 `@earendil-works/pi-coding-agent` 导入,`runner.ts:328` 调用),**非** pi-web 自建。stdout 在 `runRpcMode` 后由 pi SDK 掌控。
- pi JSONL `agent→server` 标准仅三类帧:`event` / `response` / `extension_ui_request`(记忆 `pi-079-real-api-no-ctxstate` 印证)。
- `PiSession.handleRawLine`(`pi-session.ts:405`)虽截获第四类 `ui_rpc_response`,但该帧**只有 stub**(`lib/app/stub-agent-process.mjs:503`)会写;**真实 runRpcMode 无 ui-rpc handler 注册机制**,extension/bootstrap 无口子让 agent 应答自定义 ui-rpc(`examples/webext-contrib-agent/index.ts:4` 注释自承"真实 ui_rpc handler 见 spec 设计待决项";`e2e/node/webext-uirpc.e2e.test.ts` 仅覆盖 stub)。
- **结论**:Explore 一度推荐的"主进程就绪后经 ui-rpc 拉取 `getSlashCompletions`"在真实环境塌(子进程无法应答);`pi.appendEntry("slash_completions")` 方案亦否决——它在 `agent_end` 才触发(用户首次敲 `/` 前候选不存在)、每回合追加 entry 污染会话树、且把静态声明误当按会话内容生成。

### F2 — 装配期 stdout 窗口可用(成立路径)
- `runner.ts` 的装配序列(`loadAgentDefinition:229` → `createAgentSessionRuntime:287` → `wireAttachmentBridge:297` → `wireSessionTitlePersistence:309` → `runRpcMode:328`)**运行在 agent 子进程内**,且**全部在 `runRpcMode` 之前**——此窗口 stdout 尚未被 pi SDK 接管,而 `runner.ts` 是 **pi-web 自有子进程代码**。
- 子进程经 `process.stdout.write` 写的行,由主进程 `PiRpcProcess.handleStdout` 逐行 JSON 解析并经 `onLine` 透传给 `PiSession`(`pi-session.ts:166` 订阅)。即装配期推一条**自建 JSONL 帧**到 stdout 是可达的,且不触及 pi SDK。
- `AgentDefinition` 在子进程经 jiti 加载(`agent-loader.ts`),装配期 `factory.slashCompletions` 字段子进程可读。**主进程不能 jiti 加载 agent `index.ts`**(会触发 `aigcExtension` 的 pi SDK 值导入,dev 路由 `node:fs` 崩,记忆 `pi-web-pi-sdk-dev-external`),故声明只能"子进程读 → 推帧回主进程"。

### F3 — 进程边界纠偏
- `runner.ts` 的 `runtime.session` 是**子进程**的 pi session;`packages/server/src/session/pi-session.ts` 的 `PiSession` 在**主进程**。二者跨进程,装配期**不能**直接调 `PiSession.setSlashCompletions()`(早期 Explore 的"wireSlashCompletions 直写 session"是进程边界幻觉)。唯一回传路径是 stdin/stdout JSONL。

### F4 — 早期帧竞态可控
- `handleRawLine` 有 `if (this._status !== "active") return`(`pi-session.ts:406`)——装配期帧早于就绪(`active` 在就绪握手后),会被该 gate 丢弃。
- 缓解:在 `handleRawLine` 中**把 `slash_completions` 帧的识别提到 active gate 之前**(它本就是装配期帧),或在 `PiRpcProcess`/`PiSession` 层缓冲未到 active 的该类帧。`session-status` 帧由主进程基于 `getCommands` 探针主动驱动(`pi-session.ts:223-257`),与本帧不冲突。

### F5 — completion 框架已支持 `/`,但前端 `/` 被 PiCommandPalette 独占
- 后端 registry 触发符**单字符**即可,`/` 完全支持(`registry.ts:104`);extractor `matchLineStart` 已实现行首提取(`extractors.ts:30`);`complete()` 入参 `ctx` 含 `sessionId`(`types.ts`),provider 可据此按会话取候选。`completion-routes` 的 query handler `requireSession`(已持有 session 对象)。
- 前端 `use-completion.accept`(`use-completion.ts:126`)纯填入 `insertText + " "`、**不执行**;`PiCompletionPopover.select` 无执行逻辑——契合"选中只填入"。
- 但前端 `/` 当前由 **PiCommandPalette** 独占:`open = isCommandMode(value)`(value.startsWith("/"),`pi-command-palette.tsx:128`),数据来自 `controls.getCommands()`(`RpcSlashCommand`),与 completion 框架是**两套独立**机制。`pi-chat.tsx` 同时挂两浮层(palette `:920` + completion popover `:941`),两套 document keydown listener;键入 `/` 时 palette 先注册先拦截,有候选即 `preventDefault`,completion popover 无法响应 → **双浮层冲突真实存在**(`onCaptureChange` 互相覆盖)。

## Decisions

| # | 决策 | 依据 |
|---|---|---|
| D1 | **声明**:`AgentDefinition.slashCompletions?: SlashCompletionDecl[]`(纯数据 `{name, description?, insertText?}`);`aigcExtension` 旁导出 `aigcSlashCompletions` 常量供 agent 引用 | F2;满足 Req1 agent 动态声明,候选与 extension 一对 DRY |
| D2 | **传递通道**:runner 装配期(`runRpcMode` 前)读 `factory.slashCompletions`,经 stdout 推一条自建帧 `{type:"slash_completions", items}` | F1/F2/F3;唯一不改 pi SDK 的可行跨进程路径 |
| D3 | **接收缓存**:`PiSession` 扩展 `handleRawLine` 识别该帧(置于 active gate 之前)→ per-session `slashCompletions` 缓存 + `getSlashCompletions()` | F3/F4 |
| D4 | **暴露**:新增 `createAgentSlashProvider(store)`(trigger `/`、extract `lineStart`),`complete()` 经 `ctx.sessionId` → `store` → `session.getSlashCompletions()` 过滤返回;注册于 `create-handler.ts:91` 注入点 | F5;复用 completion 框架,per-session gating 自动成立(Req4) |
| D5 | **前端协调**:**单浮层方案(i)** — PiCommandPalette 在 `/` 模式额外拉 `getCompletion(sessionId,"/",q)` 混排;`select()` 按 kind 区分:伪命令(provider 来源)→ `onChange(insertText)` 纯填入不执行,真命令 → 原执行逻辑 | F5;避免双浮层 keydown 竞争,体验一致(Req2/3/5) |
| D6 | 否决 `appendEntry` 与 ui-rpc 拉取方案 | F1 |

## Risks & Mitigations

- **R1(实现期验证)**:runner 装配期向 stdout 写前置自建帧,是否干扰随后 pi SDK `runRpcMode` 的 RPC 流。缓解:帧严格在 `runRpcMode` 调用前写、单行 JSONL;以 node e2e(真实子进程)验证会话仍正常握手+对话。若异常,回退用独立 fd / 文件 seam。
- **R2**:早期帧被 `active` gate 丢弃(F4)。缓解:gate 前识别 / 缓冲该帧;单测覆盖"装配帧先于 active 到达仍被缓存"。
- **R3**:前端单浮层 select 误把伪命令当执行命令(反之)。缓解:以 provider 来源/kind 显式判别 + 前端分流单测。
- **R4**:无 `slashCompletions` 的 agent 不受影响(字段可选、帧不发)。缓解:默认空,provider 返回空,palette 行为不变;A/B 单测。

## Out-of-scope confirmations
- 不改 pi SDK(`@earendil-works/*`)。
- 不改命令**执行**通道(host command / extension execute 决策A 路径不动)。
- 不引入 agent 运行时双向 state(本特性只做装配期单次静态声明)。
