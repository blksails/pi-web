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

完整设计与实施顺序见 [`docs/isolated-panes`](../../docs/isolated-panes/README.md)。
