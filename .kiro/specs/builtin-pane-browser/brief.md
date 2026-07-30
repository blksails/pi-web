# Brief: builtin-pane-browser

## Problem

用户希望有一个内置的 **browser pane**:在与 agent 对话的同时,能在一块面板里打开网页 ——
预览 agent 起的 dev server、看生成的 HTML、查文档、验证线上效果。

但纯 web 形态下这件事有硬约束:pane 本身已是 `sandbox="allow-scripts"` 的 iframe,
再往里嵌任意站点会被目标站点的 `X-Frame-Options` / CSP `frame-ancestors` 挡住 ——
大量站点(含多数文档站与 SaaS)根本无法嵌入。这不是实现质量问题,是浏览器安全模型。

## Current State

> 2026-07-30 按内核提取后的代码基复核。原判断「不存在 pane 与桌面原生 webview 的协作模型」
> **已被推翻** —— 协作模型已建成,只是没接线,且其安全前提与本 spec 的目标正面冲突。

- 桌面版已迁至 **Tauri v2**(`electron-to-tauri`,macOS 全链已验),具备原生 webview 能力。
- panes 地基(`isolated-panes`)与宿主装载(`host-builtin-panes`)已具备。
- 部署形态判定:由 `desktop-account-login` 的扩展落地为**单一权威**(本 spec 复用,不另造),
  其底座是 `packages/adapters/src/auth/desktop-marker.ts` 的 `DESKTOP_MARKER_ENV`。
- **pane ↔ 原生 webview 的协作模型已存在**(isolated-panes 任务 5.x):
  - `packages/panes-kit/src/host-ports.ts` —— `PanePort` / `PaneViewHandle` / `PaneViewAdapter`
    抽象,核心不依赖 Tauri SDK。
  - `packages/panes-kit/src/adapters/relay.ts` —— 宿主侧 `createRelayPanePort` 与 Guest Realm
    侧 `createPaneGuestRealmBridge` 两侧对偶,信封只包路由标识、不解析协议消息。
  - `packages/panes-kit/src/adapters/tauri.ts` —— `createTauriPaneViewAdapter`,
    webview 标签约定 `pane-<instanceId>`。
  - `desktop/src-tauri/src/pane_relay.rs` —— Rust 侧只做 instanceId+epoch 绑定与标签鉴权的
    信封路由。
- ★ **但它未接入生产装配**:`createTauriPaneViewAdapter` 目前**只在**
  `packages/panes-kit/test/conformance/transport-conformance.test.ts` 被使用。
- ★ **且它刻意不授予导航**:`desktop/src-tauri/capabilities/panes.json` 明写 pane webview
  (`pane-*` 标签)「仅事件监听 + 中继上行;**不授予导航、shell、opener**、对话框或任何 host
  侧命令」;`createTauriPaneViewAdapter` 另有 `allowedProtocols` 守卫。
- 缺口:不存在任何 browser pane;**已有的 pane webview 恰恰被设计成不能导航**。

## Core Tension(本 spec 的真问题)

既有 pane webview 是「隔离的 guest 渲染面」,其安全前提就是**不能自主导航、不能碰宿主命令**。
browser pane 要的是**可导航到任意站点**。这两者不可同时成立于同一个 capability 集合上,
因此本 spec 必须正面做一个安全抉择,而不是把它当成「补个功能」:

- **选项 A**:引入**第二类 view**(如 `browser-*` 标签)与独立 capability 集合,与 `pane-*`
  完全分离 —— pane guest 的最小面不被放宽,导航面单独立账、单独 review。
- **选项 B**:放宽 `pane-*` 的 capability 以容纳导航 —— 实现省事,但把所有 pane(含第三方
  agent 提供的)的能力面一起抬高,与 `isolated-panes` 的默认拒绝取向相反。

倾向 A;最终结论须在 requirements/design 阶段以明确论证落定,不得默默走 B。

## Desired Outcome

- **桌面形态(Tauri)**:用原生 webview 打开任意站点,不受 `frame-ancestors` 限制;
  具备基本导航(地址、前进/后退/刷新)。
- **纯 web 形态**:诚实降级为**同源/可控来源预览器** —— 只开宿主与 agent 自身可控的 URL
  (agent 起的本地 dev server、宿主分发的附件页、生成的 HTML)。对不可嵌入的外链给出明确
  提示与「在系统浏览器打开」出口,而不是白屏。
- 两形态**同一 pane 身份、同一入口**,能力差异对用户可见且可解释。

## Approach

一个 pane 定义,两套渲染后端,按形态权威判定分派:

1. **形态判定**复用单一权威函数(禁止在此处再写 `if (isDesktop)` ——
   `packages/adapters/src/identity/types.ts:16` 已立此纪律)。
2. **桌面**:pane guest 不自己嵌页,而是经宿主请求 Tauri 侧开/管一个原生 webview,
   由宿主负责其定位、层级与生命周期。**复用** `PaneViewAdapter` / relay 抽象(已存在),
   但按 Core Tension 的抉择结果决定 view 类别与 capability 归属。
   ⚠ 附带工作:`createTauriPaneViewAdapter` 至今未接入生产装配,本 spec 或其上游须先接线。
3. **web**:pane guest 内嵌 iframe,URL 限于可控来源白名单;越界 URL 走「系统浏览器打开」。

**明确拒绝**:宿主加转发代理剥 `frame-ancestors` 以便嵌任意站点 —— 那会把宿主变成开放代理,
引入 SSRF 面与凭据转发风险,与本仓既有的凭据保护方向(`sandbox-credentials-v2`、
`fetch-rpc-bridge`)背道而驰。

## Scope

- **In**:browser pane 定义与其两套后端;形态分派;可控来源白名单与越界处理;
  桌面原生 webview 的生命周期/层级/定位与 pane 实例的对应;导航控件;
  「在系统浏览器打开」出口;两形态各自的取证。
- **Out**:通用出站代理 / SSRF 网关(明确拒绝);浏览器自动化(点击/抓取 —— 那是 agent 工具
  领域,不是 pane);多标签浏览器;Cookie/会话管理与登录态托管。

## Boundary Candidates

- **形态分派与降级契约**(两后端共用的对外语义)
- **桌面 webview 后端**(跨 Tauri 壳,须打包态取证)
- **web 预览器后端**(可控来源白名单 + 不可嵌入提示)

## Out of Boundary

- 剥离目标站点安全头的任何代理方案
- 浏览器自动化 / 抓取
- 凭据、Cookie 在 pane 与宿主间的共享

## Upstream / Downstream

- **Upstream**:`host-builtin-panes`(装载与合并)、`desktop-account-login` 扩展(形态判定
  单一权威)、`electron-to-tauri`(桌面壳)、`isolated-panes`(协议)
- **Downstream**:无(叶子)

## Existing Spec Touchpoints

- **Extends**:无(新边界)
- **Adjacent**:`builtin-pane-suite`(同批内置 pane,共享装载与降级约定)、
  `electron-to-tauri` / `pi-web-desktop`(桌面壳侧改动落点)、
  `desktop-account-login`(形态判定的权威来源)

## Constraints

- **不得**引入剥离安全头的转发代理。
- **不得**为图省事直接放宽 `pane-*` capability(见 Core Tension);若最终选 B,须有独立论证与
  对第三方 pane 影响面的评估。
- 桌面侧改动须打包态取证 —— dev 下跑通不构成交付(`electron-to-tauri` 已记录 externalBin
  在 cargo build 期校验、strip 破签名等打包态特有坑)。
- ★ pane 时序问题以 browser e2e 为判据;桌面 webview 与 pane 实例的生命周期对应
  (多开、close、reload/epoch++)是本 spec 最容易出错的面,必须逐项验证:
  pane 关闭而 webview 泄漏、reload 后旧 webview 未回收都属失败。
- 跨平台:`electron-to-tauri` 仅 macOS 全链已验,Windows/Linux 未验 —— 本 spec 须显式声明
  取证覆盖到哪些平台,不得默认宣称跨平台可用。
