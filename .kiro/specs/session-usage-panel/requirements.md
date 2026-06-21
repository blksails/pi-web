# Requirements Document

## Introduction

本特性把现成的会话用量面板 `PiSessionStats` 接入**产品实际使用的富版 `PiChat`**（`packages/ui/src/chat/pi-chat.tsx`），作为**内核自有区**展示当前会话用量——tokens、cost、messages、tool calls。当前该组件仅挂在最小版 `PiChatBasic`，富版（经 `components/chat-app.tsx` 进入产品）未渲染它，导致产品界面看不到任何用量信息。

用量数据已全链路就绪、无需新建：`usePiControls` 暴露实时 `stats`（来自 REST `GET /sessions/:id/stats` 与 SSE control 的 `stats` 帧），类型见 `packages/protocol` 的 `SessionStatsSchema`。本特性只补 UI 接入与对应的单元/e2e 验证。

> 权威背景与落点取舍见本仓 slot 版图与设计梳理；与 webext slot 的并存关系遵循 `extension-slots.tsx` 的「共存追加，绝不替换内核表面」铁律。

## Boundary Context

- **In scope**：在富版 `PiChat` 中以内核自有区渲染用量面板；展示 tokens/cost/messages/toolCalls；随 `stats` 更新刷新；与 webext `statusBar` 贡献并存；对应单元测试与浏览器 e2e。
- **Out of scope**：跨会话历史用量聚合/看板（独立路由 `/usage`，后续阶段）；新增任何用量数据源或后端聚合；修改 `ToolbarControl` 固定枚举；改动用量数据协议 `SessionStatsSchema`。
- **Adjacent expectations**：依赖 `usePiControls.stats` 已能提供会话级用量（现状成立）；依赖 webext slot 的「共存追加」语义不变；不接管 webext `statusBar`/`panelRight`/`artifact` 的渲染职责。

## Requirements

### Requirement 1: 富版 PiChat 渲染内核用量面板

**Objective:** As a 使用 pi-web 产品界面的用户, I want 在富版 `PiChat` 会话界面看到当前会话的用量面板, so that 我能在对话过程中掌握 token 消耗与成本。

#### Acceptance Criteria
1. When 富版 `PiChat` 挂载并存在会话控制（`controls`）, the 富版 PiChat shall 渲染一个用量面板区域，并带可观测标识 `data-pi-session-stats`。
2. Where 宿主关闭内置控制展示（等价 `showControls=false` 的配置）, the 富版 PiChat shall 不渲染该用量面板区域。
3. The 用量面板 shall 作为内核自有区渲染，不依赖任何 webext 扩展是否存在。
4. If 会话控制不可用（无 `controls` 或 `stats` 尚未就绪）, then the 用量面板 shall 显示空态占位（如「No stats yet」）而非报错或空白崩溃。

### Requirement 2: 用量字段展示

**Objective:** As a 用户, I want 用量面板展示关键用量字段, so that 我能一眼读到消息数、工具调用数、token 总量与成本。

#### Acceptance Criteria
1. While `stats` 可用, the 用量面板 shall 展示 messages（`totalMessages`）、tool calls（`toolCalls`）、tokens（`tokens.total`）、cost 四项。
2. The 用量面板 shall 为每个字段提供可观测标识（如 `data-pi-stat="messages|toolCalls|tokens|cost"`）以便测试断言。
3. When 展示 cost, the 用量面板 shall 以货币金额格式呈现（如 `$0.0000`）。

### Requirement 3: 用量随会话实时刷新

**Objective:** As a 用户, I want 用量面板在会话进行中自动更新, so that 我看到的用量始终反映最新状态。

#### Acceptance Criteria
1. When `usePiControls` 的 `stats` 发生更新（经 SSE control `stats` 帧或重新拉取）, the 用量面板 shall 刷新展示为最新的 messages/toolCalls/tokens/cost 值。
2. While 会话尚未产生任何用量, the 用量面板 shall 显示空态而非旧值或错误。

### Requirement 4: 与 webext statusBar 并存不顶替

**Objective:** As a 同时使用 agent web extension 的用户, I want 内核用量面板与扩展贡献的 statusBar 共存, so that 两者信息都不丢失。

#### Acceptance Criteria
1. Where 某 agent 扩展贡献了 `statusBar` slot, the 富版 PiChat shall 同时渲染内核用量面板（`data-pi-session-stats`）与扩展 statusBar（`data-pi-ext-status-bar`），二者互不顶替。
2. The 用量面板 shall 不借用 `ExtSlotRegion`/webext slot 通道承载内核用量（避免扩展贡献时被顶替）。
3. The 用量面板 shall 不渲染进 `panelRight` 区域（避免与 webext `panelRight` 及 Tier4 artifact 争抢右侧大区）。

### Requirement 5: 不回归既有行为

**Objective:** As a 维护者, I want 本次改动不破坏既有组件与布局, so that 现有功能与测试保持稳定。

#### Acceptance Criteria
1. The 改动 shall 不改变最小版 `PiChatBasic` 的现有用量展示行为。
2. The 改动 shall 不修改用量数据协议 `SessionStatsSchema` 与数据来源（REST/SSE）。
3. When 富版 `PiChat` 在无扩展、默认布局下运行, the 富版 PiChat shall 保持既有消息流、输入区与控件的版面不被用量面板破坏（无遮挡、无溢出）。

### Requirement 6: 测试与验收证据

**Objective:** As a 维护者, I want 本特性具备单元与 e2e 验收证据, so that 可按项目硬性要求以新鲜运行证据证明通过。

#### Acceptance Criteria
1. The 特性 shall 提供单元/组件测试，覆盖富版 `PiChat` 渲染用量面板、字段展示、空态、以及与 webext statusBar 并存。
2. The 特性 shall 提供浏览器 e2e 测试，验证产品界面渲染用量面板（data 属性可见）、展示四项字段、并在 `stats` 更新时刷新。
3. The e2e 测试 shall 遵循本项目隔离 build 跑法（`NEXT_DIST_DIR=.next-e2e` + external server 模式），不污染 dev 的 `.next`。
4. When 验收完成, the 维护者 shall 以实际运行输出（测试结果/截图）作为新鲜证据，参照 `kiro-verify-completion`。
