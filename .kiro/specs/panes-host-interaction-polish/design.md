# Design Document

<!-- record-kiro-spec:start -->
## Overview

**Purpose**: workspace tab 按最近打开(MRU)前置排序且恢复保序；新开 Pane 菜单显示真实计数、更多 Pane 菜单活跃项带选中态；native overlay 弹窗创建竞态修复与 tab 切换 show-first 防闪；切源/新建先隐藏再销毁 pane webview；扩展声明 hostView:"logs" 时日志 tab 恒渲染。

> As-built retrospective record; proposed design is out of scope.

## Boundary Commitments

### This Record Covers

- workspace reducer MRU（open/activate 前置 + 持久化恢复保序）
- 新开 Pane 菜单 meta 计数（native overlay + DOM palette）
- 更多 Pane 菜单活跃 tab 选中态（overlay selected + DOM）
- native overlay 弹窗创建竞态修复（ensureShellCreated/ensureWarm 拆分）
- tab 切换 show-first 与 carrier display 门控（nativeShownKeys）
- 切源/新建/恢复会话先 hide_all 再销毁 pane webview
- logs hostView tab 恒渲染 LogsPanel
- dev-desktop waitForBase 超时诊断与 SKIP_CLOUD

### Out of Boundary

- host-presence 单闸与 WebView warm pool（见 pane-lifecycle-hide-destroy）
- Rust 侧 pane_relay 新增命令
- aigc-agent 业务 pane（见 example 仓）
- iframe 会话状态磁盘持久化细节

## Implemented Components

### instances.reducePaneWorkspace

open/activate 把实例置为序列最前（MRU），其余保持相对顺序；close 激活剩余最近使用

**Evidence:** packages/panes-kit/src/instances.ts

### panes-host.restoredPaneWorkspace

按持久化顺序直接构造实例（而非逐个 open），仅 activate 活跃实例前置，避免恢复顺序翻转

**Evidence:** packages/panes-kit/src/react/panes-host.tsx

### panes-host.openPaletteMenu

新开 Pane 菜单 meta 统一显示计数，移除后台保活文案

**Evidence:** packages/panes-kit/src/react/panes-host.tsx

### panes-host.openHiddenTabsMenu

更多 Pane 菜单活跃项带 selected/aria-current（native overlay 与 DOM 两路）

**Evidence:** packages/panes-kit/src/react/panes-host.tsx; public/pane-overlay.html

### tauri-runtime.ensureShellCreated/ensureWarm

弹窗打开先等壳创建完成（BIND+CREATE）再导航，与预热并发 create 解耦，修复弹窗打不开

**Evidence:** packages/panes-kit/src/adapters/tauri-runtime.ts

### panes-host.nativeShownKeys

tab 切换 show-first（先 await 活跃 show 再 hide 其余），carrier 以 display 门控未就绪帧

**Evidence:** packages/panes-kit/src/react/panes-host.tsx

### chat-app.hideThenDestroyPaneWebviews

新建/切源/恢复会话先发 pane_webview_hide_all 再销毁，遮蔽 remount 骨架屏期间的旧内容残帧

**Evidence:** components/chat-app.tsx

### pi-chat.logsActive

扩展声明 hostView:"logs" 时恒渲染 LogsPanel 并接实时/历史日志链路

**Evidence:** packages/ui/src/chat/pi-chat.tsx

### dev-desktop.waitForBase

超时报告各探测 URL 状态；支持 PI_WEB_DEV_SKIP_CLOUD 与外部 cloud 门闩

**Evidence:** scripts/dev-desktop.mjs

## Verification

- `cd packages/panes-kit && npx tsc -p tsconfig.json --noEmit` — exit code `0`
- `cd packages/panes-kit && npx vitest run` — exit code `0`
- `cd C:/workcode/pi-web && npx tsc -p tsconfig.json --noEmit` — exit code `0`
<!-- record-kiro-spec:end -->
