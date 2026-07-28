# @blksails/pi-web-panes-kit

领域中立的强隔离 Pane 契约、Guest SDK 与 Browser React Host。

```tsx
import { definePanes } from "@blksails/pi-web-panes-kit";
import { PanesHost } from "@blksails/pi-web-panes-kit/react";

const definition = definePanes({
  id: "my-panes",
  initialPaneIds: ["editor"],
  panes: [{
    id: "editor",
    title: "Editor",
    document: { kind: "inline", srcDoc: editorHtml },
    allowMultiple: true,
    maxInstances: 3,
    capabilities: {
      routes: [{ name: "editor-data", methods: ["GET", "POST"] }],
    },
  }],
});

export function PanelRight(props: HostCapabilities) {
  return <PanesHost {...props} definition={definition} />;
}
```

每个打开的 Tab 是独立 iframe/View、端口和 epoch。同一 contract 可由 Electron `WebContentsView` 或 Tauri WebView adapter 实现。业务数据继续使用 pi-web 的 Agent Routes、Surface、Attachments 与 Conversation；本包不依赖 `frame-rpc`。

跨 Pane UI 协作经宿主事件中介，Pane 不互持引用：

```ts
// 发布方 capabilities.events.publish 与接收方 subscribe 均须逐 topic 声明。
await guest.events.publish("asset.open", { attachmentId });
const off = guest.events.subscribe("asset.open", (payload, source) => {});
```

宿主只向已打开、已连接且获精确 `subscribe` 授权的 Pane 投递；请求沿用 256 KiB 上限。`PanesHost` 可用 `config.eventTargets` 把 topic 映射到目标 `paneId`，仅负责激活已打开的 UI，不扩数据权限。负载宜只传 ID 与意图；勿传 DOM、组件或凭据。无订阅者返回 `{ delivered: 0 }`，便于独立 Pane 降级。

完整设计与实施顺序见 [`docs/isolated-panes`](../../docs/isolated-panes/README.md)。
