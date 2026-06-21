# Research Log — session-usage-panel

**Discovery 类型**：Light（对既有富版 PiChat 的 UI 扩展集成）。

## 关键发现

1. **数据已全链路就绪**：`usePiControls` 暴露 `stats`（`SessionStats`），来自 REST `GET /sessions/:id/stats` 与 SSE control 的 `stats` 帧（`packages/react/src/hooks/use-pi-controls.ts`、`sse/control-store.ts`）。无需新建数据源。
2. **组件已存在**：`PiSessionStats`（`packages/ui/src/controls/pi-session-stats.tsx`）已渲染 messages/toolCalls/tokens/cost + 空态「No stats yet」，带 `data-pi-session-stats` 与 `data-pi-stat="..."`。仅 `PiChatBasic` 使用；富版 `PiChat` 未引用。
3. **富版无 `showControls`**：富版 `PiChat` 控件按 `controls !== undefined` 渲染（`pi-chat.tsx:189/304`）。→ 设计决策：新增内核自有 prop `showSessionStats?: boolean`（默认 `true`）作为显隐门控（满足需求 1.2）。
4. **webext slot 铁律**：`extension-slots.tsx`「共存追加，绝不替换内核表面」；`ExtSlotRegion` 仅在扩展声明该 slot 时渲染，否则 `return null`。webext `statusBar` 容器带 `data-pi-ext-status-bar`，渲染在主列**顶部**（`pi-chat.tsx:887`）。→ 决策：内核用量区**不经 `ExtSlotRegion`**，由内核直接渲染并放在主列**底部**（与顶部 webext statusBar 物理分离、并存不顶替）。
5. **panelRight 风险**：`panelRight` 与 Tier4 artifact 共用右侧 `w-96` aside（`pi-chat.tsx:915-948`），空 panelRight 有 384px 留白历史问题（见 memory `pi-web-split-empty-aside-blank`）。→ 决策：用量区不进 panelRight。

## 设计决策（synthesis）

- **Build-vs-adopt**：复用既有 `PiSessionStats`（adopt），不重写字段逻辑；仅在富版新增挂载点 + 开关 prop（build minimal）。
- **挂载点**：主列 `conversationBody` 之后、`artifactSurface` ExtSlotRegion 之前，作为 `conversationBody` 的兄弟块级元素；不进入底部输入 dock 内部（避免触碰 dock 的 `absolute bottom-0` 布局，呼应「不大改布局」）。
- **锚点属性**：外层包裹 `data-pi-session-stats-region` 作为内核区稳定锚点，便于 e2e 与 webext statusBar 区分。

## 风险与缓解

- 挂载位置与底部输入 dock 叠放：用量区作为 dock 的兄弟（其上方/下方流式块），不进入 dock，规避叠放。
- e2e 隔离：遵循 `NEXT_DIST_DIR=.next-e2e` + external server（见 memory `pi-web-e2e-isolated-build`），不污染 dev `.next`。
