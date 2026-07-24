# Requirements Document

## Introduction

建立领域中立的 `pane` 运行地基:Agent 声明可多开的 Pane;pi-web 只提供右侧 placement、会话能力与连续宽度;每个 Pane 实例运行在独立 iframe 或 Tauri WebView 中,拥有独立 JS Realm、独立端口与独立授权。

地基不绑定 AIGC、Canvas、文件或编辑器等任何业务领域。`examples/panes-agent` 是一致性范例,只用于验证公开接口;AIGC 页面迁移在地基验收后进行。安全边界由独立 View、一次性端口、schema 校验与默认拒绝的 grant 共同构成——React Provider/HOC 只约束作者接口,不承担安全职责。

## Boundary Context

- **In scope**:
  - `packages/panes-kit` 公开契约:descriptors、envelopes、错误码、grant、大小限制。
  - 多实例工作区纯状态模型(`instanceId`/`epoch`、open/activate/move/reload/close)。
  - Browser Host(sandbox iframe + `MessageChannel` 双握手)与 React Host/Guest 接口。
  - pi-web 接缝:Agent Routes、Surface、附件、Conversation 能力代理与 panelRight 连续宽度。
  - `examples/panes-agent` 一致性范例与现有 Canvas 能力复用。
  - Tauri WebView adapter 与双宿主(iframe/Tauri)conformance。
  - AIGC 迁移(仅作为地基验收后的最终波次,不得反向污染地基)。
- **Out of scope**:
  - 在 Panes 地基内重做 Canvas(schema、reducer、画布均复用 `@blksails/pi-web-canvas-ui` 与既有 Canvas Surface 链路)。
  - `frame-rpc` 依赖:Pane 内部隔离通信使用 `MessageChannel` 或原生 IPC relay,不引入 frame-rpc。
  - 任意 URL、任意 HTTP method、任意宿主函数或远程代码执行入口(PanePort 明确不提供)。
  - 既有离散比例 `panelRatio` 模式的改动(仅保持向后兼容)。
- **Adjacent expectations**:
  - PiChat 已有 `panelWidth/onPanelWidthChange` 连续拖拽能力,本特性只接线不重做。
  - Agent Routes、Surface、附件系统与 Conversation 为既有链路,本特性只做能力代理与错误映射。
  - Canvas 领域若需每实例独立文档,应在 Canvas 领域增加 documentId,而不是让宿主复制领域状态。

## Requirements

### Requirement 1: 领域中立的公开契约
**Objective:** 作为 pane 作者与第三方集成方, 我希望有一套领域中立、入口收敛的公开契约, 以便不接触 pi-web 内部实现即可声明与装载 Panes。

#### Acceptance Criteria
1. The 公开契约 shall 仅经 `@blksails/pi-web-panes-kit`(`definePanes`、`definePaneDefinition`、`connectPaneGuest`)与 `@blksails/pi-web-panes-kit/react`(`PanesHost`、`PaneGuestProvider`、`usePaneGuest`、`withPaneGuest`)两个入口导出。
2. When `definePanes` 接收定义, the 契约层 shall 校验 schema、唯一 ID、初始 Pane 与多开约束, 并应用默认值 `allowMultiple=false`、`maxInstances=1`、`maxOpenPanes=16`。
3. If 定义或消息出现重复 ID、越权能力、过大载荷、旧 epoch 或未知消息, then the 契约层 shall 拒绝并返回结构化错误。
4. The 公开契约 shall 不含 Canvas、files、AIGC 等业务词汇。
5. The Guest 上行请求 shall 仅有五种 operation:`route.query`、`route.mutate`、`surface.run`、`attachment.put`、`conversation.submit`;Host 下行 shall 仅有 `pane:connected`、`pane:result`、`pane:surface`、`pane:lifecycle`。
6. The 协议 shall 不暴露 fetch、文件系统、shell、React context 或 pi-web 内部 client。

### Requirement 2: 多实例工作区状态模型
**Objective:** 作为 pane 作者, 我希望同一 `PaneDefinition` 可按约束多开且每个实例独立运行, 以便一个设计支撑多个并行工作上下文。

#### Acceptance Criteria
1. The 实例模型 shall 满足:一个 Tab 对应一个 `PaneInstance`,一个实例对应一个独立 JS Realm;`paneId` 标识设计、`instanceId` 标识运行实例、`epoch` 标识一次装载,授权绑定三者。
2. When 触发 `open` 且定义允许多开, the 工作区 shall 创建新 `instanceId`;否则 shall 激活既有实例。
3. When 触发 `activate` 或 `move`, the 工作区 shall 只改变可见实例或顺序, 兄弟实例保持独立运行且授权与 Realm 不变。
4. When 触发 `reload`, the 工作区 shall 令 `epoch++`、关闭旧端口并由新 View 重新握手。
5. When 触发 `close`, the 工作区 shall 发送 `closing`、撤销订阅和端口, 再选中相邻实例;关闭实例的端口 shall 立即撤销。
6. The Tab key shall 为 `instanceId:epoch`;禁止用 `paneId` 作为运行实例 key。
7. The `createPaneWorkspace/reducePaneWorkspace` shall 为无框架纯状态机(无 DOM、无 pi-web 依赖)。

### Requirement 3: Browser Host 隔离装载与握手
**Objective:** 作为 pi-web 维护者, 我希望每个 Pane 实例装载在独立 sandbox iframe 中并经一次性端口通信, 以便实例间与实例-宿主间互不越界。

#### Acceptance Criteria
1. The Browser Host shall 以 `sandbox="allow-scripts"` 装载 iframe, 不启用 same-origin、表单、弹窗、下载和顶层导航。
2. When iframe `load` 与 Guest `pane:ready` 双触发, the Host shall 建立一次性 `MessageChannel`, 相同 epoch 幂等。
3. The Guest shall 只接受 `event.source === parent`、协议版本匹配且 paneId 匹配的连接;后续业务只走专属 port, 不走 window message。
4. When reload、close、导航或销毁发生, the Host shall 关闭旧 port;旧 epoch 请求 shall 返回 `STALE_INSTANCE` 或自然失联。
5. The Browser Host shall 支持同类型三个实例同时存活, 且端口和 Realm 不共享。
6. The Browser Host shall 支持多开、切换、拖排、关闭与空工作区恢复。

### Requirement 4: 默认拒绝授权
**Objective:** 作为 pi-web 维护者, 我希望权限默认拒绝并按能力分项授予, 以便 Guest 无法凭自报信息扩权。

#### Acceptance Criteria
1. The 授权 shall 默认拒绝, 并按 Agent Route(含 HTTP method)、Surface key/action、附件、Conversation 分项授予。
2. The Host shall 只使用已装载 `PaneDefinition` 的 grant;Guest 自报的 paneId、route、method、domain、action 或 attachmentId shall 不产生权限。
3. The Agent Route handler shall 再次做领域校验, 与 Host grant 形成两层边界。
4. The 默认限制 shall 为:普通请求 256 KiB、响应 2 MiB、附件 8 MiB;定义可在安全上限内收窄或放宽 route 限额。
5. If 请求超出授权或体积限制, then the Host shall 返回 `CAPABILITY_DENIED` 或 `PAYLOAD_TOO_LARGE`, 不透传到 Agent。

### Requirement 5: Agent Routes adapter 与错误语义
**Objective:** 作为 pane 作者, 我希望经标准地址访问 Agent Routes 并获得结构化错误, 以便冷数据与 mutation 有可预期的失败语义。

#### Acceptance Criteria
1. The adapter shall 以 `GET/POST {baseUrl}/sessions/{sessionId}/agent-routes/{route}` 为标准地址, 编码 sessionId/route/query, 限制 request/response 体积, 只接收 JSON, 并保留成功 body 不假定具体领域 envelope。
2. When 后端返回 `SESSION_NOT_FOUND`, the adapter shall 映射为 `HOST_UNAVAILABLE` 与「当前会话已失效,请重新打开 Agent 会话」, 且 404 不得退化为裸 `Agent Route HTTP 404`。
3. While 处于会话创建后、runner 声明帧到达前的装配窗口, the adapter shall 对 `ROUTE_NOT_FOUND` 做有界指数退避;只重试该 readiness 错误, 不重放失效会话或任意 4xx。
4. When 后端返回 409 或 `REVISION_CONFLICT`, the adapter shall 映射为可处理冲突;其余失败 shall 映射 `ROUTE_FAILED` 并保留 status/retryable。
5. The Host shall 不自动把 mutation 重放到另一个会话;会话失效 shall 显式提示, 避免跨会话误写。

### Requirement 6: Surface、附件与 Conversation 能力代理
**Objective:** 作为 pane 作者, 我希望在 Guest 内以窄接口消费 Surface 镜像、附件与 Conversation, 以便小而热的状态走 Surface、二进制走附件、显式进入 LLM 走 Conversation。

#### Acceptance Criteria
1. The Host shall 只订阅 grant 中的 `surfaceKeys`, 把最新值推到对应实例;Guest 的 Surface proxy shall 维护本地镜像并实现 `getState/subscribe/hasCommand/run`, 且 `run` 仍需逐 action 授权。
2. When Guest 发起 `attachment.put`, the Host shall 把 `ArrayBuffer` 还原为 File 后调用 pi-web 注入的 upload;Guest shall 只得到 `attachmentId/displayUrl`。
3. The `conversation.submit` shall 只由显式用户动作触发, 不用于后台同步。
4. The 通道分工 shall 为:高频轻状态走 Surface;冷数据和 mutation 走 Agent Routes;二进制走 Attachments;显式进入 LLM 走 Conversation;View 内部隔离通信走 PanePort。

### Requirement 7: panelRight 连续宽度
**Objective:** 作为 pane 作者, 我希望经 WebExt 配置声明连续宽度, 以便 panelRight 可连续拖拽且宽度由宿主受控。

#### Acceptance Criteria
1. Where WebExt 配置声明 `panelWidth/minPanelWidth/maxPanelWidth`, the ChatApp shall 以 `panelWidth` 初始化本地状态、传给 PiChat, 并把 `onPanelWidthChange` 回写同一状态, 启用 PiChat 已有连续拖拽分隔条并隐藏离散比例切换器。
2. While 配置未声明 `panelWidth`, the ChatApp shall 继续使用 `panelRatio`, 保证普通 WebExt 零回归。
3. The Pane/Panes shall 不感知 placement 宽度, 也不自行监听宿主鼠标事件。
4. When 配置声明连续宽度并拖拽分隔条, the PiChat 拖拽回调 shall 持续更新宽度状态。

### Requirement 8: 一致性范例与 Canvas 复用
**Objective:** 作为 pi-web 维护者, 我希望 `panes-agent` 只消费公开包并直接复用既有 Canvas 能力, 以便范例可指导第三方接入且 Canvas 无平行实现。

#### Acceptance Criteria
1. The `examples/panes-agent` shall 只消费公开包, 不得持有 Agent-local Host core。
2. The 文件/编辑/Diff/Artifact 范例 shall 走 Agent Routes 与 Surface 验证;业务写入 shall 采用 schema 校验、revision CAS 和 change journal。
3. The Canvas Pane shall 在自己的 iframe 中装载现有 `CanvasPanel`, 由 Guest SDK 将 PanePort 适配为 `WebExtSurfaceAccess`(→ `surface:canvas` 与明确 action grants)、`UploadFn`(→ `attachment.put`)、`ConversationAccess`(→ `conversation.submit`)。
4. The Panes 地基 shall 不定义 Canvas schema、不复制 Canvas reducer、不绘制替代画布;Agent 同时装载现有 `canvasSurfaceExtension`、AIGC 与 vision extensions。
5. The 多个 Canvas Tab shall 为多个独立 UI/JS Realm, 可观察同一 Agent 权威 `surface:canvas`。

### Requirement 9: Desktop adapters
**Objective:** 作为 pi-web 维护者, 我希望桌面宿主(Tauri)复用同一 contract、Guest SDK 和 conformance suite, 以便桌面只替换 View/transport adapter。(Electron 桌面壳已由 spec electron-to-tauri 移除;第三方 Electron 宿主可基于同一抽象与共用中继原语自行实现, 不属本 spec 交付面。)

#### Acceptance Criteria
1. The 核心 shall 只定义 `PanePort`(`post/listen/close`)与 `PaneViewAdapter`(`mount`)两个抽象, 不为桌面增加 Guest 专属 API。
2. The Tauri adapter shall 使用独立 WebView, Rust command/event 只转同一 envelope。
3. The adapter shall 按 `instanceId+epoch` 绑定 relay, pane webview 以最小 capability 运行(仅事件监听与上行中继), 并拒绝未声明协议与一切宿主侧命令。
4. The 同一 Guest fixture、授权和生命周期套件 shall 跨 iframe 与 Tauri 两宿主通过, 且生命周期、授权、错误和崩溃隔离语义一致。

### Requirement 10: AIGC 迁移(地基验收后)
**Objective:** 作为 AIGC 业务维护者, 我希望在地基验收后按原型拆分业务 Pane 并迁移数据通道, 以便恢复业务闭环而不反向污染 Panes 地基。

#### Acceptance Criteria
1. The 迁移 shall 按素材、Canvas、任务、历史等领域拆 Pane, 恢复原型侧栏、Tab、Dialog 和工作流。
2. The 迁移 shall 把 HTTP 全部转 Agent Routes、媒体转附件引用、热态转 Surface。
3. The 迁移 shall 不修改地基契约绕过审核, 不反向污染 Panes 地基。
4. The 迁移验收 shall 包含视觉回归、业务闭环、双宿主(iframe/Tauri)隔离与 LLM 同源状态。
5. While Browser Host、pi-web 接缝与一致性范例未验收, the AIGC 迁移 shall 不得开始。

### Requirement 11: 回归保障与总体验收门
**Objective:** 作为 pi-web 维护者, 我希望地基交付具备完整测试门与零回归保障, 以便普通 Agent 与普通 WebExt 不受影响且第三方可独立接入。

#### Acceptance Criteria
1. The 无 Panes 的 Agent、普通 WebExt 和无 panelRight 页面 shall 无行为变化。
2. The 同一类型 Pane shall 至少可多开三个实例, 每个实例有独立 iframe/WebView、端口和 epoch。
3. The 测试门 shall 覆盖:Contract(schema、重复 ID、默认值、版本、非法 envelope)、Instance(同类型多开、上限、activate/move/reload/close、epoch)、Security(route/method/action 越权、体积、旧端口、跨实例结果)、Route(成功、SESSION_NOT_FOUND、冲突、非 JSON、超大响应)、Browser(三个同类型 iframe 同时存在且端口隔离)、Canvas(构建产物包含 canonical Canvas UI, Surface/附件/Conversation 通过 Guest proxy)、Layout(连续宽度拖拽回调持续更新)、Regression(无 Panes、无 panelWidth、普通 WebExt 行为不变)、Desktop(同一 conformance fixture 在 iframe 与 Tauri adapter 通过)。
4. The 文档、类型、契约测试、示例构建和双宿主 conformance shall 能独立指导第三方接入。
