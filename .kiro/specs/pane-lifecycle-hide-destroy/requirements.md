# Requirements Document

<!-- record-kiro-spec:start -->
## Introduction

侧栏收起仅隐藏 native pane webview 并保持 PanesHost 挂载；设置/非侧栏路由隐藏；退出会话、换源、登出、切换会话则销毁。

## Boundary Context

- **In scope**: pane_webview_hide_all / cleanup 分流; desktop-bridge hide/destroy API; PiChat 收起侧栏仍挂载 PanesHost; chat-app / identity 生命周期调用点
- **Out of scope**: 跨路由后台保活 ChatApp 不卸载; iframe 会话状态磁盘持久化细节

## Requirements

### Requirement 1: Pane 生命周期与 Tauri WebView 载体

**Objective:** 作为桌面用户，我希望收起侧栏时 Pane 后台保活，离开会话时销毁，以便既快又安全。

#### Acceptance Criteria

1.1. WHEN 用户收起 panelRight 且会话未结束 THE SYSTEM SHALL 系统隐藏 pane webview 且保留实例
1.2. WHEN 用户进入设置等无侧栏路由且未退出会话 THE SYSTEM SHALL 系统隐藏 pane webview
1.3. WHEN 用户退出会话、换源、登出或切换其他会话 THE SYSTEM SHALL 系统销毁全部 pane webview

**Traceability:** `REQ-A13`; docs/REQUIREMENTS-SPEC.md#REQ-A13; desktop/src-tauri/src/pane_relay.rs; packages/ui/src/chat/pi-chat.tsx
<!-- record-kiro-spec:end -->
