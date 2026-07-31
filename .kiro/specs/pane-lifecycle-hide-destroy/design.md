# Design Document

<!-- record-kiro-spec:start -->
## Overview

**Purpose**: 侧栏收起仅隐藏 native pane webview 并保持 PanesHost 挂载；设置/非侧栏路由隐藏；退出会话、换源、登出、切换会话则销毁。

> As-built retrospective record; proposed design is out of scope.

## Boundary Commitments

### This Record Covers

- pane_webview_hide_all / cleanup 分流
- desktop-bridge hide/destroy API
- PiChat 收起侧栏仍挂载 PanesHost
- chat-app / identity 生命周期调用点

### Out of Boundary

- 跨路由后台保活 ChatApp 不卸载
- iframe 会话状态磁盘持久化细节

## Implemented Components

### pane_webview_hide_all

隐藏全部 content pane 并进入 host-fullscreen，不 close

**Evidence:** desktop/src-tauri/src/pane_relay.rs

### desktop-bridge.hidePaneWebviews

渲染层调用 hide_all；destroyPaneWebviews 调用 cleanup

**Evidence:** lib/app/desktop-bridge.ts

### PiChat.keepPanesHostAlive

有 panes 时 aside 宽 0 仍挂载 PanesHost

**Evidence:** packages/ui/src/chat/pi-chat.tsx

## Verification

- `pnpm exec vitest run test/desktop-bridge.test.ts` — exit code `0`
- `cargo test --bin pi-web pane_relay` — exit code `0`
<!-- record-kiro-spec:end -->
