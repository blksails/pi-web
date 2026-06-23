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

- [ ] 2.1 [P0] (P) SSE 帧与 REST DTO 扩展
  - 在 ControlPayload 判别联合追加 `control:"logs"` 分支（entries 为 LogEntry 数组）；新增 GetLogsResponse DTO 与查询参数类型
  - 完成态：可用既有 makeControlFrame 构造 logs 帧并通过 schema 校验；既有 extension-ui/queue/stats/error/ui-rpc 分支不受影响
  - _Requirements: 3.1, 3.3, 4.1, 9.1_
  - _Boundary: protocol transport_
  - _Depends: 1.4_

- [ ] 2.2 [P0] (P) logging 配置域 schema
  - 新增 loggingConfigSchema（passthrough）：enabled、level、namespaces（record<boolean>，widget logNamespaceToggles）、outputs（console/file{enabled,path,maxSizeMb,maxFiles}/panelVisible）、panelDefaultLevel，并经 zodToFormSchema 生成静态 FormSchema 与分组
  - 在 config index 导出该域、ConfigDomainId 加 `logging`、CONFIG_FORM_SCHEMAS 加入 logging
  - 完成态：CONFIG_FORM_SCHEMAS.logging 含按命名空间开关字段且标记自定义 widget
  - _Requirements: 6.2, 6.7_
  - _Boundary: protocol config_
  - _Depends: 1.4_

- [ ] 2.3 [P0] 服务端 stderr 解析与会话环形缓冲
  - 实现行缓冲的 stderr 日志解析器（sentinel 行→LogEntry、分配单调 id）与每会话定容 ring buffer（满则淘汰最旧、支持 level/limit/since 过滤）
  - 完成态：喂入混合 stderr 文本时仅 sentinel 行成为带 id 的 LogEntry 入库，超上限淘汰最旧，过滤查询返回正确子集
  - _Requirements: 2.5, 4.1, 4.3, 4.4, 9.2_
  - _Boundary: server logging_
  - _Depends: 1.4_

- [ ] 2.4 [P0] 前端日志存储与合并去重
  - 实现 logsStore：订阅浏览器总线、applyLogsFrame、历史合并，按 id 去重三源（本地/实时/历史）；实现 use-logs hook 暴露过滤后日志与过滤器状态、fetchHistory、自动滚动状态
  - 完成态：同一 id 的实时帧与历史条目合并后不重复；级别/命名空间/文本过滤派生正确
  - _Requirements: 3.2, 4.5, 5.3, 5.4, 5.5_
  - _Boundary: react logging_
  - _Depends: 2.1_

- [ ] 2.5 [P0] 日志面板组件
  - 实现 LogsPanel：按时间顺序展示级别与命名空间、级别下拉、命名空间过滤、搜索框、自动滚动（到底跟随、上滚暂停）；容器 `data-pi-logs-region`、行 `data-pi-log-level`/`data-pi-log-ns`
  - 完成态：面板随 logsStore 新增条目渲染新行；切换过滤/搜索即时改变可见行；上滚时停止自动跟随
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Boundary: ui logs_
  - _Depends: 2.4_

## 3. Integration：装配、注入、路由、配置接线（P0）

- [ ] 3.1 [P0] 服务端会话装配与路由
  - 在会话装配处订阅子进程 stderr → 解析器 → ring buffer，并经既有帧 emitter 产出 `control:"logs"` 帧（可短窗批量）；注册 `GET /sessions/:id/logs` 路由读取 ring buffer；在配置路由 DOMAIN_SCHEMAS 注册 logging 域
  - 完成态：agent 经 stderr 打出的日志进入 ring buffer 并推送一帧；GET /sessions/:id/logs 返回过滤后的条目；PUT/GET /config/logging 往返成功且保留未知字段
  - _Requirements: 2.2, 3.1, 4.2, 6.1, 6.3_
  - _Boundary: server logging, server http, server config_
  - _Depends: 2.1, 2.2, 2.3_

- [ ] 3.2 [P0] 前端连接路由与 REST 客户端
  - 在 SSE 连接处把 `control:"logs"` 帧路由到 ControlStore.applyLogsFrame；REST 客户端新增 getLogs(sessionId, query)
  - 完成态：收到 logs 帧后 logsStore 增长；getLogs 能拉取历史并交给 logsStore 合并
  - _Requirements: 3.2, 4.2_
  - _Boundary: react sse, react client_
  - _Depends: 2.4, 2.1_

- [ ] 3.3 [P0] 三类组件注入面与 logs slot key
  - agent-kit 的 AgentContext 增加 logger 接缝并由 runner 注入按 agent 命名的 Logger；web-kit host context 注入 logger；descriptor SlotKey 追加 `logs`、web-kit SLOTS 增加 logs
  - 完成态：agent source 可经上下文取得 Logger 打日志；扩展可直接 import createLogger 打日志；webext 可声明填充 logs slot
  - _Requirements: 2.1, 2.3, 2.4_
  - _Boundary: agent-kit, web-kit, protocol web-ext, server runner_
  - _Depends: 1.2, 1.3_

- [ ] 3.4 [P0] 面板挂载与配置接线
  - 在 PiChat 挂载 LogsPanel 区域（showLogs，且受 logging.outputs.panelVisible 调控）并渲染 logs slot 贡献；实现 namespace-toggles 自定义字段渲染器并在 settings 注册 logging 面板与该 renderer；app 侧加载 /config/logging 后调 configureLogger 应用到浏览器总线
  - 完成态：设置页出现"日志"分组可保存；保存后浏览器端按新 enabled/level/namespace 产出或丢弃日志；panelVisible 控制面板显隐
  - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: ui chat, ui config, app settings_
  - _Depends: 2.5, 2.2, 3.3_

## 4. P1：增强与收编

- [ ] 4.1 [P1] 文件输出与轮转
  - 在 Node sink 增加文件输出目标：按配置路径追加写入，达到大小/数量上限时轮转，禁用时不创建文件，写失败吞错不影响会话
  - 完成态：启用文件输出后日志按路径落盘并在超限时轮转；禁用时无文件产生；构造写失败场景时会话仍正常
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: @pi-web/logger, server config_
  - _Depends: 1.3, 2.2_

- [ ] 4.2 [P1] 收编内核现有日志钩子
  - 将补全注册表 onWarn、附件桥 onError、SSE 连接 onError 改为经 logger 产出（命名空间 core:completion / core:attachment / core:sse），遵循统一配置门控
  - 完成态：触发上述告警/错误时，条目以对应命名空间出现在日志通道，且不改变这些功能原有对外可观察行为
  - _Requirements: 8.1, 8.2, 8.3_
  - _Boundary: server completion, server attachment-bridge, react sse_
  - _Depends: 3.1, 3.2_

- [ ] 4.3 [P1] 非结构化 stderr 包装为原始日志
  - 解析器把非 sentinel 的纯文本 stderr 行包装为 `proc:stderr` 命名空间的原始日志条目，纳入同一汇聚通道
  - 完成态：子进程纯文本 stderr 行作为 proc:stderr 日志出现在面板，且不干扰 sentinel 结构化日志
  - _Requirements: 8.1, 9.2_
  - _Boundary: server logging_
  - _Depends: 2.3, 3.1_

## 5. Validation：测试与端到端

- [ ] 5.1 (P) 单元测试：库与契约
  - 覆盖 logger 门控真值表（enabled/level/namespace）、child 拼接、sink 选择、浏览器总线定容；parseLogLine 正反例；loggingConfigSchema↔FormSchema 字段/分组/widget；构建产物扫描确认浏览器侧无 `node:` 引用
  - 完成态：上述单测通过并以实际运行输出为证
  - _Requirements: 1.3, 1.5, 1.6, 1.7, 2.5, 6.2, 6.7_
  - _Boundary: @pi-web/logger, protocol_
  - _Depends: 1.3, 1.4, 2.2_

- [ ] 5.2 (P) 单元测试：服务端缓冲与前端存储
  - 覆盖 ring buffer 容量淘汰与 level/limit/since 过滤；logsStore 三源按 id 去重合并与过滤派生
  - 完成态：上述单测通过并以实际运行输出为证
  - _Requirements: 4.3, 4.4, 4.5, 5.3, 5.4, 5.5_
  - _Boundary: server logging, react logging_
  - _Depends: 2.3, 2.4_

- [ ] 5.3 集成测试：子进程日志通道与回归
  - 对真实子进程验证：agent 经上下文 logger 打日志→stderr→解析→ring buffer→logs 帧；扩展直接 import logger 打日志同通道汇聚；GET /sessions/:id/logs 过滤返回；既有 notify/stats/queue/ui-rpc 控制帧行为不变；logging 配置 PUT/GET 往返与未知字段保留
  - 完成态：集成测试通过，证明日志端到端在后端打通且既有帧无回归
  - _Requirements: 2.2, 2.3, 2.4, 4.2, 6.3, 9.1_
  - _Depends: 3.1, 3.2, 3.3_

- [ ] 5.4 端到端验证用示例源
  - 新增 logging-demo-agent：agent 用上下文 logger 打多级别日志；附带扩展直接 import logger 打日志；可选 webext 打浏览器日志
  - 完成态：选择该源运行时可在面板观察到来自 agent、扩展（及 webext）的不同命名空间日志
  - _Requirements: 2.1, 2.3, 5.2_
  - _Depends: 3.3, 3.4_

- [ ] 5.5 E2E：端到端闭环（隔离构建）
  - 用隔离构建（NEXT_DIST_DIR=.next-e2e + external server 模式）跑通：选 logging-demo-agent→prompt→日志出现在 `data-pi-logs-region`（带级别与命名空间）；面板级别/命名空间/文本过滤生效；自动滚动到底跟随、上滚暂停；在 settings 调整级别/命名空间开关并保存后，后续日志按新配置产出或隐藏
  - 完成态：E2E 用例全部通过且不污染开发服务器共享构建产物，以实际运行输出与截图为证
  - _Requirements: 5.2, 5.3, 5.4, 5.6, 6.4, 6.5, 6.6, 9.3, 9.4_
  - _Depends: 5.4_
