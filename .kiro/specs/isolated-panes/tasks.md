# Implementation Plan — isolated-panes

> 原则:先冻结并实现通用地基,再迁移 AIGC。业务范例只用于验证公开接口,不能成为第二套 Host core。每一波必须可独立审核、测试和回滚。"显示了 iframe"不构成交付;多实例、隔离、授权、错误语义、连续拖拽和数据一致性必须同时成立(逐波验证顺序见 design.md「每波验证顺序」)。

- [x] 1. Wave 0:契约冻结(轨道 A + B)
- [x] 1.1 建立 `packages/panes-kit` 包骨架 (P)
  - 建包与构建/测试脚手架,公开入口收敛为 `@blksails/pi-web-panes-kit` 与 `@blksails/pi-web-panes-kit/react`。
  - 观察完成:包可独立 typecheck/test,入口只导出契约声明的符号。
  - _Requirements: 1.1_
  - _Boundary: packages/panes-kit_
- [x] 1.2 契约:definitions、messages、errors、grants、大小限制
  - `contract.ts` 落地 `PanesDefinition/PaneDefinition/PaneInstance`、五种 Guest operation 与四种 Host 下行、全部错误码、`PaneCapabilities` 与默认限制(256 KiB / 2 MiB / 8 MiB)。
  - `definePanes` 校验 schema、唯一 ID、初始 Pane 与多开约束,默认 `allowMultiple=false`、`maxInstances=1`、`maxOpenPanes=16`。
  - 观察完成:公开契约无 Canvas/files/AIGC 词;重复 ID、非法 envelope、过大载荷上限被拒绝。
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 4.4_
  - _Boundary: contract.ts, authorization.ts, errors.ts_
  - _Depends: 1.1_
- [x] 1.3 纯实例 reducer:multi-open、epoch、lifecycle
  - `createPaneWorkspace/reducePaneWorkspace` 实现 open/activate/move/reload/close 语义;Tab key 为 `instanceId:epoch`。
  - 无 DOM、无 pi-web 依赖。
  - 观察完成:同类多开、上限、`reload` 后 `epoch++`、`close` 选中相邻实例的纯状态测试全绿。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - _Boundary: instances.ts_
  - _Depends: 1.2_
- [x] 1.4 默认拒绝与安全测试
  - grant 只源于已装载定义;Guest 自报 paneId/route/method/domain/action/attachmentId 不产生权限。
  - 观察完成:重复 ID、越权、过大载荷、旧 epoch、未知消息均拒绝(F0 验收门),默认拒绝测试通过。
  - _Requirements: 4.1, 4.2, 4.5_
  - _Boundary: authorization.ts_
  - _Depends: 1.2, 1.3_

- [x] 2. Wave 1:Browser 竖切(轨道 C)
- [x] 2.1 PanesHost:多开、关闭、拖排、切换、空态
  - `PanesHost` 支持同类多开、关闭、拖排、切换与空工作区恢复。
  - 观察完成:UI 操作驱动 workspace reducer,Tab 以 `instanceId:epoch` 为 key。
  - _Requirements: 2.6, 3.6_
  - _Boundary: react/panes-host.tsx_
  - _Depends: 1.3_
- [x] 2.2 每实例独立 iframe + MessageChannel + epoch 握手
  - `sandbox="allow-scripts"`;iframe `load` + `pane:ready` 双触发建立一次性 `MessageChannel`,相同 epoch 幂等;reload/close 关闭旧 port,旧 epoch 请求返回 `STALE_INSTANCE`。
  - 观察完成:同类型三个实例同时存活,端口和 Realm 不共享;关闭或 reload 后旧端口不可用(F1 验收门)。
  - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - _Boundary: react/panes-host.tsx, host-ports.ts_
  - _Depends: 2.1_
- [x] 2.3 Guest SDK + React Provider/hook/HOC
  - `connectPaneGuest` 只接受 `event.source === parent`、协议版本匹配且 paneId 匹配的连接;`PaneGuestProvider/usePaneGuest/withPaneGuest` 约束作者接口。
  - 观察完成:Guest 经窄接口发起五种 operation,不持有宿主对象、会话凭据或任意 URL 访问能力。
  - _Requirements: 1.5, 3.3_
  - _Boundary: guest.ts, react/pane-guest.tsx_
  - _Depends: 2.2_

- [ ] 3. Wave 2:pi-web 接缝(轨道 D) (P)
- [x] 3.1 Agent Route adapter 与结构化错误
  - 标准地址 `GET/POST {baseUrl}/sessions/{sessionId}/agent-routes/{route}`;`SESSION_NOT_FOUND`→`HOST_UNAVAILABLE` 显式提示;装配窗口 `ROUTE_NOT_FOUND` 有界指数退避;409→`REVISION_CONFLICT`;其余→`ROUTE_FAILED` 保留 status/retryable。
  - 观察完成:route 测试覆盖成功、SESSION_NOT_FOUND、冲突、非 JSON、超大响应;失效会话不显示裸 HTTP 404,不跨会话重放 mutation。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: agent-routes.ts_
  - _Depends: 1.2_
- [x] 3.2 Surface key/action、附件、Conversation 代理
  - Host 只订阅 grant 内 `surfaceKeys` 并推镜像;Guest Surface proxy 实现 `getState/subscribe/hasCommand/run`(`run` 逐 action 授权);`attachment.put` 还原 File 走注入 upload;`conversation.submit` 仅显式用户动作。
  - 观察完成:越权 key/action 被拒;Guest 仅得 `attachmentId/displayUrl`。
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: host-ports.ts, guest.ts_
  - _Depends: 1.2_
- [x] 3.3 panelRight 连续宽度接线
  - WebExt `panelWidth/minPanelWidth/maxPanelWidth` → ChatApp 受控状态 → PiChat 既有 `panelWidth/onPanelWidthChange` 连续拖拽;声明时隐藏离散比例切换器,未声明走 `panelRatio`。
  - 观察完成:Layout 测试证明拖拽回调持续更新;无 `panelWidth` 的普通 WebExt 零回归。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 11.1_
  - _Boundary: ChatApp_
- [ ] 3.4 回归门:普通 Agent / WebExt 零行为变化
  - 无 Panes 的 Agent、普通 WebExt、无 panelRight 页面回归测试。
  - 观察完成:Regression 套件全绿(F2 验收门)。
  - _Requirements: 11.1_
  - _Depends: 3.1, 3.2, 3.3_

- [x] 4. Wave 3:一致性范例(轨道 E)
- [x] 4.1 `panes-agent` 只消费公开包
  - 删除 Agent-local Host core,改用 `@blksails/pi-web-panes-kit` 公开入口;产物只保留 `.pi/web/dist/` 编译产物。
  - 观察完成:示例源不 import 任何 pi-web 内部模块;isolated build 通过。
  - _Requirements: 8.1_
  - _Boundary: examples/panes-agent_
  - _Depends: 2.3, 3.4_
- [x] 4.2 文件/编辑/Diff/Artifact 走 Agent Routes 与 Surface
  - 业务写入采用 schema 校验、revision CAS 和 change journal;热态走 Surface,冷数据与 mutation 走 Agent Routes。
  - 观察完成:route/surface 集成测试通过,`REVISION_CONFLICT` 语义可复现。
  - _Requirements: 8.2_
  - _Boundary: examples/panes-agent/routes_
  - _Depends: 4.1_
- [x] 4.3 Canvas Pane 复用既有 Canvas 链路
  - Canvas iframe 装载现有 `CanvasPanel`;Guest SDK 适配 `WebExtSurfaceAccess`(`surface:canvas` + action grants)、`UploadFn`(`attachment.put`)、`ConversationAccess`(`conversation.submit`);Agent 装载既有 `canvasSurfaceExtension`、AIGC 与 vision extensions。
  - 观察完成:构建产物包含 canonical Canvas UI;Canvas 无平行实现;多个 Canvas Tab 独立 Realm 观察同一 `surface:canvas`(F3 验收门)。
  - _Requirements: 8.3, 8.4, 8.5, 11.2_
  - _Boundary: examples/panes-agent/web_
  - _Depends: 4.1_

- [x] 5. Wave 4:Desktop adapters(轨道 F)
  > 原 5.1「Electron `WebContentsView` adapter」随桌面壳 Tauri 化(spec electron-to-tauri)废止;`PanePort/PaneViewAdapter` 抽象与共用中继原语保持宿主中立,第三方 Electron 壳可据此自行实现。
- [x] 5.1 共用中继原语与 Guest Realm 引导 (P)
  - `packages/panes-kit/src/adapters/relay.ts`:信封 `PaneRelayEnvelope` 原样透传;宿主侧 `createRelayPanePort` 按 `instanceId+epoch` 绑定并过滤;Guest Realm 侧 `createPaneGuestRealmBridge` 重建「window 握手 + MessageChannel」——`connectPaneGuest` 零改动、Guest API 不分叉。
  - 观察完成:conformance 套件证明握手/透传/epoch 换代/dispose 语义与 iframe 一致。
  - _Requirements: 9.1, 9.3_
  - _Boundary: packages/panes-kit/src/adapters/relay.ts_
  - _Depends: 1.3_
- [x] 5.2 Tauri WebView adapter 与 Rust relay (P)
  - `adapters/tauri.ts`(注入 invoke/listen/createPaneWebview,不硬依赖 @tauri-apps/api)+ `adapters/tauri-bootstrap.ts` init script;`desktop/src-tauri/src/pane_relay.rs` 四命令只转同一 envelope(标签鉴权、epoch 单调绑定、epoch 匹配解绑);`permissions/pane-relay.toml` host/guest 权限分离,`capabilities/panes.json` 把 `pane-*` webview 收窄到事件监听 + 上行中继;文档协议白名单 mount 即拒。
  - 观察完成:cargo 单测(注册表语义、信封 camelCase 逐字往返、声明一致性)与 TS guardrails 通过。
  - _Requirements: 9.1, 9.2, 9.3_
  - _Boundary: packages/panes-kit/src/adapters, desktop/src-tauri_
  - _Depends: 1.3_
- [x] 5.3 双宿主共用 conformance fixture
  - 同一 Guest fixture(真实 `connectPaneGuest`)跨 browser-iframe 与 tauri-webview 传输运行:握手身份、双向信封逐字透传(含宿主错误语义)、surface/lifecycle 下行、epoch 换代隔离、dispose 双向静默。
  - 观察完成:`packages/panes-kit/test/conformance/` 双宿主用例全绿(F4 验收门,Electron 维度随平台废止;Rust 注册表另有 cargo 单测锁定同一语义)。
  - _Requirements: 9.4, 11.3_
  - _Depends: 2.3, 5.1, 5.2_

- [ ] 6. Wave 5:AIGC 迁移(轨道 G)
  > 前置已备:迁移载体为「pane 自带 tools」模式——每业务域 pane 一个 `PaneAgentModule`(元信息 + extensions + routes),`composePaneAgentModules` 装配即用并校验 route 覆盖(tool-kit `src/panes/agent-modules.ts`,样板 `examples/panes-agent/panes-modules.ts`)。注:原型 UI(SearchPage/CanvasWorkspace/MaterialDrawer)在外部 AIGC 项目仓,本仓提供 kit 侧承载;迁移执行须联动该仓(见 docs/aigc-agent-tab-integration-analysis.md)。
- [ ] 6.1 按领域拆分业务 Pane
  - 按素材、Canvas、任务、历史等领域拆 Pane;恢复原型侧栏、Tab、Dialog 和工作流。
  - 观察完成:原型 UI/UX 在 Pane 架构下恢复。
  - _Requirements: 10.1_
  - _Depends: 4.3, 5.3_
- [ ] 6.2 数据通道迁移
  - HTTP 全部转 Agent Routes,媒体转附件引用,热态转 Surface。
  - 观察完成:业务闭环恢复,无绕过通道的直连 HTTP。
  - _Requirements: 10.2, 10.3_
  - _Depends: 6.1_
- [ ] 6.3 迁移验收
  - 视觉回归、业务闭环、三宿主隔离与 LLM 同源状态全部通过;不反向污染 Panes 地基(F5 验收门)。
  - 观察完成:总体验收门(requirements 11)全绿。
  - _Requirements: 10.4, 11.1, 11.2, 11.3, 11.4_
  - _Depends: 6.2_

## Implementation Notes

### PR 切分

| PR | 内容 | 审核证据 |
|---|---|---|
| Foundation-1 | Contract + instance core + security tests | 纯 package 测试 |
| Foundation-2 | Browser Host + Guest SDK | iframe conformance/e2e |
| Foundation-3 | pi-web seams + controlled width | protocol/UI/integration tests |
| Foundation-4 | panes-agent canonical examples | isolated build + route/surface tests |
| Desktop-1 | Tauri adapter + Rust relay | cargo 单测 + 双宿主 conformance |
| AIGC-* | 按业务 Pane 迁移 | 每 Pane 视觉和数据闭环 |

### 现状

- `packages/panes-kit/src`(contract/instances/authorization/agent-routes/guest/host-ports/react)已在分支 `codex/panelright-viewhost-foundation-docs` 落地(见提交 `21162a6`、`c902940`),对应任务 1.x–2.x 的实现面。
- Wave 4(5.1–5.3)已按上述「观察完成」条件核对勾选:panes-kit `test/conformance/` 双宿主全绿、`cargo test`(desktop/src-tauri,含 pane_relay)全绿。
- 2026-07-23 核对轮:1.1–1.4、2.1–2.3、3.1、3.3、4.1 按「观察完成」取证勾选——panes-kit typecheck 净、vitest 29/29 绿(contract 重复 ID/上限/默认拒绝、instances 多开/epoch/close、conformance 握手/stale epoch/dispose、agent-routes 成功/SESSION_NOT_FOUND/409 冲突/非 JSON/超大响应/装配重试、PanesHost 多开/切换/拖排/空态恢复;409/非 JSON/PanesHost 交互用例为本轮补齐)。契约 grep 无 canvas/aigc/files 词。protocol 377/377 绿(含 min/maxPanelWidth 描述符)、ui 套件 panel-resize 通过、`test/panes-agent-build.test.ts` 单跑绿(并行跑时与他套件争 dist 文件锁会假失败)。cargo 75/75 绿(含 pane_relay)。
- 2026-07-23 第二轮:3.2、4.2、4.3 取证勾选,Wave 3 全成——panes-kit 31/31 绿(新增:attachment.put 经真实握手还原 File 走注入 upload 且 Guest 仅得 attachmentId/displayUrl、surface.run 逐 action 授权、F3 三实例独立端口共观 surface:canvas 且关闭其一不扰其余);4.2 由既有 `test/panes-agent.test.ts` 5/5 取证(REVISION_CONFLICT 可复现、diff 只读、路径安全、artifact 生命周期);4.3 由 build 测试断言 canonical `canvas-checkerboard`(canvas-ui 工作台)+ import 审计取证。契约小修:`PaneGuestRequestSchema.bytes` 由 `z.instanceof(ArrayBuffer)` 改 brand 判别(结构化克隆/跨 realm 中继后 instanceof 失真)。`test/setup.ts` 与 `packages/ui/test/setup.ts` 补 Node 25 localStorage 残缺垫片(循 chat-app-logs-wiring 先例),chat-app 回归 13/13、ui canvas 四文件 39/39 复绿。
- 未勾且已知缺口:仅余 3.4 回归门全绿(F2)——本机余噪均与 panes 无关且在路线外:logger 测试 `C:\C:\` 路径拼接病、`@pi-clouds/registry-client` 兄弟仓缺失、runtime-payload/webext-locate-dist 的 POSIX 路径断言、bash/stream/stub-agent 集成超时、tool-kit test/aigc 模型目录漂移(期望 `gpt-image-2` 实为 `gpt-image-2-sufy`)。F2 以 CI/Linux 全量取证后勾选;届时 Wave 5 解锁。

### 合并纪律

见 design.md「Migration Strategy」:A 独占公开契约;B/C 不修改业务状态;D 不修改实例状态机;E 不复制 Host core;Desktop 只替换 adapter;AIGC 迁移不得早于 Browser、pi-web seam 和一致性范例验收。
