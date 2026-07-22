# PanelRight 与 Workspace 地基并行工作规划

> 日期：2026-07-22  
> 目标：在不抢占上层 workspace/desktop 宿主职责的前提下，先完成可独立验证、最终可直接接入的 PanelRight 模块基础。

## 1. 边界结论

### 1.1 Surface 已有完整宿主协议

Panel 模块不建立第二套 Surface：

```text
命令上行
Guest SurfaceCommandPayload
→ PanelHost grant 校验
→ WebExtSurfaceAccess.run
→ ui-rpc agent 转发
→ wireSurfaceBridge
→ agent createSurface command
→ SurfaceCommandResult

快照下行
agent createSurface update
→ control:"state" / key="surface:<domain>"
→ WebExtSurfaceAccess getState/subscribe
→ PanelHost surface.snapshot
→ Guest 只读镜像
```

Panel 模块层只负责安全投影：校验、授权、实例隔离和 Guest Runtime；不修改 `createSurface/useSurface/wireSurfaceBridge` 的语义。

### 1.2 Desktop 桥必须经过上层应用

原生模块 WebView 与 pi-web 主页面 WebView 是兄弟上下文。PanelHost 无法仅靠 React DOM 创建或管理原生 WebView。完整链路必须是：

```text
PanelHost（主 WebView）
↕ 上层应用注入的 View Host transport
workspace / desktop 主进程或 Rust 层
↕ instance relay
Guest WebView
```

上层 workspace/desktop 负责：

- 创建、定位、显示、聚焦和销毁原生 WebView。
- 主 WebView 与 Guest WebView 间的实例级消息中继。
- DPI、窗口移动、z-order、overlay、崩溃和资源回收。
- 暴露最终的 View Host 契约。

PanelHost 负责：

- 模块声明、实例状态和能力 grant。
- Route、Surface、Conversation、附件请求的校验与执行。
- iframe 握手，或消费上层提供的 native transport。
- Tab/Pane 业务组合中由 Agent 明确拥有的部分。

### 1.3 两个 Workspace 不得混名

远端 `main` 的 Host Contract v1 已定义 `Workspace`，它是 `user/project` 双命名空间的 JSON 状态存储端口，不是 UI 工作区，也不负责 WebView。UI 容器地基在本文暂称 `View Host`，最终名称服从作者提供的 workspace 契约。

## 2. 并行原则

1. 先做协议以下、平台以上的纯逻辑，不实现 desktop 原生视图。
2. 先用内存 transport 和 iframe 验证；native transport 必须可无改动复用同一套 wire/conformance tests。
3. 不修改 `desktop/src-tauri`、`lib/app/desktop-bridge.ts` 或 PiChat 布局来抢占上层接口。
4. 不建立 app-global TabRegistry、Dock store 或跨 Slot 布局。
5. 所有业务 HTTP 先迁到 Agent Routes；所有权威交互状态先迁到 Surface；所有大载荷先迁到附件引用。
6. PanelHost 与 workspace 最终只通过 View Host 端口耦合，双方不共享业务对象。

## 3. 现在可以开工的工作包

| 工作包 | 交付物 | 与 workspace 的耦合 | 验收 | 估算 |
|---|---|---|---|---:|
| P1 Surface Guest 投影 | `SurfaceCommandPayload/Result` 映射、snapshot 投递、domain/action grant、降级态 | 无 | fake `WebExtSurfaceAccess` 单测；双实例快照一致、UI 状态不串 | S |
| P2 ModuleChannel core | wire schema、状态机、超时/取消/限流、错误码、内存 transport | 无 | schema + 状态机 + fuzz/畸形消息测试 | M |
| P3 Guest SDK | `withPanelModule/usePanelModule`、本地 Surface store、Route/Conversation/附件门面 | 无 | 独立 Guest fixture 在 fake host 下运行 | M |
| P4 iframe adapter | opaque-origin sandbox、MessagePort 握手、重载撤权、关闭清理 | 无 | 浏览器恶意 Guest e2e 与多实例隔离 | M |
| P5 AIGC 业务拆分 | canvas/materials/search/sandbox 独立页面；HTTP→Routes，状态→Surface，文件→附件 | 无 | 每个页面在 standalone harness 可操作；不依赖 PanelRight | L |
| P6 conformance suite | transport/container 共享契约测试，包含 fake native adapter | 只定义消费语义 | iframe 与 fake native 全部通过同一套用例 | M |

建议并行顺序：

```text
轨道 A：P1 Surface 投影 ───────────────┐
轨道 B：P2 Channel core → P3 Guest SDK ├→ P4 iframe → 浏览器闭环
轨道 C：P5 业务页面拆分 ───────────────┘
轨道 D：P6 conformance suite（从 P2 起同步维护）
```

P1、P2、P5 可以同时开始。P4 等 P2/P3 的握手和 Runtime 稳定后接入。

## 4. 等 workspace 地基后再做

| 暂缓项 | 等待的上层契约 | 原因 |
|---|---|---|
| D1 Desktop native adapter | View Host `open/transport/placement/visible/focus/close/crash` | 创建和中继属于上层应用 |
| D2 原生几何联动 | 坐标系、DPI、窗口移动和 overlay 规则 | DOM rect 不是最终窗口坐标 |
| D3 最终 Tab/Dock chrome | workspace 明确 chrome/布局状态归属 | 避免两边各造一套容器 |
| D4 布局持久化 | workspace 的状态 owner 与存储 key 规范 | 避免与 Host Contract `Workspace` 混用 |
| D5 Electron/Tauri e2e | native View Host 实现与测试启动方式 | fake transport 不能证明原生资源正确 |

在上述契约落地前，只保留 `ViewHostPort` 的消费侧接口和 fake adapter，不向 pi-web 提交临时 desktop 命令。

## 5. 与作者对齐时需要确认的六项

1. Tab/Pane/Dock chrome 最终由 workspace 统一提供，还是 Agent PanelHost 自己组合。
2. 原生视图打开接口的输入：入口 URL、instanceId、sessionId、标题及安全策略分别由谁校验。
3. 主 WebView 与 Guest WebView 的 relay 由哪个进程维护，是否保证实例内 FIFO。
4. placement 使用哪种坐标系，窗口移动、缩放和 DPI 变化由谁触发更新。
5. overlay、弹窗、拖拽和焦点切换时原生 WebView 的遮挡规则。
6. View 生命周期和布局状态由谁持久化，session/agent 切换时如何批量清理。

只要这六项确定，P1–P6 的产物无需改业务协议，只需实现一个符合 conformance suite 的 native `ViewHostPort` adapter。

## 6. 第一阶段交付定义

第一阶段不等待 workspace，交付：

- Surface Guest 投影协议与测试。
- ModuleChannel core、Guest SDK 和内存 conformance harness。
- 浏览器 iframe adapter 与恶意 Guest e2e。
- AIGC 四个独立页面的 Routes/Surface/附件闭环。
- 一个 standalone Panel harness，用于开发和视觉验收，但不宣称 Desktop 或最终 workspace 集成完成。

第一阶段不改 pi-web 核心、不实现 Tauri/Electron 原生 WebView、不冻结最终 Tab/Dock UI。

## 7. 第二阶段接入条件

当上层 workspace 提供 View Host 契约后：

1. 将其接口适配为 `ModuleTransport + NativeViewHandle`。
2. 运行 P6 conformance suite。
3. 接入 panelRight 最终 chrome 与 placement。
4. 分别执行 Electron/Tauri 安全、崩溃、焦点、overlay、资源回收 e2e。
5. 完成后再把稳定的 core/guest/react 部分上提为共享 package。

## 8. 权威依据

- [Surface 权威表面栈](https://github.com/blksails/pi-web/blob/main/docs/product/04-surface-stack.md)
- [Surface App Runtime 契约 v1](https://github.com/blksails/pi-web/blob/main/docs/surface-app-runtime-contract-v1.md)
- [Surface 线协议](https://github.com/blksails/pi-web/blob/main/packages/protocol/src/web-ext/surface.ts)
- [WebExt Surface Access](https://github.com/blksails/pi-web/blob/main/packages/web-kit/src/surface-access.ts)
- [pi-web 宿主契约 v1](https://github.com/blksails/pi-web/blob/main/docs/pi-web-host-contract-v1.md)
- [Desktop bridge](https://github.com/blksails/pi-web/blob/main/lib/app/desktop-bridge.ts)
- [Tauri 主窗口宿主](https://github.com/blksails/pi-web/blob/main/desktop/src-tauri/src/window.rs)
