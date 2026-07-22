# PanelRight Isolated View Host 地基实施路线图

## 1. 目标

建立一套轻量、可复用的独立模块寄宿范式，使任意 agent 都能把同一个模块挂到现有 WebExt 插槽中，并由宿主选择 iframe、Tauri WebView 或 Electron WebView 运行。

每个 Tab 对应一个独立 View。Tab 之间不共享 DOM、React Context、全局变量或执行环境；只能通过宿主授予的窄能力通信。

地基只解决四件事：

1. 模块如何声明。
2. 独立 View 如何创建、放置、切换和销毁。
3. 宿主能力如何按白名单投影给模块。
4. iframe、Tauri、Electron 如何通过同一套一致性测试。

AIGC 工作台是后续消费者，不进入地基协议、包名、错误码或测试夹具的领域模型。

## 2. 不可变设计决策

1. **一 Tab 一 View**：每个 Tab 独占一个 iframe 或原生 WebView；禁止多个 Tab 共用同一 JS Realm。
2. **Slot 只负责放置**：`panelRight`、`headerCenter`、`launcherRail`、`dialogLayer` 等现有 WebExt Slot 是挂载点，不承担模块协议。
3. **PanelHost 是薄控制器**：只管理 Tab、尺寸、激活态、View 生命周期与能力投影，不实现领域业务。
4. **Surface 是写控制面**：领域状态由 agent 单写；模块发意图、读快照，不直接改权威状态。
5. **Agent Routes 是读数据面**：列表、分页、搜索、详情等 HTTP 读取走现有会话级 Agent Routes；v1 不允许模块借 Route 写领域状态。
6. **附件只传引用**：业务消息只传 `att_*` 与短期访问 URL；二进制不进入 JSON 消息信封。
7. **会话能力由宿主投影**：`session.id`、`session.title` 等只读上下文由 PanelHost 注入；模块不自造“查询会话名”接口。
8. **不依赖 frame-rpc**：模块通信使用浏览器标准 `MessageChannel` 和桌面壳原生 IPC relay；信封与传输接口独立，不依赖未合入分支。
9. **HOC 不是隔离边界**：React HOC 只规范 Guest 应用接入；安全隔离由 iframe sandbox / 原生 WebView、权限白名单和消息校验保证。
10. **pi-web 保持领域中立**：核心只认识 view、module、capability、session、surface、route、attachment，不认识画布、图库、技能或 AIGC。

## 3. 三层职责

| 层 | 交付物 | 负责 | 不负责 |
|---|---|---|---|
| pi-web 地基 | 协议、Guest SDK、`ViewHostPort`、iframe/Tauri/Electron adapter、能力投影、一致性套件 | 生命周期、隔离、校验、通用能力 | Tab 业务含义、AIGC UI、模块编排策略 |
| agent 宿主 | WebExt `PanelHost`、Tab 模型、布局策略、模块清单、权限授予 | 选择模块、选择 Slot、受控宽度、会话上下文映射 | 模块内部 UI、权威业务状态 |
| 独立模块 | Guest React 应用、`defineModule`/HOC、模块自身 UI/UX | 业务展示与交互、调用获授能力 | 直接访问宿主状态、跨 Tab 通信、持有宿主凭据 |

依赖只能向下：独立模块依赖 Guest SDK；agent 宿主依赖地基；pi-web 地基不依赖具体 agent。

## 4. 运行结构

```text
PiChat
  └─ SlotHost(panelRight / headerCenter / dialogLayer ...)
       └─ Agent PanelHost（受信 WebExt 组件）
            ├─ TabStrip / Launcher / Resize UI
            └─ Viewport
                 └─ ViewHostPort
                      ├─ IframeViewHost
                      ├─ TauriWebviewHost
                      └─ ElectronWebviewHost
                           ⇅ ModuleChannel
                              Guest SDK
                                └─ 独立模块应用

能力投影：
  Surface       → 状态快照 + 命令
  Agent Routes  → 会话级只读 HTTP 数据
  Attachments   → 上传/解析/短期访问 URL
  Conversation  → 提交用户消息与附件引用
  Session       → id/title/theme/locale 等只读上下文
```

Tab 切换只改变 View 的可见性和焦点。关闭 Tab 必须销毁 View、断开通道、取消订阅并清理所有挂起请求。

## 5. 地基公开契约

### 5.1 模块声明

模块清单是纯数据，可被 WebExt、构建工具和宿主在执行模块代码前校验。

```ts
export interface IsolatedModuleManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly entry: string;
  readonly icon?: string;
  readonly supportedHosts?: readonly ("iframe" | "tauri" | "electron")[];
  readonly preferredSize?: {
    readonly width?: number;
    readonly minWidth?: number;
    readonly maxWidth?: number;
  };
  readonly requests?: ModuleCapabilityRequest;
}

export interface ModuleCapabilityRequest {
  readonly surfaces?: Readonly<Record<string, readonly string[]>>;
  readonly routes?: readonly string[];
  readonly attachments?: readonly ("read" | "upload")[];
  readonly conversation?: readonly ("submitUserMessage")[];
  readonly session?: readonly ("id" | "title" | "theme" | "locale")[];
}
```

约束：

- `id` 在一个 WebExt 内唯一；运行时身份为 `extId/moduleId/instanceId`。
- `entry` 只能在扩展产物允许的基址或宿主显式许可的 origin 下解析。
- `requests` 只是申请，不等于授权；PanelHost 必须生成实际 grant。
- 未声明或未授权的能力在 Guest SDK 中不可见，调用返回稳定的 `CAPABILITY_DENIED`。

### 5.2 会话上下文

```ts
export interface ModuleContextSnapshot {
  readonly protocolVersion: 1;
  readonly instanceId: string;
  readonly extensionId: string;
  readonly moduleId: string;
  readonly session: {
    readonly id: string;
    readonly title?: string;
  };
  readonly theme: Readonly<Record<string, string>>;
  readonly locale: string;
  readonly grantedCapabilities: readonly string[];
}
```

`session.title` 由 agent 宿主从会话上下文（如 `ctx.title` 或宿主会话元数据）映射后注入。标题变化通过 `context.changed` 事件推送；模块不得为此增加专用 Route。

### 5.3 ViewHostPort

```ts
export interface ViewHostPort {
  mount(input: ViewMountInput): Promise<ViewHandle>;
}

export interface ViewMountInput {
  readonly manifest: IsolatedModuleManifest;
  readonly context: ModuleContextSnapshot;
  readonly grant: ModuleCapabilityGrant;
  readonly channel: ModuleHostEndpoint;
}

export interface ViewHandle {
  readonly instanceId: string;
  setVisible(visible: boolean): Promise<void>;
  updateBounds(bounds: ViewBounds): Promise<void>;
  focus(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleFactor: number;
}
```

`ViewHostPort` 只描述结果，不暴露 iframe、Tauri 或 Electron 类型。每个 adapter 在构造时绑定自己的 DOM anchor、窗口句柄和 IPC 实现。

`dispose()` 必须幂等；会话切换、source 切换、Tab 关闭、PanelHost 卸载和宿主退出都必须调用。

### 5.4 ModuleChannel

模块通道只提供握手、请求响应和事件三种语义，不构造第二套 agent RPC。

```ts
export type ModuleEnvelope =
  | { v: 1; instanceId: string; type: "hello"; nonce: string }
  | { v: 1; instanceId: string; type: "ready"; nonce: string }
  | { v: 1; instanceId: string; type: "request"; id: string; capability: string; operation: string; payload?: unknown }
  | { v: 1; instanceId: string; type: "response"; id: string; ok: true; data?: unknown }
  | { v: 1; instanceId: string; type: "response"; id: string; ok: false; error: ModuleError }
  | { v: 1; instanceId: string; type: "event"; topic: string; payload?: unknown };

export interface ModuleError {
  readonly code:
    | "INVALID_MESSAGE"
    | "CAPABILITY_DENIED"
    | "NOT_AVAILABLE"
    | "TIMEOUT"
    | "ABORTED"
    | "DISPOSED"
    | "HOST_ERROR";
  readonly message: string;
}
```

传输映射：

- iframe：父窗口创建独占 `MessageChannel`，首个可信 `postMessage` 只转交一个端口；后续消息只走该端口。
- Tauri：Rust/JS bridge 仅按 `instanceId` 中继同一信封；不解释 capability 业务。
- Electron：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；preload 只暴露同一信封的 send/subscribe。

所有 adapter 必须共享 schema、超时、并发限制、错误码和 disposal 语义。

## 6. 能力投影

### 6.1 SurfaceProjection

复用 `WebExtSurfaceAccess`：

- `surface.snapshot(domain)` 读取 `surface:<domain>` 当前镜像。
- `surface.subscribe(domain)` 订阅镜像变化。
- `surface.run(domain, action, args)` 调用既有 `surface.run`。
- PanelHost 同时校验获授 domain 与 action；Guest 传入未授权值时不触及底层总线。
- Surface 响应直接沿用 `SurfaceCommandResult`，不新增相似结果类型。

### 6.2 AgentRouteProjection

复用现有端点：

```text
GET /api/sessions/:sessionId/agent-routes/:name
```

规则：

- v1 只投影 GET；写操作必须走 Surface。
- `sessionId` 由宿主绑定，Guest 不可覆盖。
- route name 必须同时存在于 agent 声明和模块 grant。
- 鉴权、会话隔离、超时、体积上限沿用 Agent Routes。
- 模块只得到 JSON 结果，不得到宿主 Authorization、cookie 或内部 base URL。

### 6.3 AttachmentProjection

复用现有附件上传与解析接口：

- `attachments.resolve(attId)` 返回可展示的短期 URL 与描述符。
- `attachments.upload(file)` 由宿主调用既有 `SlotUploadFn`/attachment API，返回 `attId`。
- JSON 信封只携带元数据和引用；二进制通过 adapter 的可转移对象或平台原生带外路径传输，禁止 base64 塞入通道。
- `attId` 必须经当前会话属主校验。

### 6.4 ConversationProjection

复用 `ConversationAccess.submitUserMessage(text, { attachmentIds })`。PanelHost 只搬运文本与显式附件引用，不解析 Prompt，不推断工具。

### 6.5 SessionProjection

只读投影 `id/title/theme/locale`。模块无权改标题；若后续需要改标题，应调用 agent 侧标准会话能力，而非在 ModuleChannel 增加领域写操作。

## 7. WebExt 与 PanelRight 接入

### 7.1 WebExt 声明扩展

在 `@blksails/pi-web-kit` 增加可选的模块清单，不改变既有 Slot 贡献形态：

```ts
export interface WebExtension {
  // existing fields...
  readonly isolatedModules?: readonly IsolatedModuleManifest[];
}
```

可序列化 manifest 增加可选 capability `isolatedModules`。这是增量字段；没有该字段的扩展行为不变。

### 7.2 PanelRight 受控宽度

在 WebExt 声明式 config 增加可选布局请求：

```ts
interface PanelRightLayoutConfig {
  readonly initialWidth?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly resizable?: boolean;
}
```

宿主 `SessionView` 持有实际宽度状态，并把它映射到 PiChat 已有的：

- `panelWidth`
- `onPanelWidthChange`
- `minPanelWidth`
- `maxPanelWidth`

WebExt 只能声明初值和边界，不能直接控制宿主布局。用户拖拽后的值由宿主决定是否持久化。

### 7.3 PanelHost 组成

PanelHost 由 agent 提供，推荐拆为：

```text
PanelHost
  ├─ ModuleLauncher（可复用到 headerCenter / launcherRail）
  ├─ TabStrip
  ├─ ViewportAnchor
  └─ PanelStatus（加载、错误、重试）
```

模块入口和 Tab 条可分别挂在现有 Slot：

- `headerCenter` / `launcherRail`：模块启动器或会话上方入口。
- `panelRight`：主要 Viewport 与 TabStrip。
- `dialogLayer`：同一模块的临时全屏/对话框投影。

不新增“会话上方模块”专用 Slot；先复用现有 Slot。只有现有 Slot 无法表达稳定布局时，才以独立规格增加新 SlotKey。

### 7.4 Tab 状态

```ts
export interface ModuleTab {
  readonly instanceId: string;
  readonly moduleId: string;
  readonly title: string;
  readonly closable: boolean;
}

export interface PanelViewState {
  readonly tabs: readonly ModuleTab[];
  readonly activeInstanceId?: string;
}
```

默认采用受控模型：`value + onChange`。agent 可用内存、会话状态或独立的布局存储适配器保存；地基不把 UI Tab 状态误写入 host-contract 的 `Workspace` 语义中。

## 8. Guest SDK

Guest SDK 保持小型、框架无关：

```ts
export interface PiWebModuleApi {
  readonly context: ModuleContextSnapshot;
  readonly surface?: SurfaceGuestApi;
  readonly routes?: AgentRoutesGuestApi;
  readonly attachments?: AttachmentsGuestApi;
  readonly conversation?: ConversationGuestApi;
  subscribe(topic: string, listener: (payload: unknown) => void): () => void;
  dispose(): void;
}

export function connectPiWebModule(): Promise<PiWebModuleApi>;
```

React 只提供薄封装：

```ts
export function withPiWebModule<P>(Component: React.ComponentType<P & { module: PiWebModuleApi }>): React.ComponentType<P>;
export function usePiWebModule(): PiWebModuleApi;
```

HOC/hook 负责 loading、ready、disposed 三态和统一错误边界；不负责 Tab、窗口尺寸或权限判断。

## 9. 安全基线

所有实现必须满足：

1. 默认拒绝；模块申请与宿主授权取交集。
2. 握手校验 `protocolVersion + instanceId + nonce + source/origin`。
3. iframe 默认 `sandbox="allow-scripts"`，不启用 `allow-same-origin`、表单、弹窗、下载或顶层导航；能力按需逐项增加。
4. iframe 的 `targetOrigin` 必须是精确 origin，初始化阶段同时校验 `event.source`。
5. Electron 禁用 Node，启用 sandbox/contextIsolation，preload 无通用 `invoke`。
6. Tauri 为子 WebView 使用独立 label 与最小 ACL；Rust command 校验调用者 label 和 instanceId。
7. 双向消息均做 schema 校验；未知字段按 schema 策略处理，禁止直接展开进宿主对象。
8. 设置单消息大小、并发请求数、事件速率、超时与队列上限。
9. Guest 永远拿不到 cookie、Bearer token、数据库连接或宿主文件路径。
10. source/session 切换立即吊销 grant；旧 View 的迟到消息一律丢弃。
11. View 崩溃只影响对应 Tab；PanelHost 和对话区继续可用。
12. 日志必须脱敏，按 `extensionId/moduleId/instanceId` 定位，但不记录业务正文和附件字节。

## 10. 规格拆分与依赖波次

### F0 · `isolated-module-contract`

交付：

- `IsolatedModuleManifest`、`ModuleContextSnapshot`、grant、信封 schema、稳定错误码。
- `ViewHostPort`、`ViewHandle`、`ModuleHostEndpoint`。
- Guest SDK 核心与内存 transport。
- 协议兼容矩阵、体积/并发/超时默认值。
- adapter 一致性测试夹具。

验收：纯 Node 单测全绿；畸形消息、重复响应、超时、取消、dispose 后消息均有机械断言。

### F1 · `isolated-module-iframe-host`

依赖：F0。

交付：

- `IframeViewHost`、`MessageChannel` 握手、sandbox/origin 策略。
- View bounds、显示、焦点、销毁。
- Surface、Agent Routes、Attachments、Conversation、Session 投影。
- 最小 Guest fixture。

验收：真实 Chromium 中两个 Tab 同时运行，彼此读不到变量/DOM/端口；关闭一个不影响另一个；越权调用被拒绝。

### F2 · `webext-panel-workspace-host`

依赖：F0、F1。

交付：

- WebExt `isolatedModules` 可选声明。
- `PanelRightLayoutConfig` 到 PiChat 受控宽度的宿主映射。
- 通用 `PanelHost` primitives：TabStrip、Launcher、ViewportAnchor、错误/重试态。
- `headerCenter`、`launcherRail`、`panelRight`、`dialogLayer` 的组合范例。

验收：无模块的 agent 零行为变化；普通 React `panelRight` 仍可用；模块 View 可在不改 Guest 的情况下换 Slot。

### F3 · `desktop-native-view-host`

依赖：F0；可与 F1 后半段并行。

交付：

- 桌面 bridge 增加 View create/bounds/visibility/focus/dispose 的窄接口。
- `TauriWebviewHost`：子 WebView 生命周期、几何同步、IPC relay、ACL、崩溃清理。
- `ElectronWebviewHost` 兼容 adapter：BrowserView/WebContentsView + preload 窄桥。
- 同一 Guest fixture 在原生 View 中运行。

验收：Tauri 为必须绿；Electron 至少通过 adapter 契约测试和可运行 smoke。两者不得向 Guest 暴露通用 native invoke。

### F4 · `isolated-module-conformance`

依赖：F1、F2、F3。

交付：

- `runViewHostConformance(adapter)`。
- 浏览器/Tauri/Electron 契约矩阵。
- 安全、泄漏、崩溃恢复、快速切 Tab、连续 resize、会话/source 切换测试。
- 示例 agent，只使用通用计数/列表 fixture，不含 AIGC。

验收：三个 adapter 对同一 fixture 产生同一协议结果；普通聊天、普通 Slot、Surface、Agent Routes、附件回归全绿。

### F5 · `aigc-agent-workspace-migration`（后置）

依赖：F0–F4 全部通过并冻结 v1。

只负责：

- 把源 AIGC 页面拆成独立模块。
- 用 agent WebExt 组合 PanelHost、Tab、侧栏、对话框和上方入口。
- 用 Surface 替换领域写接口，用 Agent Routes 替换读 HTTP，用附件系统承载媒体。
- 从会话上下文读取标题，不复制 pi-web 会话逻辑。

不得反向修改 F0–F4 契约以迁就 AIGC 私有模型；确有通用缺口必须先以独立变更完善地基并通过一致性套件。

## 11. 里程碑与冻结门

| 里程碑 | 可交付状态 | 冻结条件 |
|---|---|---|
| M0 契约核 | 内存 Guest/Host 可通信 | schema、错误码、生命周期测试通过 |
| M1 浏览器竖切 | iframe Tab 可用 | 强隔离、能力白名单、双 Tab e2e 通过 |
| M2 WebExt 范式 | 任意 agent 可声明和编排模块 | 受控宽度与多 Slot 组合回归通过 |
| M3 桌面竖切 | 同一模块运行于 Tauri/Electron | 原生生命周期、ACL、几何同步通过 |
| M4 地基 v1 | 跨宿主一致 | conformance + security + leak suite 通过 |
| M5 AIGC 接入 | 源页面/UI/UX 迁移 | 不增加 AIGC 专属宿主能力 |

只有 M4 冻结后才开始 M5。M0–M4 的示例和测试必须使用领域中立 fixture。

## 12. 包与代码落点

建议落点：

```text
packages/protocol/src/isolated-module/       # 纯数据 schema 与 wire contract
packages/web-kit/src/isolated-module/        # ViewHostPort、能力类型、Guest-neutral API
packages/react/src/isolated-module/          # Guest React hook/HOC
packages/ui/src/isolated-module/             # PanelHost primitives、iframe adapter
lib/app/isolated-module/                     # pi-web 宿主能力装配
desktop/src-tauri/src/view_host/              # Tauri 原生 View 与 relay
desktop/src-tauri/frontend/                   # JS desktop bridge adapter
test/isolated-module/                         # 协议/投影/一致性单测
e2e/isolated-module/                          # 浏览器与桌面 fixture
examples/isolated-module-agent/               # 领域中立参考 agent
```

边界要求：

- `protocol` 不依赖 React、DOM、Tauri、Electron。
- `web-kit` 不依赖具体宿主 adapter。
- `ui` 不依赖 AIGC 包。
- `desktop` 只实现 ViewHostPort，不解释 Surface/Route 领域 payload。
- `examples` 展示组合方式，不成为框架运行时依赖。

## 13. 实施顺序

1. 为 F0 建立正式 Kiro spec，先冻结协议和一致性测试接口。
2. 完成 F0 后并行启动 F1 与 F3 的 adapter 骨架。
3. F1 跑通能力投影后实施 F2，避免 PanelHost 先绑定未定协议。
4. F1/F2/F3 全绿后完成 F4 的跨 adapter 验收和安全加固。
5. 冻结地基 v1，发布 Guest SDK 与参考 agent。
6. 另开 F5，把 AIGC 作为纯消费者迁移。

每个阶段均以可独立合并的小 PR 交付；不得把 F0–F4 与 AIGC 页面代码放进同一个 PR。
