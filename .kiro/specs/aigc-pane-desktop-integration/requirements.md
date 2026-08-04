# Requirements Document

<!-- record-kiro-spec:start -->
## Introduction

以 iframe 与 Tauri ChildWebView 统一承载 AIGC 工作区 Pane，补齐生命周期、日志、独立 agent 装载、草稿带入及标题投射。

## Boundary Context

- **In scope**: Pane 仅以 iframe 或 Tauri ChildWebView 隔离文档承载; Pane 弹层、缩放、主题、隐藏销毁与静态日志文档; 独立 aigc-agent 工作区与素材、搜图、画布、日志 Pane 装载; 素材带入对话草稿但不自动发送; 扩展标题投射到 document.title 与 Tauri 窗口标题
- **Out of scope**: React 同 realm Pane; 生产数据库迁移与部署; 本次按用户要求未执行的 E2E; aigc-agent 仓内素材业务实现

## Requirements

### Requirement 1: Pane 生命周期与公共载体

**Objective:** 作为桌面用户，我希望 Pane 可快速显示、隐藏及销毁，以便切换工作区时稳定且无残留。

#### Acceptance Criteria

1.1. WHEN Pane 首次打开或宿主恢复可见 THE SYSTEM SHALL 复用预热隔离载体并在就绪后显示
1.2. WHEN 宿主隐藏、切源或退出会话 THE SYSTEM SHALL 按生命周期隐藏或销毁对应 ChildWebView
1.3. WHEN 用户拖拽侧栏宽度 THE SYSTEM SHALL 以宿主 content-well 尺寸更新 ChildWebView 且不遮挡分隔线

**Traceability:** `REQ-A13`; docs/REQUIREMENTS-SPEC.md#REQ-A13

### Requirement 2: Pane 隔离载体与宿主交互

**Objective:** 作为宿主维护者，我希望所有 Pane 走 iframe 或 ChildWebView，以便避免同 realm React Pane 破坏隔离边界。

#### Acceptance Criteria

2.1. WHEN 网页或桌面宿主渲染任一 Pane THE SYSTEM SHALL 仅创建 iframe 或 ChildWebView 隔离文档
2.2. WHEN 打开新 Pane 或更多 Pane 弹层 THE SYSTEM SHALL 稳定显示当前弹层并清除已隐藏 WebView 的旧弹层
2.3. WHEN 宿主主题切换 THE SYSTEM SHALL Pane 与 Tab 同步新主题且不闪回旧主题
2.4. WHEN 日志 Pane 打开 THE SYSTEM SHALL 加载受协议声明保护且跟随宿主主题的静态日志文档

**Traceability:** `REQ-PANE-201`; docs/REQUIREMENTS-SPEC.md#REQ-PANE-201

### Requirement 3: AIGC Agent 独立装载与工作区 Pane

**Objective:** 作为 AIGC 用户，我希望独立 agent 包仍能在 pi-web 中展示素材、搜图、画布与日志 Pane，以便独立发布而不丢宿主能力。

#### Acceptance Criteria

3.1. WHEN pi-web 装载 examples/aigc-agent 源 THE SYSTEM SHALL 通过稳定静态入口解析其 Web Extension
3.2. WHEN agent 声明素材、搜图、画布与日志 Pane THE SYSTEM SHALL 把各 Pane 作为 PanesHost Tab 展示
3.3. WHEN 扩展缺少 panes 或声明畸形 THE SYSTEM SHALL 忽略无效贡献并保持宿主可用

**Traceability:** `REQ-PANE-202`; docs/REQUIREMENTS-SPEC.md#REQ-PANE-202

### Requirement 4: 草稿带入与标题投射

**Objective:** 作为用户，我希望素材先进入对话草稿且页面显示 agent 标题，以便审阅后再发送并辨认当前窗口。

#### Acceptance Criteria

4.1. WHEN Pane 调用 conversation.stage 并携带附件 THE SYSTEM SHALL 把附件 mention 写入输入框并聚焦，且不调用发送
4.2. WHEN 扩展标题可用 THE SYSTEM SHALL 移除扩展头部并同步 document.title
4.3. WHEN 宿主运行于 Tauri THE SYSTEM SHALL 把同一标题同步到当前桌面窗口

**Traceability:** `REQ-PANE-203`; docs/REQUIREMENTS-SPEC.md#REQ-PANE-203
<!-- record-kiro-spec:end -->
