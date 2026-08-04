# Implementation Plan

<!-- record-kiro-spec:start -->
> Retrospective completion record; contains no work authorization.

- [x] 1. 统一 iframe 与 ChildWebView Pane 生命周期、弹层、缩放及主题
  - _Requirements: REQ-A13, REQ-PANE-201_
  - _Evidence: packages/panes-kit/src/react/panes-host.tsx; packages/panes-kit/src/adapters/tauri-runtime.ts; desktop/src-tauri/src/native_layout.rs_
- [x] 2. 接入独立 aigc-agent 工作区及素材、搜图、画布、日志 Pane
  - _Requirements: REQ-PANE-201, REQ-PANE-202_
  - _Evidence: lib/app/webext-registry.ts; scripts/build-webext-examples.ts; public/pane-logs.html_
- [x] 3. 实现素材带入对话草稿及网页、Tauri 标题投射
  - _Requirements: REQ-PANE-203_
  - _Evidence: packages/panes-kit/src/contract.ts; packages/panes-kit/src/guest.ts; packages/ui/src/chat/pi-chat.tsx_
- [x] 4. 补齐协议、宿主、PiChat、日志主题及工作区装载测试
  - _Requirements: REQ-A13, REQ-PANE-201, REQ-PANE-202, REQ-PANE-203_
  - _Evidence: packages/panes-kit/test/contract.test.ts; packages/ui/test/chat/host-panes-dispatch.test.tsx; test/logs-pane-document-theme.test.ts; test/webext-registry-aigc.test.ts_
<!-- record-kiro-spec:end -->
