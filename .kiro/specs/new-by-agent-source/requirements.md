# Requirements Document

## Introduction

本特性改进 pi-web 产品顶栏（`components/chat-app.tsx` 的 `SessionView` 顶栏）的会话新建体验：把现有 "New session" 按钮从「退回 `AgentSourcePicker` 重选源」改为「用**当前 agent source** 直接新建一个会话」（同源新建），让用户基于同一个 agent 反复开新会话时一键即可；同时新增「切换源」按钮，保留原有"退回选择器重选源"的能力。

> 调查所得关键约束（design 阶段落实）：`usePiSession` 的 `start()` 被 `startedRef` 守卫、自动启动仅在挂载时执行一次，故仅改 `create` prop 不会重建会话——同源新建须强制 `SessionView` 重新挂载（变化的 `key`）。此为实现细节，不进入本文件验收条目。

## Boundary Context

- **In scope**：`SessionView` 顶栏的"同源新建"与"切换源"两个按钮及其行为；`ChatApp` 触发同源会话重建的逻辑；对应组件/集成测试与浏览器 e2e。
- **Out of scope**：`@pi-web/ui` 的 `PiChat`、`usePiSession` hook、REST/SSE 协议均不改；不触碰 session-usage-panel 等其它特性；不改 `AgentSourcePicker` 自身。
- **Adjacent expectations**：依赖 `usePiSession` 现有「挂载即按 create 建会话」语义；依赖会话 id 就绪后的 URL 同步与 source 映射副作用（`onSessionId`）保持不变。

## Requirements

### Requirement 1: 同源新建会话

**Objective:** As a 使用 pi-web 产品界面的用户, I want 一键基于当前 agent source 开一个新会话, so that 我无需每次回到选择器重输 agent 路径。

#### Acceptance Criteria
1. When 用户在活动会话中点击顶栏 "New session" 按钮, the SessionView shall 以**当前 agent source** 创建一个全新会话（新的 sessionId），而不退回 `AgentSourcePicker`。
2. When 同源新建完成且新会话 id 就绪, the SessionView shall 把浏览器地址同步为 `/session/:newId`（新 id 与原会话不同）。
3. When 同源新建后, the SessionView shall 保持 agent source 不变，且新会话不进入恢复模式（不带 resumeId，从空会话开始）。
4. While 新会话连接建立中, the SessionView shall 显示连接中指示，连接成功后可正常对话。

### Requirement 2: 切换源

**Objective:** As a 用户, I want 一个入口退回 agent 源选择器, so that 我能换一个 agent source 重新开始。

#### Acceptance Criteria
1. The SessionView 顶栏 shall 提供一个「切换源」按钮。
2. When 用户点击「切换源」, the ChatApp shall 退回 `AgentSourcePicker`（源选择器可见），并把浏览器地址重置为 `/`。
3. When 退回选择器后用户提交一个 source, the ChatApp shall 以该 source 新建会话（沿用既有提交路径）。

### Requirement 3: 不回归既有行为

**Objective:** As a 维护者, I want 本次改动不破坏既有会话流程, so that 现有功能与测试保持稳定。

#### Acceptance Criteria
1. The 改动 shall 不改变 `@pi-web/ui` 的 `PiChat`、`usePiSession` hook 与 REST/SSE 协议。
2. The 改动 shall 不改变会话错误态（创建失败）下"重新选择源"的现有恢复入口行为。
3. When 经 `/session/:id` 冷加载（恢复模式）进入, the SessionView shall 保持既有恢复行为不受影响。

### Requirement 4: 测试与验收证据

**Objective:** As a 维护者, I want 本特性具备组件与 e2e 验收证据, so that 可按项目硬性要求以新鲜运行证据证明通过。

#### Acceptance Criteria
1. The 特性 shall 提供组件/集成测试，覆盖"同源新建触发会话重建（source 不变、无 resumeId）"与"切换源回到选择器"。
2. The 特性 shall 提供浏览器 e2e：活动会话中点 "New session" → 出现与原不同的新 session id、agent 源不变、可继续对话；点「切换源」→ 出现 agent 源选择器。
3. The e2e 测试 shall 遵循本项目隔离 build 跑法（`NEXT_DIST_DIR=.next-e2e` + external server 模式），不污染 dev 的 `.next`。
4. When 验收完成, the 维护者 shall 以实际运行输出（测试结果/截图）作为新鲜证据，参照 `kiro-verify-completion`。
