# Implementation Plan

<!-- record-kiro-spec:start -->
> Retrospective completion record; contains no work authorization.

- [x] 1. 实现 hide_all 与 bridge API，侧栏保持挂载
  - _Requirements: REQ-A13_
  - _Evidence: desktop/src-tauri/src/pane_relay.rs; packages/ui/src/chat/pi-chat.tsx_
- [x] 2. 会话结束/换源/登出调用 destroy
  - _Requirements: REQ-A13_
  - _Evidence: components/chat-app.tsx; components/auth/use-identity.tsx_
<!-- record-kiro-spec:end -->
