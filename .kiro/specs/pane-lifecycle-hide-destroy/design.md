# Design Document

<!-- record-kiro-spec:start -->
## Overview

**Purpose**: document 级 host-presence 单闸控制 content pane hide/destroy；overlay 与 content webview 启动预热；content-well metrics 节流；workspace intent 打开/激活 pane。

> As-built retrospective record; proposed design is out of scope.

## Boundary Commitments

### This Record Covers

- installDocumentPanesHostPresence 单闸（hide_all / cleanup / restore）
- 路由无 host 时 sweep destroy（设置页等）
- overlay shell warm + configure 热路径
- content pane warm pool（pane-warm-N claim/release）
- content-well metrics ensure 与拖拽单 rAF
- openOrActivatePaneFromHost workspace intent
- CanvasLauncher 可选 workspacePaneId

### Out of Boundary

- 跨路由后台保活 ChatApp 不卸载
- iframe 会话状态磁盘持久化细节
- aigc-agent 专用 launcherRail 接线（见 example 仓）

## Implemented Components

### installDocumentPanesHostPresence

应用根一次安装：观察 [data-panes-host] 增删与可见性；missing→hide+destroy；hidden→hide；visible→restore

**Evidence:** packages/panes-kit/src/host-presence.ts; src/providers.tsx

### createGlobalTauriPaneOverlay.warm

启动预建隐藏 pane-overlay-menu；首开 configure+show，免冷创建

**Evidence:** packages/panes-kit/src/adapters/tauri-runtime.ts; public/pane-overlay.html

### contentWarmPool

预建 pane-warm-N 空壳；mount claim 标签 navigate 复用；dispose release 还池

**Evidence:** packages/panes-kit/src/adapters/tauri-runtime.ts; packages/panes-kit/src/adapters/tauri.ts; public/pane-warm.html

### ensureTauriContentWellMetrics

show 前 settle 槽位；拖拽路径 settle:false 单 rAF publish

**Evidence:** packages/panes-kit/src/adapters/tauri-runtime.ts; packages/panes-kit/src/react/panes-host.tsx

### openOrActivatePaneFromHost

派发 pi-panes-workspace-intent / panel-open，供侧栏入口打开或激活 pane

**Evidence:** packages/panes-kit/src/workspace-intent.ts; packages/canvas-ui/src/canvas-launcher.tsx

### pane_webview_hide_all

隐藏全部 content pane 进 host-fullscreen，不 close、不碰 overlay

**Evidence:** desktop/src-tauri/src/pane_relay.rs

## Verification

- `cd packages/panes-kit && npx vitest run test/panes-host.test.tsx` — exit code `0`
<!-- record-kiro-spec:end -->
