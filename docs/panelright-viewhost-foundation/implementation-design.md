# PanelRight 强隔离模块实施方案

> 文档类型：目标态架构与实施规范  
> 日期：2026-07-22  
> 适用范围：pi-web `panelRight`、Agent WebExt 寄宿层、iframe / Electron / Tauri 独立模块

## 1. 目标与交付形态

`panelRight` 挂载一个轻量 `PanelHost`。PanelHost 负责模块实例、宿主交互组件和能力代理；每个模块实例运行在独立 iframe / WebView 中。

```text
PiChat.panelRight
└─ Agent PanelHost
   ├─ Host UI：Tab / Pane / Splitter（按需组合）
   └─ ModuleSlot[]
      └─ 独立 iframe / Electron WebContentsView / Tauri Webview
```

无 Tab 模式仍渲染一个独立 `ModuleSlot`。模块 UI、脚本状态、消息通道和生命周期均按实例隔离。模块通过受控 Runtime 调用 Agent Routes、Surface、Conversation 和附件能力，不直接接触宿主内部对象。

本文中的“强隔离”指浏览上下文、能力和故障隔离。完全不可信的第三方二进制或任意网页还须结合进程/系统沙箱与供应链治理。

## 2. 需求与不可违背的约束

- **R1 薄宿主**：PiChat 只保留一个 `panelRight` Slot 和受控宽度，不理解 Tab、Pane、Canvas 等业务概念。
- **R2 强隔离**：每个模块实例必须拥有独立 iframe / WebContentsView / Tauri Webview；禁止业务 React 组件内联到宿主树。
- **R3 Agent 组合根**：模块清单、默认布局、Tab/Split 选择和业务能力授权均由当前 Agent 决定。
- **R4 能力复用**：业务 HTTP 走 Agent Routes；权威交互状态走 Surface；文件走附件系统；提交消息走 Conversation。
- **R5 默认拒绝**：Guest 不能取得宿主 DOM、cookie、token、裸 `/api`、裸 Tauri/Electron IPC 或完整 Surface 对象。
- **R6 标准通道**：只依赖标准 `MessageChannel/MessagePort` 或平台原生消息机制；不实现通用方法调用框架。
- **R7 多实例**：模块默认可多开；`singleton: true` 才复用已有实例。每个实例具有独立 channel 和生命周期。
- **R8 交互可组合**：无 Tab、静态 Tab、Split/Dock 都是可选受控 React 组件，不进入线协议。
- **R9 有界资源**：消息大小、并发请求、订阅数、实例数和附件大小均有硬上限。
- **R10 可恢复失败**：单个 Guest 超时、崩溃、失联或越权不能拖垮其他实例、PanelHost 或对话区。
- **R11 可审计**：所有跨边界输入必须结构校验，授权决策和拒绝必须有稳定错误码和无敏感内容的结构化日志。
- **R12 向后兼容**：未使用新 PanelHost 的普通 WebExt 和 `panelRight` React contribution 行为不变。
- **R13 上层托管**：Desktop 原生 WebView 的创建、消息中继、窗口坐标、层级、焦点和销毁由上层应用 View Host 负责；PanelHost 只消费注入端口。

## 3. 分层架构

```text
上层应用 View Host（Desktop 才需要）
└─ ViewHostPort：创建/中继/几何/焦点/销毁原生 WebView
                 │ 注入容器句柄，不理解业务能力
                 ▼
pi-web PiChat.panelRight / SlotHost
└─ Agent WebExt（可信组合根）
   └─ PanelHost：Tab / Pane / Splitter + 能力代理
      ├─ Browser → ModuleSlot → 独立 iframe
      └─ Desktop → ModuleSlot → ViewHostPort → 独立原生 WebView
```

### 3.1 pi-web 层

pi-web 提供：

- `SlotHost`、`ExtErrorBoundary` 和 WebExt 验签/信任门控。
- `panelWidth/onPanelWidthChange/minPanelWidth/maxPanelWidth` 全受控宽度。
- `WebExtSurfaceAccess`、`ConversationAccess`、`SlotUploadFn` 和 Agent Routes HTTP 入口。

PanelHost 只消费 SlotHost 注入的窄能力，并把它们适配为自己的输入：

```ts
interface PanelSessionContext {
  readonly id?: string;
  readonly title?: string;
}

interface PanelHostInput {
  readonly extId: string;
  readonly session?: PanelSessionContext;
  readonly surface?: WebExtSurfaceAccess;
  readonly conversation?: ConversationAccess;
  readonly upload?: SlotUploadFn;
  readonly baseUrl?: string;
  readonly syncSignal?: unknown;
}
```

`title` 来自宿主会话的 ambient/session 元数据。会话标题不通过 Agent Route 获取，也不进入 Route handler 上下文。在 pi-web 公开 Slot props 类型扩展前，Agent 侧以本地 `PanelHostInput` 收口实际注入形状，不要求并行阶段修改 pi-web。

pi-web 不新增 `TabRegistry`、全局 Dock、SharedWorker、第二套 Surface、模块业务 store 或原生 WebView 实现。

### 3.2 Agent WebExt 层

Agent 的 `.pi/web/web.config.tsx` 是唯一组合根，负责：

- 把 `AigcPanelHost` 挂到 `panelRight`。
- 声明模块清单、能力请求、实例上限和默认打开项。
- 选择无 Tab、Tab 或 Split/Dock 交互组件。
- 把 SlotHost 注入的能力收窄后交给每个 Guest。
- 显示加载、拒绝、失联、崩溃、重启和关闭状态。

Agent 的 `index.ts` 继续声明 Agent Routes 与 Surface。pi-web 不认识 `canvas`、`materials`、`gallery`、`search` 等领域词。

### 3.3 Guest Module 层

每个模块是可独立构建和加载的页面。模块只依赖 Guest SDK：

```tsx
export default withPanelModule(ModuleApp);
```

HOC 只负责开发体验：握手、Runtime Provider、加载态和错误态。**HOC 不是安全边界，也不能作为授权依据**；恶意模块可以绕过 HOC，真正的校验必须全部在 PanelHost/原生 adapter 一侧执行。

### 3.4 上层应用 View Host

Desktop 主页面和模块 WebView 是兄弟渲染上下文。模块不能从 PanelHost 的 DOM 直接创建原生视图，也不能直接取得 `WebExtSurfaceAccess`。上层应用必须提供一个领域中立的 `ViewHostPort`：

```ts
interface ViewHostPort {
  open(request: NativeViewOpenRequest): Promise<NativeViewHandle>;
}

interface NativeViewOpenRequest {
  readonly instanceId: string;
  readonly entry: string;
  readonly title: string;
}

interface NativeViewHandle {
  readonly transport: ModuleTransport;
  updatePlacement(rect: LogicalRect): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  focus(): Promise<void>;
  close(): Promise<void>;
  onCrash(listener: (reason: ModuleCrash) => void): () => void;
}

interface ModuleTransport {
  send(message: WireMessage): void;
  subscribe(listener: (message: WireMessage) => void): () => void;
  close(): void;
}
```

`ViewHostPort` 只搬运 `WireMessage`，不解析 Route、Surface、Conversation 或附件语义。PanelHost 仍是能力授权与执行点。

这里定义的是 PanelHost 对上层地基的最小消费需求；接口名称和装配位置可由上层 workspace 契约替换，只要完整保留 `open/transport/placement/visibility/focus/close/crash` 语义。

`Workspace` 一词保留给 pi-web Host Contract v1 的 JSON 状态存储端口；本方案使用 `ViewHostPort` 表示 UI/原生视图宿主，避免把两种完全不同的职责混为一层。

## 4. 模块声明与授权

模块声明必须可序列化、可校验，不携带函数：

```ts
interface PanelModuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly singleton?: boolean; // 默认 false
  readonly entry: {
    readonly browser: string;
    readonly electron?: string;
    readonly tauri?: string;
  };
  readonly capabilities?: {
    readonly routes?: readonly {
      readonly name: string;
      readonly methods: readonly ("GET" | "POST")[];
    }[];
    readonly surfaces?: readonly {
      readonly domain: string;
      readonly actions?: readonly string[];
      readonly readState?: boolean;
      readonly subscribe?: boolean;
    }[];
    readonly conversation?: { readonly submit: boolean };
    readonly attachments?: {
      readonly read?: boolean;
      readonly upload?: boolean;
      readonly mimeTypes?: readonly string[];
      readonly maxBytes?: number;
    };
  };
}
```

规则：

1. `entry` 默认只能是相对当前已验签 WebExt `baseUrl` 的静态产物路径；拒绝路径穿越、`javascript:`、`data:`、`file:` 和任意绝对 URL。
2. 外部 HTTPS 模块属于显式高级策略，须由宿主部署策略二次允许，不能仅靠 Agent 自己声明；最好使用独立、无 cookie 的模块域名和完整 CSP。
3. 实际授予能力是“Agent 声明 ∩ 宿主策略 ∩ 当前平台能力”，缺失即拒绝。
4. 不向 Guest 发送 `baseUrl`、认证头、cookie、数据库凭据、完整路由列表或完整 Surface 对象。
5. Route 必须同时匹配 `name + method`；Surface 必须匹配 `domain + action`。字符串前缀匹配无效。
6. 会话标题、主题、可见性属于只读上下文，不是 Agent Route 能力。

## 5. ModuleChannel

### 5.1 定位

ModuleChannel 是 Panel 模块边界的固定协议适配器，不是通用 RPC 库。

浏览器由 PanelHost 使用原生 `MessageChannel/MessagePort` 建立通道。Desktop 由上层 `ViewHostPort` 建立并返回 `ModuleTransport`：Electron 可在主进程用 `MessagePortMain` 中继，Tauri 可在 Rust 层按 Webview label 中继。PanelHost 不直接调用 Electron/Tauri 创建视图 API。

### 5.2 握手

浏览器流程：

1. Host 创建 iframe 和一次性 `loadEpoch`，监听 `load`。
2. Guest 仅发送 `{ kind: "module.ready", protocol: [1, 1] }`，不携带秘密。
3. Host 验证 `event.source === iframe.contentWindow`、当前 `loadEpoch`、模块实例仍处于 `booting`。
4. Host 创建 `MessageChannel`，把一个 port 转交给该 `contentWindow`。
5. 后续所有上下文和能力授予只通过私有 port 发送；window 级 `message` 监听立即撤销。
6. iframe 再次触发 `load`、port `messageerror/close` 或 adapter 报崩溃时，旧 channel 立即失效，不能自动继承授权。

由于 `sandbox="allow-scripts"` 会产生 opaque origin，初始化转交 port 时无法使用具体 `targetOrigin`，只能使用 `*`。这是明确例外：安全性由精确 `event.source`、一次性 load epoch、无秘密 ready 帧、受控 entry 和转交后关闭 window 消息通道共同保证。

### 5.3 固定线协议

```ts
type ModuleRequest =
  | { op: "route.invoke"; route: string; method: "GET" | "POST"; query?: unknown; body?: unknown }
  | { op: "surface.execute"; payload: SurfaceCommandPayload }
  | { op: "conversation.submit"; text: string; attachmentIds?: readonly string[] }
  | { op: "attachment.read"; attachmentId: string }
  | { op: "attachment.upload"; name: string; mimeType: string; size: number }
  | { op: "instance.setTitle"; title: string }
  | { op: "instance.close" };

type ModuleEvent =
  | { op: "host.init"; context: Readonly<ModuleContext>; grant: Readonly<CapabilityGrant> }
  | { op: "host.visibility"; visible: boolean }
  | { op: "surface.snapshot"; key: SurfaceKey; sequence: number; value: unknown }
  | { op: "host.closing"; reason: string };
```

统一 envelope 使用判别联合：

```ts
type WireMessage =
  | { v: 1; kind: "request"; id: string; request: ModuleRequest }
  | { v: 1; kind: "response"; id: string; ok: true; value?: unknown }
  | { v: 1; kind: "response"; id: string; ok: false; error: ModuleError }
  | { v: 1; kind: "event"; event: ModuleEvent }
  | { v: 1; kind: "cancel"; id: string };
```

禁止 `call(method: string, args: any)`、函数序列化、`eval`、任意 IPC channel 名、Guest 自报身份或从消息中取得宿主对象引用。

### 5.4 状态机与有界行为

```text
created → loading → booting → active ↔ hidden → closing → closed
                         └──────────────→ crashed / quarantined
```

- 每条消息在执行前做运行时 schema 校验；TypeScript 类型不能替代边界校验。
- 默认控制消息上限 1 MiB、并发请求 32、Surface domain 16、请求超时 15 秒；Agent 只能向下收紧，不能突破宿主硬上限。
- 非法消息累计达到阈值后关闭该实例并标记 `quarantined`。
- 支持 `cancel` 和 `AbortSignal`；关闭实例时取消全部 pending、订阅和附件传输。
- Host 不自动重试 POST、Surface action 或 conversation submit；避免重复副作用。
- Surface 快照事件带 PanelHost 为每个 domain 分配的单调 `sequence`，Guest 丢弃倒序更新。该值只表示 Guest bridge 的投递顺序，不冒充 agent `control:"state"` 的权威 `rev`。
- 错误只返回稳定码，如 `NOT_GRANTED`、`INVALID_REQUEST`、`TIMEOUT`、`TOO_LARGE`、`UNAVAILABLE`、`CLOSED`；内部堆栈不跨边界。

## 6. 能力接入

### 6.1 Agent Routes

`route.invoke` 由 PanelHost 代理至既有：

```text
GET|POST /api/sessions/:sessionId/agent-routes/:name
```

Host 在发请求前再次校验 route、method、输入大小和当前 session；Guest 不获得 URL 和凭据。Agent Route handler 自己继续负责业务输入 schema 和领域权限，PanelHost 白名单只是第一道能力门。

### 6.2 Surface

Guest bridge 直接投影 pi-web 已有 Surface 契约，不再定义第二套 Surface 语义：

```text
Guest surface.execute {domain, action, args}
  → SurfaceCommandPayloadSchema 校验
  → capability grant 校验 domain + action
  → WebExtSurfaceAccess.run(domain, action, args)
  → SurfaceCommandResultSchema 校验
  → Guest response

agent control:"state" / key="surface:<domain>"
  → WebExtSurfaceAccess.getState + subscribe
  → PanelHost surface.snapshot {key, sequence, value}
  → Guest 本地只读镜像
```

协议规则：

1. 命令载荷直接使用 `@blksails/pi-web-protocol` 的 `SurfaceCommandPayload{domain,action,args}`，回包直接使用 `SurfaceCommandResult{domain,action,ok,data?,error?}`。
2. 状态 key 只通过 `surfaceStateKey(domain)` 生成。PanelHost 为每个已授权 domain 在初始化时读取一次快照并建立一个宿主订阅；Guest 不发送 `get/subscribe/unsubscribe` 请求。
3. 可用性通过 `surface.hasCommand(surfaceStateKey(domain))` 探测，并写入实例 grant。不可用时 Guest Runtime 返回只读降级态。
4. 快照是全量、小而热、只读的投影；Guest 不回写 `surface:*`。大而冷的数据由 Agent Routes 拉取，二进制只传 `att_` 引用和签名 URL。
5. `sequence` 由 PanelHost 在当前实例通道内生成，用于中继排序。若 pi-web 后续向 `WebExtSurfaceAccess` 暴露权威 `rev`，可增量加入可选 `sourceRevision`，不改变上述命令与快照语义。
6. 同一 Surface domain 在一个会话内只有一个 agent 权威。多个模块实例可以分别订阅它，但只拥有各自隔离的 UI 瞬时状态。
7. Guest 不取得裸 `WebExtStateAccess`、`WebExtSurfaceAccess` 或 ui-rpc bus。

### 6.3 Conversation

仅在显式授权后开放 `conversation.submit`，映射到 `ConversationAccess.submitUserMessage`。Host 限制文本长度、附件数量和 attachmentId 格式；模块不能伪造系统消息或直接调用模型 transport。

### 6.4 附件

附件 ID 和元数据走控制通道；二进制不编码为 base64，也不混入普通 JSON envelope。

- 读取：优先使用附件后端提供的短时、单次、作用域 URL；不支持作用域 URL 时，Host 通过附件 API 读取后，以有大小上限的 transferable `ArrayBuffer` 数据面交付。
- 上传：只有声明 `attachments.upload` 才可用。Host 校验 MIME、文件名和字节数，再调用 `SlotUploadFn`；Guest 不获得上传 URL 或 session API 基址。
- 附件授权仅绑定当前 `sessionId + instanceId`，实例关闭即失效。

## 7. 容器与上层桥接契约

```ts
interface ModuleContainerAdapter {
  readonly kind: "iframe" | "native";
  mount(input: MountInput): Promise<MountedModule>;
}

interface MountedModule {
  setBounds(rect: Readonly<{ x: number; y: number; width: number; height: number }>): Promise<void> | void;
  setVisible(visible: boolean): Promise<void> | void;
  focus(): Promise<void> | void;
  suspend?(): Promise<void>;
  resume?(): Promise<void>;
  dispose(): Promise<void>;
  onCrash(listener: (reason: ModuleCrash) => void): () => void;
}
```

`iframe` adapter 由 Agent PanelHost 提供；`native` adapter 只把注入的 `ViewHostPort` 适配为同一 `MountedModule`。adapter 不能理解业务 route/surface。

### 7.1 浏览器 iframe

默认属性：

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="…"></iframe>
```

- 禁止 `allow-same-origin`、forms、popups、top-navigation、downloads 和不需要的 Permissions Policy。
- 模块静态产物使用严格 CSP，建议 `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'none'`，再按模块最小放开。
- 不把潜在敌意模块和宿主放在同一带认证 cookie 的静态域；生产环境优先独立无 cookie 模块域。
- 入口导航后若再跳转，Host 使旧授权失效；模块若确需外链，由 Host 在系统浏览器中按 URL allowlist 打开。

### 7.2 Desktop 桥建立流程

```text
PanelHost（主 WebView）
  │ ViewHostPort.open(instanceId, entry, title)
  ▼
上层应用 / workspace 地基
  ├─ 创建独立原生 WebView
  ├─ 建立 instanceId 绑定的双向消息中继
  ├─ 返回 NativeViewHandle + ModuleTransport
  └─ 负责窗口坐标、DPI、层级、焦点、崩溃和销毁
  │
  ▼
Guest WebView
```

建立顺序：

1. PanelHost 创建 `instanceId`，只向 `ViewHostPort.open` 发送入口和展示元数据，不发送业务能力对象。
2. 上层应用校验入口，创建原生 WebView，并建立“主 WebView ↔ 上层应用 ↔ Guest WebView”的实例专属 relay。
3. 上层应用返回 `ModuleTransport`；Guest 经 relay 发送 `module.ready`。
4. PanelHost 完成协议版本、实例状态和能力 grant 校验，再通过 transport 发送 `host.init`。
5. Guest 的 Route/Surface/Conversation/附件请求经 relay 回到 PanelHost，由 PanelHost 调用 SlotHost 注入能力；上层应用只转发 envelope。
6. 任一 WebView 导航、崩溃或关闭时，上层应用关闭 relay；PanelHost 撤销 grant、订阅和 pending 请求。

### 7.3 Electron View Host 实现要求

主实现使用 `WebContentsView`，不以 `<webview>` tag 为标准实现。Electron 官方明确建议考虑 iframe 或 `WebContentsView` 替代 `<webview>`。

每实例必须：

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。
- 使用非持久、实例隔离的 session partition；默认拒绝 permission request。
- 禁止未授权导航、重定向、`window.open`、下载、外部协议和拖放导航。
- 不向 Guest 暴露通用 `ipcRenderer.send`；只转交实例专属 MessagePort。
- 监听 renderer gone/unresponsive，单实例崩溃只显示该 Tab 的恢复页。

如需提供 Electron `<webview>` 兼容入口，应由上层 View Host 实现独立的可选 adapter，执行同一契约测试及 `will-attach-webview` 安全校验；默认实现仍为 `WebContentsView`。

### 7.4 Tauri v2 View Host 实现要求

- 每实例使用唯一 label 的独立 `Webview`，上层 View Host 负责 `setPosition/setSize/show/hide/setFocus/close`。
- Guest label 只加入专门的最小 capability；不得继承主窗口能力。不要让多个 capability 无意合并权限。
- 默认不授予文件系统、shell、HTTP、剪贴板或任意 invoke 权限；若未来需要，仍须同时经过 Panel capability grant 与 Tauri scope。
- 使用严格 CSP；远端入口须显式配置 remote URL 权限并受宿主 allowlist 约束。
- 监听创建失败、事件断开和关闭，保证 Rust 侧监听器与前端实例同时释放。

### 7.5 几何、焦点与层级

Electron/Tauri 原生视图不在 DOM 布局树内，职责按两侧分开：

- PanelHost 用 `ResizeObserver` + `requestAnimationFrame` 产出 Pane 的逻辑矩形和可见性，不计算窗口屏幕坐标或物理像素。
- 上层 View Host 把逻辑矩形映射到窗口坐标，处理 DPI、窗口移动、层级和原生视图 show/hide。
- PanelHost 决定 Tab/Pane 的激活顺序；View Host 保证先隐藏旧视图，再显示并聚焦新视图。
- 宿主弹窗与原生视图相交时，由 View Host 执行遮挡策略；PanelHost 仅发送 overlay visibility 提示。
- PanelHost 关闭 Tab 后恢复 React chrome 焦点；View Host 幂等销毁原生资源。

## 8. 交互组件：与协议彻底解耦

核心必需组件只有 `<ModuleSlot>`；其余均为可选、受控的 React 组件：

```tsx
<TabGroup instances={instances} activeId={activeId} onActiveChange={setActiveId} />
<Split sizes={sizes} onSizesChange={setSizes}>
  <Pane><ModuleSlot instance={left} /></Pane>
  <Splitter />
  <Pane><ModuleSlot instance={right} /></Pane>
</Split>
```

- 参考 `rg-split` 的纯 primitive 思路：调用方持有 sizes、拖拽和持久化状态。
- panelRight 外层宽度始终由 PiChat 受控模式管理；模块和内部 Split 不能反向修改 PiChat 宽度。
- Dock 只允许发生在 panelRight 内，不支持跨 Slot 或接管整页。
- Host chrome 实现 `tablist/tab/tabpanel` 语义、方向键/Home/End/Delete、可见焦点和可读名称。
- 模块内对话框属于该 Guest 自己；需要宿主级确认时只开放固定 `host.confirm` 能力，首版不提供任意 HTML/modal 注入。

## 9. 实例与资源策略

- 默认 `singleton: false`；每次打开生成加密随机 `instanceId`。
- 每个实例独享浏览上下文、channel、订阅集合和错误状态。
- 非活跃 Tab 默认保活但发送 `host.visibility(false)`；Guest 必须暂停动画、轮询和媒体。
- Agent 可配置较低上限；宿主硬上限建议浏览器 8、Electron/Tauri 6。达到上限后拒绝新开并提示关闭旧实例，不静默淘汰有状态页面。
- Host 对消息速率、CPU 异常、无响应和长期隐藏实例做观测；首版不承诺浏览器 iframe 的强制 suspend。
- 显式关闭必须按顺序：停止接收新请求 → 发 `host.closing` → 取消 pending/订阅 → 关闭 port → dispose adapter → 删除实例状态。
- 页面刷新、Agent 切换和 session 切换必须批量执行同一幂等清理流程。

## 10. 安全模型

### 10.1 信任区

| 区域 | 信任级别 | 可拥有能力 |
|---|---|---|
| PiChat / SlotHost | 高 | 会话、附件、Surface、Agent Routes 接线 |
| 已验签 Agent WebExt / PanelHost | 中高 | 只取得 SlotHost 显式注入能力 |
| Guest Module | 低 | 仅实例 grant 中列出的固定操作 |
| Agent Route / Surface handler | 服务端权威 | 仍须做领域输入和权限校验 |

WebExt 本身仍运行在宿主 React realm，因此 WebExt 的信任门控是前置条件。Guest 强隔离不能修复恶意 PanelHost；反过来，PanelHost 也不能假定 Guest 会遵守 SDK。

### 10.2 必须防御的风险

- XSS 后越权调用 Route/Surface/IPC。
- iframe 导航后继承旧 port 或能力。
- 消息伪造、畸形 payload、原型污染、超大消息和请求洪泛。
- 附件越会话读取、MIME 欺骗和内存耗尽。
- Electron Node/RCE 能力泄漏、Tauri command capability 过宽。
- 隐藏 Tab 持续消耗 CPU/网络、订阅泄漏、原生视图残留。
- 敏感 payload 被日志记录。

### 10.3 审计与日志

记录：`moduleId`、`instanceId`、platform、operation、duration、resultCode、bytes；不记录消息正文、Route body、Surface state、附件内容、token 或堆栈。实例 ID 只用于诊断，不作为授权凭据。

## 11. 包边界与演进

首个实现放在 `aigc-agent` 内，并保持可直接提取的目录边界：

```text
examples/aigc-agent/.pi/web/panel/
├─ core/       # 定义、状态机、schema、授权
├─ react/      # PanelHost、ModuleSlot、Tab/Split、HOC
├─ guest/      # Guest SDK
└─ adapters/   # iframe；native adapter 只放接口/接线
```

当第二个 Agent 复用并通过同一 conformance suite 后，按原接口上提为：

```text
@blksails/pi-web-panel-kit/core
@blksails/pi-web-panel-kit/react
@blksails/pi-web-panel-kit/guest
@blksails/pi-web-panel-kit/adapters/iframe
```

Electron/Tauri adapter 应放在各自桌面宿主包或可选入口中，不能让浏览器构建打包原生依赖。ModuleChannel 线协议暂不放入 `@blksails/pi-web-protocol`；它是 panel-kit 的私有版本化边界，待跨产品稳定后再考虑上提。

## 12. 验收门槛

### 12.1 自动化测试

1. **schema/授权**：非法 definition、路径穿越、越权 route/method/surface/action、超限消息全部稳定拒绝。
2. **状态机**：重复 ready、重载、cancel、timeout、close、messageerror、倒序 revision 和幂等 dispose。
3. **多实例**：同模块双开状态/channel 不串；singleton 只聚焦已有实例。
4. **恶意 Guest e2e**：尝试读父 DOM/cookie、任意 `/api`、伪造消息、导航、洪泛、超大 payload 均失败且不影响其他 Tab。
5. **能力 e2e**：Route 不进 LLM；Surface 可读/订阅/执行；Conversation 与附件只在授权后可用。
6. **adapter conformance**：iframe 与上层 View Host adapter 执行同一 mount/placement/visible/focus/crash/dispose 测试集。
7. **资源**：达到实例、请求、Surface domain、附件上限时行为可预测，无 listener/port/WebContents 泄漏。
8. **无障碍**：Tab 键盘导航、焦点恢复、标题、错误与重启按钮可读。
9. **回归**：普通 `panelRight`、无 WebExt Agent、比例模式和连续宽度模式行为不变。

### 12.2 发布闸门

- iframe adapter 与 aigc-agent 完整闭环可以独立交付；native adapter 仅在上层 View Host 端口可用后接线。
- Electron/Tauri View Host 任一未通过安全清单与 conformance suite，不得声称跨平台完成。
- 外部 URL 模块、宿主级 modal、Dock 持久化、后台运行均不是 v1 发布条件。

## 13. aigc-agent 落地顺序

1. 建立 agent-local `panel/core + react + guest + iframe adapter`。
2. 将 canvas、materials、search、sandbox 分别构建为独立 Guest entry。
3. 在 `AgentDefinition.routes` 声明全部业务 HTTP；画布权威状态由 Surface 管理；文件由附件系统管理。
4. 使用受控 Tab/Split 组合源项目 UI/UX；PanelHost 只管理 chrome、实例和能力代理。
5. 将模块运行状态迁入实例 Runtime，宿主层不保留业务全局副作用。
6. 完成浏览器安全测试和 e2e；Desktop 只保留 `ViewHostPort` 消费端与 fake adapter 测试。
7. 上层 workspace 地基提供 View Host 后，接入 Electron/Tauri 原生 adapter 并运行同一 conformance suite。
8. 第二个 Agent 通过复用验证后，将稳定实现提取为 workspace package。

## 14. 实现边界

- 不引入通用 RPC、全局 Tab 系统、跨 Slot Dock、SharedWorker 或 module federation。
- 不将业务模块内联到宿主 React 树。
- Guest 不访问父 DOM、cookie、裸 API 或通用原生 IPC。
- HOC、TypeScript 类型和前端白名单不能替代宿主授权及服务端权限校验。
- Tab、Split、Dock 只属于 Agent PanelHost，不进入 PiChat 或 ModuleChannel 协议。
- PanelHost 不直接创建原生 WebView，不向 desktop bridge 增加临时平台命令；原生视图只经上层 `ViewHostPort` 接入。

## 15. 技术依据

- [pi-web Surface 权威表面栈](https://github.com/blksails/pi-web/blob/main/docs/product/04-surface-stack.md)
- [pi-web Surface App Runtime 契约 v1](https://github.com/blksails/pi-web/blob/main/docs/surface-app-runtime-contract-v1.md)
- [pi-web 宿主契约 v1](https://github.com/blksails/pi-web/blob/main/docs/pi-web-host-contract-v1.md)
- [WHATWG HTML：iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)
- [WHATWG HTML：MessageChannel / MessagePort](https://html.spec.whatwg.org/multipage/web-messaging.html)
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron `<webview>` warning](https://www.electronjs.org/docs/latest/api/webview-tag)
- [Tauri v2 Permissions](https://v2.tauri.app/security/permissions/)
- [Tauri v2 Runtime Authority](https://v2.tauri.app/security/runtime-authority/)
- [Tauri v2 CSP](https://v2.tauri.app/security/csp/)
- [Tauri v2 Webview API](https://v2.tauri.app/reference/javascript/api/namespacewebview/)
