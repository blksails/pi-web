# Requirements Document

<!-- record-kiro-spec:start -->
## Introduction

workspace tab 按最近打开(MRU)前置排序且恢复保序；新开 Pane 菜单显示真实计数、更多 Pane 菜单活跃项带选中态；native overlay 弹窗创建竞态修复与 tab 切换 show-first 防闪；切源/新建先隐藏再销毁 pane webview；扩展声明 hostView:"logs" 时日志 tab 恒渲染。

## Boundary Context

- **In scope**: workspace reducer MRU（open/activate 前置 + 持久化恢复保序）; 新开 Pane 菜单 meta 计数（native overlay + DOM palette）; 更多 Pane 菜单活跃 tab 选中态（overlay selected + DOM）; native overlay 弹窗创建竞态修复（ensureShellCreated/ensureWarm 拆分）; tab 切换 show-first 与 carrier display 门控（nativeShownKeys）; 切源/新建/恢复会话先 hide_all 再销毁 pane webview; logs hostView tab 恒渲染 LogsPanel; dev-desktop waitForBase 超时诊断与 SKIP_CLOUD
- **Out of scope**: host-presence 单闸与 WebView warm pool（见 pane-lifecycle-hide-destroy）; Rust 侧 pane_relay 新增命令; aigc-agent 业务 pane（见 example 仓）; iframe 会话状态磁盘持久化细节

## Requirements

### Requirement 1: tab 按最近打开顺序排序

**Objective:** 作为桌面用户，我希望 pane tab 顺序按最近打开排列，以便快速回到刚用过的面板。

#### Acceptance Criteria

1.1. WHEN 用户打开或切换某 pane tab THE SYSTEM SHALL 系统将该实例置为 tab 序列最前并保持其余相对顺序（MRU）
2.1. WHEN 工作区从持久化状态恢复 THE SYSTEM SHALL 系统按持久化顺序构造实例并仅将活跃实例前置，避免 MRU 下逐次 open 翻转顺序

**Traceability:** `REQ-101`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/panes-kit/src/instances.ts; packages/panes-kit/src/react/panes-host.tsx

### Requirement 2: 新开 Pane 菜单显示真实计数

**Objective:** 作为桌面用户，我希望新开 Pane 菜单的元信息始终是实际打开计数，以便判断是否还能再开。

#### Acceptance Criteria

3.1. WHEN 某 pane 实例处于后台保活态 THE SYSTEM SHALL 系统在新开 Pane 菜单仍显示计数（x/y 或「已开 n」），不显示「后台保活」

**Traceability:** `REQ-102`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/panes-kit/src/react/panes-host.tsx

### Requirement 3: 更多 Pane 菜单选中态与弹窗可稳定打开

**Objective:** 作为桌面用户，我希望更多 Pane 菜单能标出当前活跃 tab，且新开 Pane 弹窗能稳定打开。

#### Acceptance Criteria

4.1. WHEN 活跃 tab 溢出到「更多 Pane」菜单 THE SYSTEM SHALL 系统在菜单项上标记选中态（✓ / accent 底色 / aria-current）
5.1. WHEN 用户首次打开新开 Pane 弹窗 THE SYSTEM SHALL 系统等待 overlay 壳创建完成后导航，避免预热与打开并发 create 竞态导致弹窗打不开

**Traceability:** `REQ-103`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/panes-kit/src/react/panes-host.tsx; packages/panes-kit/src/adapters/tauri-runtime.ts; public/pane-overlay.html

### Requirement 4: tab 切换不闪旧内容

**Objective:** 作为桌面用户，我希望切换 pane tab 时不再出现先隐藏后显示造成的空白闪帧。

#### Acceptance Criteria

6.1. WHEN 用户切换 pane tab THE SYSTEM SHALL 系统先显示活跃 webview 再隐藏其余，且 carrier 在未就绪前以 display 门控隐藏

**Traceability:** `REQ-104`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/panes-kit/src/react/panes-host.tsx

### Requirement 5: 切源时 pane 内容在骨架屏周期隐藏

**Objective:** 作为桌面用户，我希望切换源时右侧 Pane 不残留旧内容闪帧，骨架屏触发与完成期间 pane 内容保持隐藏。

#### Acceptance Criteria

7.1. WHEN 用户新建、切换或恢复会话 THE SYSTEM SHALL 系统先隐藏再销毁旧 pane webview，避免 remount 骨架屏渲染期间未销毁完的旧内容残留一帧

**Traceability:** `REQ-105`; docs/REQUIREMENTS-SPEC.md#REQ-A13; components/chat-app.tsx; lib/app/desktop-bridge.ts

### Requirement 6: 日志 pane 以 webview tab 接入

**Objective:** 作为 AIGC 用户，我希望扩展声明 hostView:"logs" 时日志 tab 恒渲染公共 LogsPanel，不依赖 showLogs 开关。

#### Acceptance Criteria

8.1. WHEN 扩展 panes 声明 hostView:"logs" 的一级 tab THE SYSTEM SHALL 系统恒渲染 LogsPanel 并提供完整数据链路（实时帧 + getLogs 历史），门控只作用于 legacy 位置面板

**Traceability:** `REQ-106`; docs/REQUIREMENTS-SPEC.md#REQ-A13; packages/ui/src/chat/pi-chat.tsx
<!-- record-kiro-spec:end -->
