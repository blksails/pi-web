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

- [x] 3. Wave 2:pi-web 接缝(轨道 D) (P)
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
- [x] 3.4 回归门:普通 Agent / WebExt 零行为变化
  - 无 Panes 的 Agent、普通 WebExt、无 panelRight 页面回归测试。
  - 观察完成:Regression 套件全绿(F2 验收门)。
  - 取证(2026-07-24):PR #15 · CI Linux `Test (Linux 全量回归)` 绿(run 30019370120,
    `pnpm -r run typecheck` 14 包 + `pnpm test` 全套件;desktop cargo check/test 含内)。
    途中根因修:protocol `RpcSessionState.thinkingLevel` 容 "off"(pi 0.80.x 运行时实况)。
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
- ~~未勾且已知缺口:仅余 3.4 回归门全绿(F2)~~ **F2 已取证勾选(2026-07-24,PR #15 CI Linux 绿),Wave 5 解锁**。本机余噪复盘:logger `C:\C:\` 路径病与 POSIX 断言系 Windows 独症(Linux 绿);「模型目录漂移」实为 `~/.pi/agent/aigc.json` 的 `disabledModels` 渗入装配期单测(环境泄漏,测试隔离另修);`@pi-clouds/registry-client` 兄弟仓缺失属 registry 线(root tsc/root test 不在 `pnpm -r` 范围;cli-e2e 在 main 上因此三连红,另案修)。

### 合并纪律

见 design.md「Migration Strategy」:A 独占公开契约;B/C 不修改业务状态;D 不修改实例状态机;E 不复制 Host core;Desktop 只替换 adapter;AIGC 迁移不得早于 Browser、pi-web seam 和一致性范例验收。


## Wave 5 跨仓阻塞与记账更正(2026-07-24)

**记账更正**:`3.` 组标题(Wave 2 pi-web 接缝)的 4 个子任务(3.1–3.4)均已 `[x]`,
但组标题此前漏勾,本次补勾。

**Wave 5(6.1/6.2/6.3)在本仓无法执行 —— 属跨仓工作,保持未勾。**

依据任务 6 自带的前置说明与 `docs/aigc-agent-tab-integration-analysis.md`:
- 迁移的原型 UI(`SearchPage` / `CanvasWorkspace` / `MaterialDrawer`)位于**外部 AIGC 项目仓**
  (文档首行标注源在 `C:\workcode\aigc-agent`,即另一机器/另一仓),**不在 pi-web 本仓**,
  本机亦无该仓副本(`../aigc*` 无匹配)。
- 本仓的职责是「提供 kit 侧承载」,这部分**已全部完成**:
  - 载体 `PaneAgentModule` + `composePaneAgentModules`(`tool-kit/src/panes/agent-modules.ts`)
  - 样板 `examples/panes-agent/panes-modules.ts`
  - 6.1 的前置 4.3(Canvas Pane 复用既有链路)、5.3(双宿主 conformance)均已 `[x]`
- 6.1/6.2/6.3 的验收全部要求**外部仓的组件在 Pane 架构下恢复**(UI/UX 恢复、业务闭环恢复、
  视觉回归)——离开那个仓无从执行,也无从取证。

**不标记完成**——标完成等于谎报未做过、也无法在本仓做的迁移。解除条件:在 AIGC 项目仓
按本仓已备好的 `PaneAgentModule` 模式执行迁移并各自取证(该仓侧的工作项)。

本仓侧的 isolated-panes 地基(Wave 1–4 + pi-web 接缝)至此全部完成。

## Wave 5 前置演练:aigc-canvas-agent 就地迁 Pane(2026-07-28)

**6.1/6.2/6.3 仍不勾。** 本轮做的是**本仓一个真实业务示例的 slots → panes 就地迁移**,
作为跨仓迁移的前置演练与参照实现;它不满足 6.1 的验收(「按素材、Canvas、任务、历史等领域
拆 Pane;原型 UI/UX 在 Pane 架构下恢复」)——本示例只有 canvas 一个域,原型 UI 仍在外部仓。

### 为什么值得单做一轮

上面那节的结论(本仓 kit 侧「已全部完成」)**不完全成立**。把一个真实业务 UI 推过 iframe
边界后,立刻暴露了两个 panes-kit 结构性缺陷——它们在槽(slot)形态下不可能出现,
因此 `panes-agent` 与全部既有 conformance 测试都测不到:

| # | 缺陷 | 故障表现 | 修法 |
|---|---|---|---|
| 1 | `PanesHost.connect()` 把 surface 订阅**一次性绑死**在建连那一刻的 `surface` 上;宿主 `surfaceAccess` 由 `useMemo` 依赖会话连接/命令表构造,就绪握手后即换新实例,新快照落进新 store | pane 起来了、能力探针也对,**快照永远为空** | 抽 `bindSurface`,`surface` 换身份时整组退订重绑并立即重推当前值 |
| 2 | 建连仅两个触发点(iframe `onLoad`、guest `pane:ready`),`srcDoc` 无网络、解析完即执行,**刷新**时 workspace 从 localStorage 同步恢复、iframe 首帧即在,两者可同时早于宿主就绪 | tab/iframe/guest 脚本都在,`PaneGuestProvider` 空等 `pane:connected`,渲染 45 字符空壳;**只在刷新后复现** | 按 epoch 幂等补一次主动扫描;`pane:ready` 改**强制重连**(语义即「guest 重启、需新端口」) |

★ 修 #2 时曾**只跑 panes-kit 单测(31/31 绿)就下结论**,而那套测试覆盖不到该时序:
补连扫描在 guest 未就绪时抢先建连、epoch 守卫又挡掉真正的 `pane:ready`,导致 4 套 e2e 全红,
比修前更差。教训:**panes-kit 绿 ≠ 真实浏览器里连得上**,pane 时序问题必须以 browser e2e 为判据。

第三个缺陷在示例侧但同样有普遍性:`guest.query<T>()` 的泛型是**断言不是校验**,
route 未声明时宿主把 404 错误体当正常结果 resolve 回来,直接解构即渲染期崩溃、整个 pane 被卸载。
pane 的四条通道(route/surface/attachment/conversation)回来的都是未校验数据。

### 迁移决策(外部仓照搬时同样适用)

1. **`launcherRail` 入口必须撤** —— `canvasOpenStore` 是 module-level store,不跨 realm,留着是死按钮。
2. **`promptToolbar` 必须留** —— 它在宿主 realm,经 state 桥 KV 与子进程图像工具通信,与 pane 化无关;位置(发送键旁)即语义。
3. **轮末 auto-sync 需宿主侧补一手** —— `syncSignal` 不在 pane 协议里,由 `web.config.tsx` 的
   `ConfiguredPanesHost` 包装器代发 `run("canvas","sync")`。**刻意不往协议加通用 host-signal**:
   「一轮结束该 reconcile」是 canvas 域策略,多数 pane 不在对话语境里。
4. **pane 内容要给宿主浮层让位** —— 宿主的 `[data-pi-panel-ratio-switch]`(`absolute bottom-4 right-4 z-40`)
   会盖住 pane 右下角的动作按钮(实测点击被拦截,真实用户同样点不动);pane 侧加底部内边距,不改宿主 chrome。

### 改动面

- 新增 `examples/aigc-canvas-agent/{pane-meta.ts,panes-modules.ts,build.ts,web/}`;删 `.pi/web/web.config.tsx`
  与 `routes/index.ts`(pane 形态下 `PaneAgentModule` 即汇总点);`pi-web.json` 升 1.1.0(**未发布**)。
- `packages/panes-kit/src/react/panes-host.tsx` 三处(bindSurface / 补连扫描 / ready 强制重连);
  `test/panes-host.test.tsx` 改为在 `render` 前经 `HTMLIFrameElement.prototype.contentWindow`
  getter 装录制器,使断言对「宿主何时建连」不敏感(守的内容未放宽)。
- `lib/app/webext-registry.ts` 改导入编译产物;`scripts/build-webext-examples.ts` 接入本示例构建。
- 文档:`examples/aigc-canvas-agent/README.md` 新增「从 slots 迁到 panes」;
  `docs/product/16-canvas-workbench.md`(中英)与 `docs/surface-extension-standard.md` 的槽车道
  范例改指 `examples/canvas-plugin-stickers`(该示例仍是完整三槽形态)。

### 取证(2026-07-28 新鲜运行)

- browser e2e 4 套 **12 passed**(含未迁移的 `canvas-plugin-stickers` / `aigc-canvas-degrade`,
  证实 panes-kit 改动未波及槽车道)
- 根 app 测试 897 passed;panes-kit 31/31;真实 runner 集成 `canvas-surface.integration` 4/4
- 示例 tsc / 根 tsc 均 EXIT=0(★ 根 tsconfig `exclude: ["examples"]`,**examples 无 typecheck 面**,
  本轮用临时 tsconfig 补检——这是仓库既有缺口,非本轮引入)
- ⚠ **`e2e/sandbox-browser/aigc-canvas-sandbox.e2e.ts` 已按 `frameLocator` 同步改写但未运行** ——
  需真实 e2b + API key + 重新烘焙镜像,本机无法取证。

### 对 6.1 的意义

外部仓迁移时,上述 4 条决策与 3 个缺陷会原样重现,而那边**没有这套 e2e 兜底**。
本示例可作为 6.1 的参照实现直接对照。
