# Requirements Document

<!-- record-kiro-spec:start -->
## Introduction

document 级 host-presence 单闸控制 content pane hide/destroy；overlay 与 content webview 启动预热；content-well metrics 节流；workspace intent 打开/激活 pane。

## Boundary Context

- **In scope**: installDocumentPanesHostPresence 单闸（hide_all / cleanup / restore）; 路由无 host 时 sweep destroy（设置页等）; overlay shell warm + configure 热路径; content pane warm pool（pane-warm-N claim/release）; content-well metrics ensure 与拖拽单 rAF; openOrActivatePaneFromHost workspace intent; CanvasLauncher 可选 workspacePaneId
- **Out of scope**: 跨路由后台保活 ChatApp 不卸载; iframe 会话状态磁盘持久化细节; aigc-agent 专用 launcherRail 接线（见 example 仓）

## Requirements

### Requirement 1: Pane 生命周期、公共加载与环境载体

**Objective:** 作为桌面用户，我希望侧栏收起时 Pane 后台保活、离开宿主时销毁、首开 WebView 尽量无冷启动延迟，以便既快又安全。

#### Acceptance Criteria

1.1. WHEN 用户收起 panelRight 且会话未结束 THE SYSTEM SHALL 系统隐藏 content pane webview 且保留实例与 PanesHost 挂载
1.2. WHEN 用户进入设置等导致 [data-panes-host] 从 document 消失 THE SYSTEM SHALL 系统经 document 级 presence 闸 destroy 全部 content pane webview
1.3. WHEN 用户退出会话、换源、登出或切换其他会话 THE SYSTEM SHALL 系统销毁全部 pane webview
1.4. WHEN 桌面宿主启动且 native child 可用 THE SYSTEM SHALL 系统预建隐藏 overlay shell 与至少一枚 content warm webview，首开走 navigate/configure 复用
1.5. WHEN 用户拖拽侧栏分隔或窗口 resize THE SYSTEM SHALL 系统以 content-well metrics 单路径更新槽位，避免多层 frame sync 与过度 settle

**Traceability:** `REQ-A13`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/panes-kit/src/host-presence.ts; packages/panes-kit/src/adapters/tauri-runtime.ts; desktop/src-tauri/src/pane_relay.rs

### Requirement 2: 侧栏形态采用 PanesHost

**Objective:** 作为 AIGC 用户，我希望画布等模块以 PanesHost tab 承载，以便统一工作区生命周期。

#### Acceptance Criteria

2.1. WHEN 宿主通过 workspace intent 请求 open-or-activate 某 paneId THE SYSTEM SHALL 系统打开或激活对应 tab 并关闭 palette/overlay
2.2. WHEN CanvasLauncher 传入 workspacePaneId THE SYSTEM SHALL 系统点击入口时 openOrActivatePaneFromHost 而非仅 panelRight 画廊

**Traceability:** `REQ-A2`; examples/aigc-agent/docs/REQUIREMENTS-SPEC.md#REQ-A2; packages/panes-kit/src/workspace-intent.ts; packages/canvas-ui/src/canvas-launcher.tsx
<!-- record-kiro-spec:end -->
