# Design Document

<!-- record-kiro-spec:start -->
## Overview

**Purpose**: 以 iframe 与 Tauri ChildWebView 统一承载 AIGC 工作区 Pane，补齐生命周期、日志、独立 agent 装载、草稿带入及标题投射。

> As-built retrospective record; proposed design is out of scope.

## Boundary Commitments

### This Record Covers

- Pane 仅以 iframe 或 Tauri ChildWebView 隔离文档承载
- Pane 弹层、缩放、主题、隐藏销毁与静态日志文档
- 独立 aigc-agent 工作区与素材、搜图、画布、日志 Pane 装载
- 素材带入对话草稿但不自动发送
- 扩展标题投射到 document.title 与 Tauri 窗口标题

### Out of Boundary

- React 同 realm Pane
- 生产数据库迁移与部署
- 本次按用户要求未执行的 E2E
- aigc-agent 仓内素材业务实现

## Implemented Components

### PanesHost / Tauri pane runtime

统一隔离 Pane 的装载、弹层、缩放、显示顺序及生命周期。

**Evidence:** packages/panes-kit/src/react/panes-host.tsx; packages/panes-kit/src/adapters/tauri-runtime.ts; desktop/src-tauri/src/native_layout.rs; desktop/src-tauri/src/window.rs

### Pane contract and Guest

声明 conversation.stage 协议，并在 Guest SDK 暴露草稿暂存能力。

**Evidence:** packages/panes-kit/src/contract.ts; packages/panes-kit/src/guest.ts; packages/web-kit/src/host-context.ts

### PiChat pane dispatcher

把 Pane 文字与附件写入对话输入框，不自动发送，并投射扩展标题。

**Evidence:** packages/ui/src/chat/pi-chat.tsx; packages/ui/test/chat/host-panes-dispatch.test.tsx; packages/ui/test/chat/pi-chat.integration.test.tsx

### Static logs and session documents

为 iframe 与 ChildWebView 提供独立日志、会话文档及宿主主题同步。

**Evidence:** packages/ui/src/logs/logs-pane-document.ts; public/pane-logs.html; public/pane-session-info.html; test/logs-pane-document-theme.test.ts

### AIGC workspace loader

从独立 workspace 包稳定装载 aigc-agent Web Extension，并在声明缺失时安全降级。

**Evidence:** lib/app/webext-registry.ts; pnpm-workspace.yaml; scripts/build-webext-examples.ts; test/webext-registry-aigc.test.ts

## Verification

- `pnpm --filter @blksails/pi-web-ui typecheck` — exit code `0`
- `pnpm --filter @blksails/pi-web-canvas-ui typecheck` — exit code `0`
- `pnpm --filter @blksails/pi-web-panes-kit typecheck` — exit code `0`
- `pnpm --filter @blksails/pi-web-ui exec vitest run test/chat/pi-chat.integration.test.tsx test/chat/host-panes-dispatch.test.tsx` — exit code `0`
- `pnpm --filter @blksails/pi-web-panes-kit exec vitest run test/contract.test.ts test/panes-host.test.tsx` — exit code `0`
- `pnpm exec vitest run test/logs-pane-document-theme.test.ts test/webext-registry-aigc.test.ts` — exit code `0`
- `pnpm build:client` — exit code `0`
<!-- record-kiro-spec:end -->
