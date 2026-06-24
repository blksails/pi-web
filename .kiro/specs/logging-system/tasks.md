# Implementation Plan

> 分期：标 **[P0]** 为核心闭环（必须先打通），**[P1]** 为增强收编。Foundation 与 Core/Integration 的 P0 任务先做，P1 任务在 P0 端到端跑通后进行。

## 1. Foundation：日志库与契约根

- [x] 1.1 新建 `@pi-web/logger` 包骨架
  - 在 packages 下创建零运行时依赖的同构包，配置 package.json（name `@pi-web/logger`、双入口 exports、type module）、tsconfig，并纳入 pnpm workspace 与根 tsconfig 引用
  - 包可被 `pnpm -F @pi-web/logger build`（或 tsc）成功构建，导出占位入口可被其他包 import
  - _Requirements: 1.1_

- [x] 1.2 实现 logger 核心 API 与门控
  - 定义 LogLevel、LogEntry、Logger、LoggerRuntimeConfig 类型；实现级别序比较与命名空间前缀匹配（父含子）
  - 实现 createLogger（debug/info/warn/error）、child（命名空间拼接、继承配置）、以及 enabled/level/namespace 三道门控
  - 完成态：低于当前 level 或命名空间关闭的日志被丢弃且不产出任何条目；child 命名空间为父子拼接
  - _Requirements: 1.1, 1.2, 1.3, 1.7_

- [x] 1.3 实现双 sink 与运行时配置
  - 实现 Node sink（写 `LOG_SENTINEL` 前缀单行 JSON 到进程 stderr）、浏览器 sink（模块级定容 ring buffer + 订阅总线 subscribe/emit/get），按运行环境自动选择 sink
  - 实现 configureLogger（运行时覆盖 enabled/level/namespaces）与从环境变量初始化 Node 端配置
  - 完成态：Node 环境日志写入 stderr 且 stdout 无输出；浏览器环境日志进入总线并通知订阅者、超上限淘汰最旧；浏览器构建产物不含任何 `node:` 模块引用
  - _Requirements: 1.4, 1.5, 1.6, 3.4_
  - _Boundary: @pi-web/logger_

- [x] 1.4 protocol 日志数据契约
  - 新增 LogLevelSchema、LogEntrySchema（zod，data 为 unknown）、LOG_SENTINEL 常量、parseLogLine（仅对 sentinel 行解析并校验，失败返回 null）；并从 protocol 主入口导出
  - protocol 以 type-only 方式复用 logger 的 LogEntry 形状，保持 wire 与库一致且不形成运行时依赖环
  - 完成态：parseLogLine 对合法 sentinel 行返回 LogEntry、对非 sentinel/非法行返回 null
  - _Requirements: 1.4, 2.5_
  - _Boundary: protocol logging_
  - _Depends: 1.2_

## 2. Core：契约扩展、服务端汇聚、前端聚合、面板（P0）

- [x] 2.1 [P0] (P) SSE 帧与 REST DTO 扩展
  - 在 ControlPayload 判别联合追加 `control:"logs"` 分支（entries 为 LogEntry 数组）；新增 GetLogsResponse DTO 与查询参数类型
  - 完成态：可用既有 makeControlFrame 构造 logs 帧并通过 schema 校验；既有 extension-ui/queue/stats/error/ui-rpc 分支不受影响
  - _Requirements: 3.1, 3.3, 4.1, 9.1_
  - _Boundary: protocol transport_
  - _Depends: 1.4_

- [x] 2.2 [P0] (P) logging 配置域 schema
  - 新增 loggingConfigSchema（passthrough）：enabled、level、namespaces（record<boolean>，widget logNamespaceToggles）、outputs（console/file{enabled,path,maxSizeMb,maxFiles}/panelVisible）、panelDefaultLevel，并经 zodToFormSchema 生成静态 FormSchema 与分组
  - 在 config index 导出该域、ConfigDomainId 加 `logging`、CONFIG_FORM_SCHEMAS 加入 logging
  - 完成态：CONFIG_FORM_SCHEMAS.logging 含按命名空间开关字段且标记自定义 widget
  - _Requirements: 6.2, 6.7_
  - _Boundary: protocol config_
  - _Depends: 1.4_

- [x] 2.3 [P0] 服务端 stderr 解析与会话环形缓冲
  - 实现行缓冲的 stderr 日志解析器（sentinel 行→LogEntry、分配单调 id）与每会话定容 ring buffer（满则淘汰最旧、支持 level/limit/since 过滤）
  - 完成态：喂入混合 stderr 文本时仅 sentinel 行成为带 id 的 LogEntry 入库，超上限淘汰最旧，过滤查询返回正确子集
  - _Requirements: 2.5, 4.1, 4.3, 4.4, 9.2_
  - _Boundary: server logging_
  - _Depends: 1.4_

- [x] 2.4 [P0] 前端日志存储与合并去重
  - 实现 logsStore：订阅浏览器总线、applyLogsFrame、历史合并，按 id 去重三源（本地/实时/历史）；实现 use-logs hook 暴露过滤后日志与过滤器状态、fetchHistory、自动滚动状态
  - 完成态：同一 id 的实时帧与历史条目合并后不重复；级别/命名空间/文本过滤派生正确
  - _Requirements: 3.2, 4.5, 5.3, 5.4, 5.5_
  - _Boundary: react logging_
  - _Depends: 2.1_

- [x] 2.5 [P0] 日志面板组件
  - 实现 LogsPanel：按时间顺序展示级别与命名空间、级别下拉、命名空间过滤、搜索框、自动滚动（到底跟随、上滚暂停）；容器 `data-pi-logs-region`、行 `data-pi-log-level`/`data-pi-log-ns`
  - 完成态：面板随 logsStore 新增条目渲染新行；切换过滤/搜索即时改变可见行；上滚时停止自动跟随
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Boundary: ui logs_
  - _Depends: 2.4_

## 3. Integration：装配、注入、路由、配置接线（P0）

- [x] 3.1 [P0] 服务端会话装配与路由
  - 在会话装配处订阅子进程 stderr → 解析器 → ring buffer，并经既有帧 emitter 产出 `control:"logs"` 帧（可短窗批量）；注册 `GET /sessions/:id/logs` 路由读取 ring buffer；在配置路由 DOMAIN_SCHEMAS 注册 logging 域
  - 完成态：agent 经 stderr 打出的日志进入 ring buffer 并推送一帧；GET /sessions/:id/logs 返回过滤后的条目；PUT/GET /config/logging 往返成功且保留未知字段
  - _Requirements: 2.2, 3.1, 4.2, 6.1, 6.3_
  - _Boundary: server logging, server http, server config_
  - _Depends: 2.1, 2.2, 2.3_

- [x] 3.2 [P0] 前端连接路由与 REST 客户端
  - 在 SSE 连接处把 `control:"logs"` 帧路由到 ControlStore.applyLogsFrame；REST 客户端新增 getLogs(sessionId, query)
  - 完成态：收到 logs 帧后 logsStore 增长；getLogs 能拉取历史并交给 logsStore 合并
  - _Requirements: 3.2, 4.2_
  - _Boundary: react sse, react client_
  - _Depends: 2.4, 2.1_

- [x] 3.3 [P0] 三类组件注入面与 logs slot key
  - agent-kit 的 AgentContext 增加 logger 接缝并由 runner 注入按 agent 命名的 Logger；web-kit host context 注入 logger；descriptor SlotKey 追加 `logs`、web-kit SLOTS 增加 logs
  - 完成态：agent source 可经上下文取得 Logger 打日志；扩展可直接 import createLogger 打日志；webext 可声明填充 logs slot
  - _Requirements: 2.1, 2.3, 2.4_
  - _Boundary: agent-kit, web-kit, protocol web-ext, server runner_
  - _Depends: 1.2, 1.3_

- [x] 3.4 [P0] 面板挂载与配置接线
  - 在 PiChat 挂载 LogsPanel 区域（showLogs，且受 logging.outputs.panelVisible 调控）并渲染 logs slot 贡献；实现 namespace-toggles 自定义字段渲染器并在 settings 注册 logging 面板与该 renderer；app 侧加载 /config/logging 后调 configureLogger 应用到浏览器总线
  - 完成态：设置页出现"日志"分组可保存；保存后浏览器端按新 enabled/level/namespace 产出或丢弃日志；panelVisible 控制面板显隐
  - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: ui chat, ui config, app settings_
  - _Depends: 2.5, 2.2, 3.3_

## 4. P1：增强与收编

- [x] 4.1 [P1] 文件输出与轮转
  - 在 Node sink 增加文件输出目标：按配置路径追加写入，达到大小/数量上限时轮转，禁用时不创建文件，写失败吞错不影响会话
  - 完成态：启用文件输出后日志按路径落盘并在超限时轮转；禁用时无文件产生；构造写失败场景时会话仍正常
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: @pi-web/logger, server config_
  - _Depends: 1.3, 2.2_

- [x] 4.2 [P1] 收编内核现有日志钩子
  - 将补全注册表 onWarn、附件桥 onError、SSE 连接 onError 改为经 logger 产出（命名空间 core:completion / core:attachment / core:sse），遵循统一配置门控
  - 完成态：触发上述告警/错误时，条目以对应命名空间出现在日志通道，且不改变这些功能原有对外可观察行为
  - _Requirements: 8.1, 8.2, 8.3_
  - _Boundary: server completion, server attachment-bridge, react sse_
  - _Depends: 3.1, 3.2_

- [x] 4.3 [P1] 非结构化 stderr 包装为原始日志
  - 解析器把非 sentinel 的纯文本 stderr 行包装为 `proc:stderr` 命名空间的原始日志条目，纳入同一汇聚通道
  - 完成态：子进程纯文本 stderr 行作为 proc:stderr 日志出现在面板，且不干扰 sentinel 结构化日志
  - _Requirements: 8.1, 9.2_
  - _Boundary: server logging_
  - _Depends: 2.3, 3.1_

- [x] 4.4 [P1] Node 侧日志配置门控（服务端权威门控）
  - feature 验证发现：settings 改 enabled/level/namespaces 仅对浏览器日志生效；agent/扩展的 Node 日志恒以默认产出（initConfigFromEnv 读 PI_WEB_LOG_* 但无写入方；pi-session.handleStderr 无门控）。落实 design「服务端权威门控」：pi-session 在会话启动读 logging 配置（ConfigCodec.load("logging")），在 handleStderr 入 ring buffer/产帧前按 enabled/level/namespace 过滤 Node 日志条目（复用 @pi-web/logger 的 isLevelEnabled/isNamespaceEnabled）。
  - 完成态：关闭全局 enabled 或某命名空间开关或调高 level 后，**新会话**的 agent/扩展 Node 日志按配置被丢弃/过滤（与浏览器侧一致）；不影响既有帧；集成测试断言"改 logging 配置→新会话→Node 日志按配置变化"。
  - _Requirements: 6.4, 6.5, 6.6, 9.3_
  - _Boundary: server logging, server session, server config_
  - _Depends: 3.1_

## 5. Validation：测试与端到端

- [x] 5.1 (P) 单元测试：库与契约
  - 覆盖 logger 门控真值表（enabled/level/namespace）、child 拼接、sink 选择、浏览器总线定容；parseLogLine 正反例；loggingConfigSchema↔FormSchema 字段/分组/widget；构建产物扫描确认浏览器侧无 `node:` 引用
  - 完成态：上述单测通过并以实际运行输出为证
  - _Requirements: 1.3, 1.5, 1.6, 1.7, 2.5, 6.2, 6.7_
  - _Boundary: @pi-web/logger, protocol_
  - _Depends: 1.3, 1.4, 2.2_

- [x] 5.2 (P) 单元测试：服务端缓冲与前端存储
  - 覆盖 ring buffer 容量淘汰与 level/limit/since 过滤；logsStore 三源按 id 去重合并与过滤派生
  - 完成态：上述单测通过并以实际运行输出为证
  - _Requirements: 4.3, 4.4, 4.5, 5.3, 5.4, 5.5_
  - _Boundary: server logging, react logging_
  - _Depends: 2.3, 2.4_

- [x] 5.3 集成测试：子进程日志通道与回归
  - 对真实子进程验证：agent 经上下文 logger 打日志→stderr→解析→ring buffer→logs 帧；扩展直接 import logger 打日志同通道汇聚；GET /sessions/:id/logs 过滤返回；既有 notify/stats/queue/ui-rpc 控制帧行为不变；logging 配置 PUT/GET 往返与未知字段保留
  - 完成态：集成测试通过，证明日志端到端在后端打通且既有帧无回归
  - _Requirements: 2.2, 2.3, 2.4, 4.2, 6.3, 9.1_
  - _Depends: 3.1, 3.2, 3.3_

- [x] 5.4 端到端验证用示例源
  - 新增 logging-demo-agent：agent 用上下文 logger 打多级别日志；附带扩展直接 import logger 打日志；可选 webext 打浏览器日志
  - 完成态：选择该源运行时可在面板观察到来自 agent、扩展（及 webext）的不同命名空间日志
  - _Requirements: 2.1, 2.3, 5.2_
  - _Depends: 3.3, 3.4_

- [x] 5.5 E2E：端到端闭环（隔离构建）
  - 用隔离构建（NEXT_DIST_DIR=.next-e2e + external server 模式）跑通：选 logging-demo-agent→prompt→日志出现在 `data-pi-logs-region`（带级别与命名空间）；面板级别/命名空间/文本过滤生效；自动滚动到底跟随、上滚暂停；在 settings 调整级别/命名空间开关并保存后，后续日志按新配置产出或隐藏
  - 完成态：E2E 用例全部通过且不污染开发服务器共享构建产物，以实际运行输出与截图为证
  - _Requirements: 5.2, 5.3, 5.4, 5.6, 6.4, 6.5, 6.6, 9.3, 9.4_
  - _Depends: 5.4_

## Implementation Notes
- 任务 2.2 给 protocol `ConfigDomainId` 加了 `"logging"`，导致 server `packages/server/src/config/config-routes.ts` 的 `DOMAIN_SCHEMAS: Record<ConfigDomainId, ...>` 缺 `logging` 键而 typecheck 报 TS2741（过渡性破坏）。**任务 3.1 必须在 DOMAIN_SCHEMAS 加入 `logging: loggingConfigSchema` 修复此错**，届时 server typecheck 才会恢复绿。在 3.1 完成前，`pnpm -F @pi-web/server typecheck` 预期仅有这一个错误。
- harness 编辑器 LSP 对新建未跟踪文件常报 "Cannot find module .../X.js" 与级联的 implicit-any 假阳性；以各包 `pnpm -F <pkg> typecheck`/`test` 实际退出码为准。
- 任务 2.1 给 SSE ControlPayload 加了 `control:"logs"` 分支，导致 react `packages/react/src/sse/control-store.ts` 的 `applyControlFrame` switch 未处理该分支而 typecheck 报 TS2322（收窄到 never）。**任务 3.2 必须在 applyControlFrame 增加 `case "logs"` 调 logsStore.applyLogsFrame 修复此错**。在 3.2 完成前，`pnpm -F @pi-web/react typecheck` 预期仅有 control-store.ts 这一个错误。
- 既有失败（与本 spec 无关，勿误判）：`test/attachment-handler-assembly.test.ts` 2 个用例在 worktree 基线（main 4bef7c7）即失败——displayUrl 期望 `/attachments/.../raw?exp=&sig=` 实得 `/api/attachments/att_...`（attachment 签名 URL 格式，属其它 spec）。已用 stash 复跑确认 3.3 baseline 同样失败。logging-system 全部任务**未触碰** attachment 代码，最终验证应排除此既有失败。
- 3.4 交付了 PiChat 的 showLogs/logsPanelVisible prop 契约 + logsStore/onLogsFrame 接线 + configureLogger，但 `components/chat-app.tsx` 尚未向 `<PiChat>` 传 `showLogs=true` 并把 `logging.outputs.panelVisible`→`logsPanelVisible`（边界推迟）。**任务 5.4/5.5（demo agent + e2e）落地时需在 chat-app 接入 showLogs 并映射 panelVisible**，否则运行 app 中面板不挂载、e2e 抓不到 data-pi-logs-region。

## 6. UI 优化（Chrome 实测反馈）

- [x] 6.1 LogsPanel 视觉重构 + 挂载
  - 加面板标题栏("日志" + 条目计数 + 折叠/展开 toggle，折叠态只留标题条省空间)、容器边界(边框/背景区分于聊天区)、给合理默认高度的可滚动区；保留所有 data-* 选择器不破坏 e2e。
  - 每行加时间戳列(entry.ts→HH:MM:SS.mmm)；级别用配色 chip(debug 灰/info 蓝或前景/warn 黄/error 红)而非仅行文字色。
  - _Requirements: 5.1, 5.2, 5.6_
  - _Boundary: ui logs, ui chat_

- [x] 6.2 demo 日志消息去命名空间冗余
  - examples/logging-demo-agent 的 webext(web.config.tsx)/agent(index.ts)/扩展(log-probe.ts) 日志消息文本不再以自身 ns 开头(ns 已由面板列显示)，消除重复。
  - _Requirements: 5.2_
  - _Boundary: examples/logging-demo-agent_

- [x] 6.3 设置表单默认回显 + null 显示修复
  - 配置字段渲染：number 字段值为 null/undefined 时显示空/占位符，不显示字面 "null"；缺配置时 bool/enum/number 字段回显 FieldDescriptor.default(schema 默认)而非空/未勾选。须不破坏既有 auth/settings/sandbox 域行为与既有 config e2e。
  - _Requirements: 6.2, 6.6_
  - _Boundary: ui config_

## 7. 真实 agent 实测发现的缺陷修复

- [x] 7.1 修 runner agent 日志命名空间（取源目录名而非入口文件名）
  - 现状：runner.ts 用入口文件 basename 去扩展做命名空间，index.ts→`agent:index`。应取 agent **源目录名**（如 logging-demo-agent→`agent:logging-demo-agent`）；当 basename 为 index/main 等通用入口名时，回退用其父目录名。
  - 完成态：agent source 的 ctx.logger 日志命名空间反映 agent 名（非 "index"）；单测覆盖 index.ts 入口推导出目录名。
  - _Requirements: 2.1_
  - _Boundary: server runner_

- [x] 7.2 面板挂载时自动拉取历史日志
  - 现状：use-logs 暴露 fetchHistory 但无人在挂载时调用，导致浏览器连上之前产生的 agent 启动期日志（已在服务端 ring buffer）不显示在面板。
  - 改：在 use-logs（fetcher 就绪时）或 pi-chat 挂载时自动调用 fetchHistory({}) 拉取历史并 mergeHistory（按 id 去重，与实时帧合并无重复）；新会话（fetcher/store 变更）时重新拉取。
  - 完成态：选源起会话后，面板显示 agent 启动期日志（factory/started/warn/error）+ 实时日志，无重复。
  - _Requirements: 4.5, 5.2_
  - _Boundary: react logging, ui chat_

- [x] 7.3 服务端 SSE 订阅时回填日志 ring buffer（确定性修复早期日志竞争）
  - 真实 agent 实测发现：agent 启动期日志在子进程 spawn 期间产出（浏览器 stream 连上之前），实时帧收不到；7.2 的挂载一次性历史拉取又常在日志入库前触发（返回空）→ agent 启动日志进不了面板（虽在服务端 ring buffer）。
  - 改：pi-session 在**新订阅者订阅**（subscribe）时，立即向该订阅者发送当前 ring buffer 内容作为一帧 `control:"logs"`（回填），不广播给既有订阅者。浏览器 SSE stream 连上即得到连接前已缓冲的全部日志（客户端按 id 去重）。
  - 完成态：真实 agent 起会话后，面板显示 agent 启动期日志（agent:<源名> 的 factory/started/warn/error）+ 扩展 + webext，无重复；既有帧/订阅行为不破坏。
  - _Requirements: 4.5, 5.2, 3.1_
  - _Boundary: server session_

## 8. 日志面板位置控制（C 配置位置 + D webext logs slot）

- [x] 8.1 logging 配置加 panelPosition 字段 + 透传
  - logging 配置 outputs 加 `panelPosition` enum：bottom(默认)/right/drawer；与既有 panelVisible(显隐)正交。chat-app 读取并经新 prop 传给 PiChat（仿 logsPanelVisible）。
  - 完成态：CONFIG_FORM_SCHEMAS.logging 含 panelPosition enum 字段；缺配置默认 bottom；chat-app 把 position 传入 PiChat。
  - _Requirements: 6.1, 6.2_
  - _Boundary: protocol config, app chat_

- [x] 8.2 PiChat 按位置渲染 LogsPanel（bottom/right/drawer）
  - PiChat 新增 logsPanelPosition prop，按值渲染：bottom=现状(输入框下)、right=右侧 aside(与 panelRight/artifact 区共存)、drawer=顶栏「日志」按钮 + 底部抽屉(开合状态)。panelVisible 仍门控显隐；保留 data-pi-logs-region 选择器（各位置容器都带）。
  - 完成态：切换 position 配置→面板出现在对应位置；drawer 默认收起、点按钮展开；既有 e2e/单测不破坏（默认 bottom）。
  - _Requirements: 5.1, 6.6_
  - _Boundary: ui chat_
  - _Depends: 8.1_

- [x] 8.3 接通 logs webext slot + demo
  - 在日志区渲染 ExtSlotRegion slot="logs"，webext slots.logs 贡献与内核 LogsPanel 并存、随 panelPosition 位置显示；给 logging-demo-agent 的 .pi/web 加一个 slots.logs demo（如一行自定义日志摘要）验证。
  - 完成态：填充 slots.logs 的 webext 其内容出现在日志区；不破坏内核面板。
  - _Requirements: 5.1_
  - _Boundary: ui chat, ui web-ext, examples/logging-demo-agent_
  - _Depends: 8.2_

- [x] 8.4 修复右侧窄列日志行布局（自适应换行）
  - LogRow 改 CSS 自适应：flex-wrap + 消息 flex-[1_1_12rem] break-words（去 break-all）+ 时间戳列收窄到 5.5rem + ns 加 title。宽容器单行、窄容器（右侧栏）消息换整行全宽按词换行，消除逐字竖排。无需 prop/容器查询，对 bottom/right/drawer 自适应。
  - 完成态：右侧位置日志可读（两行式：meta 行 + 消息整行）；451 ui 测试绿、Chrome 实测确认。
  - _Requirements: 5.1, 5.2_
  - _Boundary: ui logs_

- [x] 8.5 日志面板智能跟随（方案 A：scrollTop 置底 + 暂停未读跳转按钮）
  - ①把自动滚动从 sentinel.scrollIntoView 改为对滚动容器 `el.scrollTop = el.scrollHeight`（只滚面板内部、不牵动整页）；保留"到底跟随/上滚暂停"状态机（onScroll 的 atBottom 判定）。
  - ②暂停（autoscroll=false）期间统计新到达的（已过滤）日志条数；面板内浮出 "↓ N 新日志" 按钮（data-pi-logs-jump-latest），仅在暂停且有未读时显示；点击→置底+恢复跟随+清零未读。到底/恢复跟随时清零。
  - 完成态：上滚看历史时新日志不打断、底部出现未读计数按钮、点击跳到最新并恢复跟随；默认到底跟随行为不变（e2e 自动滚动测试仍过）；bottom/right/drawer 通用。
  - _Requirements: 5.6_
  - _Boundary: ui logs（+必要时 react use-logs）_
