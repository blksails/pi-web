# Implementation Plan

<!-- record-kiro-spec:start -->
> Retrospective completion record; contains no work authorization.

- [x] 1. MRU reducer 与恢复保序：open/activate 前置 + restoredPaneWorkspace 直接构造
  - _Requirements: REQ-101_
  - _Evidence: packages/panes-kit/src/instances.ts; packages/panes-kit/src/react/panes-host.tsx_
- [x] 2. 菜单 meta 与选中态：新开 Pane 计数、更多 Pane selected（overlay + DOM）
  - _Requirements: REQ-102, REQ-103_
  - _Evidence: packages/panes-kit/src/react/panes-host.tsx; public/pane-overlay.html_
- [x] 3. 弹窗竞态与切换闪烁：ensureShellCreated/ensureWarm 拆分、nativeShownKeys show-first
  - _Requirements: REQ-103, REQ-104_
  - _Evidence: packages/panes-kit/src/adapters/tauri-runtime.ts; packages/panes-kit/src/react/panes-host.tsx_
- [x] 4. 切源先隐藏再销毁 pane webview（chat-app 四处切源路径）
  - _Requirements: REQ-105_
  - _Evidence: components/chat-app.tsx_
- [x] 5. logs hostView tab 恒渲染 LogsPanel（logsActive）
  - _Requirements: REQ-106_
  - _Evidence: packages/ui/src/chat/pi-chat.tsx_
- [x] 6. dev-desktop waitForBase 诊断与 SKIP_CLOUD
  - _Requirements: REQ-101_
  - _Evidence: scripts/dev-desktop.mjs_
<!-- record-kiro-spec:end -->
