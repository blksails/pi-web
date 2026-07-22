# Isolated Panes 完整实施方案

## 1. 公开契约

公开入口：

```ts
import {
  definePanes,
  definePaneDefinition,
  connectPaneGuest,
} from "@blksails/pi-web-panes-kit";
import {
  PanesHost,
  PaneGuestProvider,
  usePaneGuest,
  withPaneGuest,
} from "@blksails/pi-web-panes-kit/react";
```

核心定义：

```ts
interface PanesDefinition {
  id: string;
  panes: PaneDefinition[];
  initialPaneIds?: string[];
  maxOpenPanes: number;
}

interface PaneDefinition {
  id: string;
  title: string;
  icon?: string;
  document:
    | { kind: "inline"; srcDoc: string }
    | { kind: "html"; src: string };
  capabilities: PaneCapabilities;
  allowMultiple: boolean;
  maxInstances: number;
  lifecycle: {
    keepAlive: boolean;
    suspendWhenHidden: boolean;
  };
}

interface PaneInstance {
  instanceId: string;
  paneId: string;
  epoch: number;
  state: "creating" | "connecting" | "ready" | "hidden" | "failed" | "disposed";
}
```

`definePanes` 负责 schema、唯一 ID、初始 Pane 和多开约束验证。默认 `allowMultiple=false`、`maxInstances=1`、`maxOpenPanes=16`。

## 2. 实例模型

`createPaneWorkspace/reducePaneWorkspace` 是无框架纯状态机：

- `open`：若允许多开，创建新 `instanceId`；否则激活既有实例。
- `activate`：只改变可见实例，兄弟实例保持独立运行。
- `move`：只重排实例，不改变授权或 Realm。
- `reload`：`epoch++`，旧端口关闭，新 View 重新握手。
- `close`：发送 `closing`、撤销订阅和端口，再选中相邻实例。

Tab 的 key 必须是 `instanceId:epoch`，禁止用 `paneId` 作为运行实例 key。

## 3. 消息协议

Guest 请求只有五种：

```ts
type PaneGuestRequest =
  | { type: "pane:request"; requestId: string; operation: "route.query"; route: string; query?: Record<string, string> }
  | { type: "pane:request"; requestId: string; operation: "route.mutate"; route: string; body: unknown }
  | { type: "pane:request"; requestId: string; operation: "surface.run"; domain: string; action: string; args?: unknown }
  | { type: "pane:request"; requestId: string; operation: "attachment.put"; name: string; mimeType: string; bytes: ArrayBuffer }
  | { type: "pane:request"; requestId: string; operation: "conversation.submit"; text: string; attachmentIds?: string[] };
```

Host 下行只有 `pane:connected`、`pane:result`、`pane:surface`、`pane:lifecycle`。协议不暴露 fetch、文件系统、shell、React context 或 pi-web 内部 client。

错误码：`INVALID_MESSAGE`、`STALE_INSTANCE`、`CAPABILITY_DENIED`、`PAYLOAD_TOO_LARGE`、`REVISION_CONFLICT`、`ROUTE_FAILED`、`ATTACHMENT_FAILED`、`HOST_UNAVAILABLE`、`REQUEST_TIMEOUT`。

## 4. 授权

```ts
interface PaneCapabilities {
  routes: Array<{
    name: string;
    methods: Array<"GET" | "POST">;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
  }>;
  surfaceKeys: string[];
  surfaceCommands: Array<{ domain: string; actions: string[] }>;
  attachments: "none" | "read" | "read-write";
  conversation: "none" | "submit";
}
```

Host 只使用已装载 `PaneDefinition` 的 grant。Guest 自报的 paneId、route、method、domain、action 或 attachmentId 不产生权限。Agent Route handler 必须再次做领域校验，形成两层边界。

默认限制：普通请求 256 KiB、响应 2 MiB、附件 8 MiB；定义可在安全上限内收窄或放宽 route 限额。

## 5. Browser Host

1. iframe 使用 `sandbox="allow-scripts"`，不启用 same-origin、表单、弹窗、下载和顶层导航。
2. Guest 注册首次 window message 监听，并发送 `pane:ready`。
3. Host 以 iframe `load` 和 `pane:ready` 双触发建立一次性 `MessageChannel`；相同 epoch 幂等。
4. Guest 只接受 `event.source === parent`、协议版本匹配且 paneId 匹配的连接。
5. 后续业务只走专属 port，不走 window message。
6. reload、close、导航或销毁时关闭旧 port；旧 epoch 请求返回 `STALE_INSTANCE` 或自然失联。

opaque-origin iframe 无法依赖精确 origin，故边界由 `event.source`、sandbox、一次性 port、schema 和 grant 共同构成。

## 6. Electron 与 Tauri

核心只定义：

```ts
interface PanePort {
  post(message: PaneHostMessage, transfer?: readonly Transferable[]): void;
  listen(listener: (message: unknown) => void): () => void;
  close(): void;
}

interface PaneViewAdapter<TMount> {
  mount(target: TMount): Promise<PaneViewHandle> | PaneViewHandle;
}
```

Electron adapter 使用独立 `WebContentsView`、`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`；preload 只暴露 PanePort relay。Tauri adapter 使用独立 WebView，Rust command/event 只转同一 envelope。两者按 `instanceId+epoch` 绑定 relay，并拒绝任意导航、新窗口、权限请求、shell 和未声明协议。

## 7. Agent Routes adapter

标准地址：

```text
GET  {baseUrl}/sessions/{sessionId}/agent-routes/{route}
POST {baseUrl}/sessions/{sessionId}/agent-routes/{route}
```

adapter 必须：

- 编码 sessionId/route/query；限制 request/response 体积；只接收 JSON。
- 保留成功 body，不假定具体领域 envelope。
- 将 `SESSION_NOT_FOUND` 映射为 `HOST_UNAVAILABLE` 和“当前会话已失效，请重新打开 Agent 会话”。
- 对会话创建后、runner 声明帧到达前的 `ROUTE_NOT_FOUND` 做有界指数退避；只重试该 readiness 错误，不重放失效会话或任意 4xx。
- 将 409/`REVISION_CONFLICT` 映射为可处理冲突。
- 其余失败映射 `ROUTE_FAILED`，保留 status/retryable。

Host 不能自动把 mutation 重放到另一个会话；会话失效必须显式提示，避免跨会话误写。

## 8. Surface、附件与 Conversation

Host 只订阅 grant 中的 `surfaceKeys`，把最新值推到对应实例。Guest 的 Surface proxy 维护本地镜像并实现 `getState/subscribe/hasCommand/run`；`run` 仍需逐 action 授权。

附件上传由 Host 把 `ArrayBuffer` 还原为 File 后调用 pi-web 注入的 upload；Guest 只得到 `attachmentId/displayUrl`。Conversation 只有显式用户动作可调用，不用于后台同步。

## 9. panelRight 连续宽度

WebExt 通用配置：

```ts
config: {
  panelWidth: 760,
  minPanelWidth: 420,
  maxPanelWidth: 1280,
}
```

ChatApp 以 `panelWidth` 初始化本地状态，传给 PiChat，并把 `onPanelWidthChange` 回写同一状态。存在 `panelWidth` 时启用 PiChat 已有连续拖拽分隔条并隐藏离散比例切换器；未声明时继续使用 `panelRatio`，保证普通 WebExt 零回归。

Pane/Panes 不感知 placement 宽度，也不自行监听宿主鼠标事件。

## 10. Canvas 复用

Canvas Pane 在自己的 iframe 中装载现有 `CanvasPanel`。Guest SDK 将 PanePort 适配为：

- `WebExtSurfaceAccess` → `surface:canvas` 与明确 action grants；
- `UploadFn` → `attachment.put`；
- `ConversationAccess` → `conversation.submit`。

Agent 同时装载现有 `canvasSurfaceExtension`、AIGC 与 vision extensions。Panes 地基不定义 Canvas schema、不复制 Canvas reducer、不绘制替代画布。

多个 Canvas Tab 是多个独立 UI/JS Realm；它们可观察同一 Agent 权威 `surface:canvas`。若业务需要每实例独立 Canvas 文档，应在 Canvas 领域增加 documentId，而不是让宿主复制领域状态。

## 11. 测试门

- Contract：schema、重复 ID、默认值、版本、非法 envelope。
- Instance：同类型多开、上限、activate/move/reload/close、epoch。
- Security：route/method/action 越权、体积、旧端口、跨实例结果。
- Route：成功、SESSION_NOT_FOUND、冲突、非 JSON、超大响应。
- Browser：三个同类型 iframe 同时存在且端口隔离。
- Canvas：构建产物包含 canonical Canvas UI，Surface/附件/Conversation 通过 Guest proxy。
- Layout：配置声明连续宽度后，PiChat 拖拽回调持续更新。
- Regression：无 Panes、无 panelWidth、普通 WebExt 行为不变。
- Desktop：同一 conformance fixture 在 iframe、Electron、Tauri adapter 通过。
