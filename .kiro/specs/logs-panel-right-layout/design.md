# Design Document — logs-panel-right-layout

## 概述

修复日志面板 `panelPosition="right"` 的整页崩溃(React #185 Maximum update depth),使其在右侧 aside 正常渲染,并移除调试期的临时降级 clamp。

## 根因(隔离法确证)

- **隔离**:把 right aside 内的 `LogsPanel` 换成占位 div → 立即不崩;放回即崩。→ 病根是 **LogsPanel-in-aside**。
- **错误栈**:`@radix-ui/react-select` 的 `SelectItemText` → `useComposedRefs` → `setRef` → `dispatchSetState`,发生在 `commitMutationEffects → safelyDetachRef`(即 radix Select 的 ref 在每次提交反复挂/卸 → setState 循环 → #185)。
- **为何只 right 崩**:`LogsPanel` 的 level 过滤是 **radix Select**。在 `bottom`(dock,`absolute` 容器)/`drawer`(覆盖层)下工作正常;在 `right`(in-flow aside)的受限 flex/overflow 上下文里,radix Select 的 Popper 定位/ref 组合进入反馈循环。
- **排除项**:`dockRef` 的 ResizeObserver 改 rAF + 同值守卫 → 无效(非 dock RO);仅给 aside 有界高度(flex-1 min-h-0)→ 仍崩(非纯高度)。

## 决策与方案

**核心修复:level 过滤由 radix `Select` 改为原生 `<select>`。**
- 原生 `<select>` 无 Portal、无 `useComposedRefs` ref 组合 → 杜绝 #185;三种位置(bottom/right/drawer)统一稳定。
- 验证:换原生 select 后 right 不再崩(slash 命令面板可开、level 过滤可见、NO ERRORS)。

**配套:右侧 aside 有界高度布局。**
- `aside` 由 `lg:block` 改 `lg:flex lg:flex-col min-h-0`,给 right 日志区一个有界高度上下文(仅 panelRight/artifact 时子项无 flex-1 仍按内容堆叠,视觉等价)。
- right 日志区 `flex min-h-0 flex-1 flex-col overflow-hidden p-2`,`LogsPanel className="flex-1 min-h-0"` → 在固定高度内滚动。

**移除临时降级 clamp。**
- 删 `effectiveLogsPosition: right→bottom` 与 `showLogsRight=false`,恢复 `showLogsRight = showLogs && logsPanelVisible && logsPanelPosition === "right"`。

**默认位置维持 committed `"bottom"`。**
- `logging.ts` 的 schema 默认还原为 committed 的 `"bottom"`(会话起始有一处未提交把它改成 `"right"`,是「全员吃 right→崩」的源头)。right 经 logging 配置(`outputs.panelPosition`,schema 已支持)opt-in;现已修复故配置 right 安全可用。

## 组件与改动

| 文件 | 改动 |
|---|---|
| `packages/ui/src/logs/logs-panel.tsx` | level 过滤 radix `Select` → 原生 `<select>`(保留 `data-pi-logs-level-filter`/`handleLevelChange`);移除未用 radix Select 导入 |
| `packages/ui/src/chat/pi-chat.tsx` | 移除 clamp;aside `lg:flex lg:flex-col min-h-0`;right 日志区有界高度 + `LogsPanel flex-1 min-h-0` |
| `packages/protocol/src/config/domains/logging.ts` | schema 默认还原 `"bottom"` |
| `e2e/browser/logging-system.e2e.ts` | level 过滤交互 radix(trigger.click+option.click)→ 原生 `selectOption` |
| `e2e/browser/logs-panel-right.e2e.ts`(新) | right 位置防回归:路由 mock 强制 panelPosition=right → 右侧渲染 + 命令面板不崩 + 原生 select 可用 + 无 #185 |

## Testing Strategy

- **单元/组件**:LogsPanel 渲染 + level 过滤(原生 select)`packages/ui/test/logs`(29 现存,原生 select 不破)。
- **e2e**:
  - `logs-panel-right`(新):right 渲染 + 命令面板不崩 + selectOption + 无 #185。
  - 回归:`slash-command-palette` / `unified-command-layer` / `plugin-command` 全绿(default bottom)。
  - `logging-system`:level 过滤交互改原生 selectOption;其余 5 个失败为 **pre-existing harness 环境缺失**(logging-demo webext 在手动 external server 不产 `webext:logging-demo` 浏览器日志;已对 committed baseline 取证同样失败),非本次引入。

## 约束落地

- bottom/drawer 零回归(均改用原生 select,行为不变);webext panelRight/artifact 在 aside 的行为不受影响(aside flex-col 对无 flex-1 子项等价 block 堆叠)。
- 修复后移除 clamp;right 走真实渲染。
- e2e 走 `NEXT_DIST_DIR=.next-e2e` external server;验证以 prod build 为准。
