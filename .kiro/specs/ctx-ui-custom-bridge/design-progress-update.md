# Design Delta — 长任务进度 UI（采用 pi 原生扩展 UI 协议 setStatus）

> 本文是 `ctx-ui-custom-bridge` 的**增量设计**（delta），不是独立 spec。基线见同目录
> `design.md` / `requirements.md`。

> **结论 / 状态（2026-06-26，设计决策记录）。** 回合内长任务进度采用 pi **原生扩展 UI 协议**
> `ctx.ui.setStatus`（键控状态 pill，就地覆盖刷新），**零协议、零代码改动**——纯复用既有
> translate→control:extension-ui→ControlStore→StatusBar 链路。
>
> 演示资产（`examples/ui-custom-ui-demo-agent` 的 `run_progress` 工具 + `ext-status-progress`
> stub sentinel + custom-ui node/browser e2e）**已随 demo example 一并清理移除**（用户删除 example、
> custom 桥已休眠不走，见 [[ctx-ui-custom-bridge]] 记录）。本文作为**设计决策记录**保留：曾实现的
> `data-pi-custom-ui` + `id` reconcile 方案已回退（见《决策变更》），最终选 native `setStatus`。

## Overview

**Purpose**: 让 agent 在一次回合内反复反馈长任务进度（"部署中 40%" → "部署完成 100%"），
渲染为一个**就地刷新的状态 pill**，不刷屏、不堆叠。

**关键事实（决定方案）**: pi SDK 在 RPC 模式下，`ctx.ui` 的**推送类**方法
`notify` / `setStatus` / `setWidget` / `setTitle` **都是真实发帧的**
（`@earendil-works/pi-coding-agent@0.79.6` `dist/modes/rpc/rpc-mode.js:86–147`），
**只有 `custom` 是空操作**（这正是基线 `ctx-ui-custom-bridge` 要补桥的原因）。
因此用 `setStatus`/`setWidget` 做进度是**零协议、零 patch、纯复用**的正路。

## 三条候选通道与选型

| 通道 | 就地更新 | 渲染位置 | 富 UI | idle 期 | 协议成本 |
|---|---|---|---|---|---|
| host 命令同步体 | — | — | — | — | 只能一发终态，不适用 |
| `control:ui-rpc` 空闲流 | ✗ | — | — | 仅空闲 | **有害**（host 走它重蹈 prompt-流冲突，见 `unified-command-result-layer`） |
| `data-pi-custom-ui`（custom data part） | 需自造 `id` reconcile | 对话流内（留历史） | ✅ 富组件 | ⚠️ 须活动消息期 | 改协议（加 `id`） |
| **`ctx.ui.setStatus`/`setWidget`（原生扩展 UI）** | **天然键控覆盖** | 状态栏 / 编辑器上方（ambient） | ✗ 仅文本 | ✅ 任意时刻 | **零** |

**选定**：文本/ambient 进度 → **`setStatus`**。理由：天然就地更新（键控覆盖）、零协议改动、
不挂活动消息（control 帧旁路，任意时刻可更新，避开 custom data part「idle 期无处可挂」的坑）。

## 链路（全部已存在，零改动）

```
agent: ctx.ui.setStatus("deploy", "部署中 40%")           // pi 原生,RPC 模式真实发帧
  └─ extension_ui_request{method:"setStatus", statusKey:"deploy", statusText}  (rpc-mode.js:100)
      └─ translateEvent → control:extension-ui (旁路,非 UIMessage)          (translate-event.ts:364)
          └─(SSE)→ ControlStore.routeExtensionUi → setStatus(key,text)       (control-store.ts:209/254)
              └─ ambient.statuses[key] 覆盖(同 key 替换;undefined 删键)
                  └─ <StatusBar statuses> 渲染一个 pill[data-status-key]      (status-bar.tsx)
```

同 `statusKey="deploy"` 连发 → 状态栏**同一个 pill** 文本就地刷新。无需任何新协议/组件。

## 本增量实际改动（全部为示例 + 验证，无生产协议/代码改动）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `examples/ui-custom-ui-demo-agent/index.ts` | 新增 `run_progress` 工具，循环 `ctx.ui.setStatus("deploy", …)` 刷新到 100% |
| 2 | `examples/ui-custom-ui-demo-agent/README.md` | 工具表 + 「两条进度通道」说明（setStatus 文本 / custom 富卡） |
| 3 | `lib/app/stub-agent-process.mjs` | 新增 `ext-status-progress` sentinel：同 `statusKey="deploy"` 连发两帧 setStatus（40% → 100%） |
| 4 | `e2e/node/custom-ui.e2e.test.ts` | 新用例：两帧 setStatus 经 translate 旁路 `control:extension-ui` 回流（验同 key、两文本） |
| 5 | `e2e/browser/custom-ui.e2e.ts` | 新用例：状态栏 `[data-status-key="deploy"]` **单个 pill** 就地刷新到「部署完成 100%」（键控覆盖、不堆叠） |

> setStatus 的键控覆盖、StatusBar 渲染、translate 旁路均为**基线既有能力**（`ctx-ui-custom-bridge` /
> 状态栏 spec 已实现并测试覆盖），故无需新增协议/store/组件单测；本增量以示例 + node/browser e2e 收口。

## 决策变更：回退 `data-pi-custom-ui` + `id` reconcile

初版（同会话先实现）给 `CustomUiPayload`/`data-pi-custom-ui` chunk 加可选 `id`，借 AI SDK
data part id reconcile 做 custom 卡的就地更新。**已整体回退**，因为：

- 业务需求落在**文本/ambient 进度** → `setStatus` 是零成本正路，更稳（不挂活动消息）。
- 协议是 isomorphic 契约根（semver 敏感）：留一个**当前无业务消费者**的 `id` 字段是认知负担；
  且「进度用 custom 卡」与「进度用 setStatus」并存会传达矛盾信号。
- 回退范围：protocol（`data-part.ts`/`command.ts`/`rpc/extension-ui.ts` 的 `id`）、agent-kit
  `customUi` 的 `id`、`custom-ui-wiring`/`translate-event`/`decode-chunk` 的 `id` 透传、
  `DemoProgressCard` 及其注册/导出、`ext-custom-progress` stub、各层 `id` 单测、progress 的
  node/browser e2e。基线 `ctx.ui.custom`**一次性渲染**能力保持不变。

**互补（保留为设计记录，未实现）**：若日后需要**富视觉 / 留对话历史**的进度（进度条卡片 inline 在
transcript），仍可走基线 `ctx.ui.custom` + 一个稳定 `id` 的 reconcile——届时再起 delta。两条通道
正交：轻量文本/ambient 用 setStatus/setWidget，富/inline 用 custom。

## 边界提交

### 本增量 Owns
- 示例 `run_progress`（setStatus 进度）+ README 说明。
- stub `ext-status-progress` sentinel + node/browser e2e。

### Out of Boundary（零改动）
- 协议 / store / StatusBar / translate（均复用基线既有能力）。
- 基线 `ctx.ui.custom` 一次性渲染语义。
- host 命令进度（不在回合内，需另建 task-scoped 通道，显式搁置）。

### Revalidation Triggers
- pi SDK 升级改变 `setStatus`/`setWidget` 帧形状或 RPC 模式发帧行为 → 进度链路需回归。
- StatusBar 的 `data-status-key` / `data-pi-status` 选择器变更 → browser e2e 需同步。
