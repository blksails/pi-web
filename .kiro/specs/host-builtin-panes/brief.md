# Brief: host-builtin-panes

## Problem

今天 panes **只**经 agent 的 web extension 装载:`.pi/web/web.config.tsx` 的
`slots.panelRight` 渲染 `PanesHost`,`definition` 全部来自 agent 侧的 `pane-meta.ts` /
`PaneAgentModule`。后果是:

- **任何没写 web extension 的 agent 都看不到 panes** —— 包括内置 default-agent
  (`packages/core/src/builtin-agents/default-agent/index.ts`,纯数据 `AgentDefinition`,
  不带 web extension)、绝大多数第三方 agent source、以及用户自己临时起的 agent 目录。
- **cli 模式会话更彻底**:`assemble-spawn.ts` 的 cli 分支直接 spawn pi CLI `--mode rpc`,
  连 runner 都不经过 —— 「宿主对所有会话都成立」这句承诺在 cli 模式下要单独验证,
  不能只在 custom 模式取证(同类事实已在 auto-title 上吃过一次:三个内置扩展在 cli 模式静默失效)。
- 宿主想提供**通用**能力(文件浏览、编辑、日志、浏览器)时无处安放:这些不是某个 agent 的
  领域投影,而是宿主对**所有**会话都成立的能力,却被迫伪装成 agent 声明。
- 结果是 panes 这套已建成的地基(`isolated-panes` Wave 0–4)使用面极窄。

## Current State

> **2026-07-30 复核**:内核提取波次已合入 main(`packages/server` → `packages/{core,runner,adapters}`)。
> panes-kit / tool-kit 路径未变;新增事实见下方桌面车道与 cli 模式两条。

已有(`isolated-panes` 已实现并合入):

- `packages/panes-kit`:`definePanes` / `PanesDefinition` / `PaneDefinition` / `PaneInstance`
  契约;五种 Guest operation 与四种 Host 下行;错误码;`PaneCapabilities` 与默认大小限制。
- `createPaneWorkspace` / `reducePaneWorkspace` 纯实例 reducer(多开、epoch、lifecycle)。
- `PanesHost`(React):每实例独立 iframe + MessageChannel + epoch 握手 + `bindSurface`
  重绑 + 补连扫描 + `pane:ready` 强制重连。
- `authorization.ts`:**grant 只源于已装载定义**,guest 自报 paneId/route/method/domain/
  action/attachmentId 不产生任何权限。
- agent 侧载体 `PaneAgentModule` + `composePaneAgentModules`
  (`packages/tool-kit/src/panes/agent-modules.ts`),把「pane 元信息 + 其 extensions +
  其 routes」绑成一体,装配期校验。
- 桌面车道:`host-ports.ts`(`PanePort`/`PaneViewHandle`/`PaneViewAdapter`)+
  `adapters/{relay,tauri,tauri-bootstrap}.ts` + Rust `desktop/src-tauri/src/pane_relay.rs`。
  ⚠ `createTauriPaneViewAdapter` 目前**只在 conformance 测试**被使用,未接入生产装配 ——
  宿主装载点若要覆盖桌面形态,须留出这条接线的位置。
- 参照实现:`examples/panes-agent`、`examples/aigc-canvas-agent`(slots→panes 就地迁移)。

缺口:宿主侧**零**默认 pane(全仓 grep 无 `builtinPanes`/`BUILTIN_PANES` 任何形态);
`PanesHost` 的装载点在 agent 的 `web.config.tsx` 里,宿主没有自己的装载时机;
不存在「宿主定义 + agent 定义」的合并语义。

## Desired Outcome

- 宿主默认给**每个会话**装载一组内置 pane 定义;任何 agent(含完全没有 web extension 的)
  零改动即可见 panes。
- agent 若声明 `PaneAgentModule`,其 pane 在内置集合**之上追加合并**,冲突语义明确且可测。
- 内置 pane 的**内置身份不产生额外权限** —— 与第三方 pane 走同一 grant 路径,能力仍须
  逐项授予,`isolated-panes` Req 4.1/4.2 的默认拒绝对内置同样成立。
- 既有 agent 侧 panes(`panes-agent` / `aigc-canvas-agent`)行为不回退。

## Approach

宿主侧建立**内置 pane 定义注册表 + 宿主装载点**,与 agent 声明在装载期合并:

1. 宿主持有一份内置 `PaneDefinition` 集合(本 spec 只建机制与占位,具体 pane 由下游 spec 实现)。
2. 宿主在会话 shell 层装载 `PanesHost`,不再依赖 agent 提供 slot 渲染器。
3. 合并:内置集合为基,agent 的 `composePaneAgentModules` 产物追加;ID 撞车按明确规则处理
   (是否允许 agent 覆盖内置 = 本 spec 要定的核心语义之一)。
4. agent 已自带 `web.config.tsx` slot 渲染器的既有形态需保持可用(不回退)。

**为何统一走 iframe guest**:内置 pane 与第三方 pane 同构,隔离性一致,且能保住
「宿主能力面」这条独立的安全边界(见 `pane-host-capabilities`)。宿主原生 React 特权面板
虽实现快,但会形成双轨并让能力面这条边界消失。

## Scope

- **In**:内置 pane 定义注册表与其契约;宿主侧 `PanesHost` 装载点;内置 ⊕ agent 的合并与
  冲突语义;内置身份不提权的授权保证;既有 agent 侧 panes 的兼容与不回退验证;
  内置集合为空/部分可用时的降级。
- **Out**:任何具体内置 pane 的 UI 实现(→ `builtin-pane-suite` / `builtin-pane-browser`);
  文件系统、日志等宿主能力 route 与授权(→ `pane-host-capabilities`);
  `panes-kit` 契约本身的改动(除非合并语义确有必要,且须显式论证)。

## Boundary Candidates

- 内置 pane 定义的**注册与枚举**(宿主侧单一清单,镜像 `BUILTIN_EXTENSIONS` 的「只改一处」纪律)
- **装载点**:宿主 shell 何时、以何 placement 渲染 `PanesHost`
- **合并语义**:内置 ⊕ agent,ID 冲突、顺序、初始 pane、`maxOpenPanes` 的合成
- **授权不变式**:内置身份 → 不提权

## Out of Boundary

- 具体 pane 的领域逻辑与 UI
- 宿主能力 route(文件/日志)的实现与鉴权
- 部署形态判定(归 `desktop-account-login` 扩展)

## Upstream / Downstream

- **Upstream**:`isolated-panes`(panes-kit 契约、`PanesHost`、authorization、`PaneAgentModule`)
- **Downstream**:`pane-host-capabilities` → `builtin-pane-suite` / `builtin-pane-browser`

## Existing Spec Touchpoints

- **Extends**:`isolated-panes`(在其地基上加宿主侧装载与合并;不改已冻结的 Guest/Host 协议)
- **Adjacent**:`agent-web-extension`(slot 车道,须保持不回退)、`source-settings-and-slots`

## Constraints

- 不得放宽 `isolated-panes` 的默认拒绝语义。
- ★ **pane 时序问题必须以 browser e2e 为判据** —— `isolated-panes` Wave 5 教训:panes-kit
  单测 31/31 全绿而真实浏览器 4 套 e2e 全红。合并/装载改动同属时序敏感面。
- 既有示例 `panes-agent` / `aigc-canvas-agent` 的 e2e 必须继续通过。
- `examples/` 无 typecheck 面(根 tsconfig `exclude: ["examples"]`),涉及示例改动须临时 tsconfig 补检。
- ★ **须先与 in-flight 分支 `feat/aigc-canvas-panes-migration` 对齐**:`isolated-panes`
  Wave 5(任务 6.1/6.2/6.3 AIGC 迁移)仍未勾,该分支正在改同一批装载相关文件。
  本 spec 改 `PanesHost` 装载点会与之直接相撞 —— 开工前先确认那条分支是合入、放弃还是并行。
- ★ 「所有 agent 都能见 panes」的判据必须覆盖 **custom 与 cli 两种模式**,且要有一个
  在缺陷存在时**会报红**的用例;只在 custom 模式跑绿不构成达标。
