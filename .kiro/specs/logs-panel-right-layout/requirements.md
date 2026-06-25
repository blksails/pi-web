# Requirements Document

## Project Description (Input)

修复日志面板 `panelPosition="right"`(右侧 aside 布局)的渲染崩溃,使其能正常渲染在右侧,并移除当前的临时降级。

### 背景与问题
日志面板支持三种位置:`bottom`(默认,随输入 dock 底部)、`drawer`(抽屉覆盖)、`right`(右侧 aside)。`right` 位置**会导致整页 client 崩溃**:

- 把 `LogsPanel` 渲染进 `right` 的 **aside 布局**时,其内 **radix Select(日志 level 下拉)在该布局下 ref 反复挂卸** → **React #185「Maximum update depth exceeded」** → 命令面板一打开即整页崩("Application error")。
- **隔离法已确证**:把 right aside 里的 `LogsPanel` 换成占位 div → 立即不崩;放回即崩。故病根是 **LogsPanel-in-aside**,而非 dock 的 ResizeObserver、也非命令层。

### 已做的临时处置(本 spec 要替换的)
为防崩,已在 `packages/ui/src/chat/pi-chat.tsx` 加**安全降级 clamp**(commit 12cb08b):
- `effectiveLogsPosition = logsPanelPosition === "right" ? "bottom" : logsPanelPosition`
- `showLogsRight = false`(恒关)
- bottom/drawer 检查改用 `effectiveLogsPosition`

即 `right` **当前被降级当 bottom 渲染**(不崩,但实际不在右侧)。本 spec 的目标是**真正修好 right 布局后移除该 clamp**。

### 已尝试且无效的修复(避免重复走)
1. `dockRef` 的 `ResizeObserver` 改 `requestAnimationFrame` 延迟 + 同值守卫 → **无效**(证明病根非 dock 的 RO)。
2. aside 改 `lg:flex lg:flex-col` + logs 区 `flex-1 min-h-0`(对齐 drawer 的有界高度写法)→ **仍崩**。

### 关键线索 / 怀疑方向
- 错误栈指向 `@radix-ui/react-select` 的 `SelectItemText` → `useComposedRefs` → `setRef` → `dispatchSetState`,发生在 React 的 `commitMutationEffects` → `safelyDetachRef` 阶段(即 ref 在每次提交反复挂/卸)。
- `LogsPanel` 在 `bottom`(dock,`absolute` 容器)与 `drawer`(覆盖层)位置工作正常;唯独 `right`(in-flow aside,`w-96` block)崩。差异疑在 **radix Select 的 Popper 定位/测量在受限 flex/overflow 上下文中的反馈循环**。
- 可能方向(设计阶段择优验证):(a) 把 LogsPanel 的 level 选择从 radix Select 换为原生 `<select>`/无 Portal 实现;(b) 修 radix Select 的 `position`/`collisionBoundary`/`container`(Portal 目标)使其在 aside 内稳定;(c) 重构右侧 aside 的高度/overflow 上下文使布局稳定。

### 现状参考(代码落点)
- 渲染:`packages/ui/src/chat/pi-chat.tsx`(aside `data-pi-chat-aside`、`showLogsRight`/`effectiveLogsPosition`、bottom/drawer/right 三处分支、`dockRef`)。
- 组件:`packages/ui/src/logs/logs-panel.tsx`(radix Select level 下拉 + 自动滚动 effect)。
- 配置链:`components/chat-app.tsx` `useLogsPanelConfig`(fetch /api/config/logging)→ PiChat `logsPanelPosition`。注:**当前 logging config schema 不携带 `outputs.panelPosition`**,故 right 仅由默认值/未来 config 扩展触发(本 spec 可一并评估是否把 panelPosition 纳入 config schema)。

### 目标
1. `panelPosition="right"` 能把日志面板正常渲染在右侧 aside,**不崩溃、不无限重渲染**。
2. **移除临时降级 clamp**(effectiveLogsPosition / showLogsRight=false),恢复真正的 right 渲染。
3. `bottom` 与 `drawer` 位置**零回归**。
4. 提供覆盖三种位置(尤其 right)的自动化测试,**防止 #185 回归**。

### 必须钉为显式约束
1. 不得回归 `bottom`/`drawer`,也不得回归命令面板(slash/unified)与 webext panelRight/artifact 在 aside 的既有行为(aside 同时承载 panelRight/artifact)。
2. 修复后**移除 clamp**;`right` 走真实渲染路径。
3. e2e 必须包含 `right` 位置:开命令面板/输入 `/` 不崩 + 日志面板可见在右侧。
4. e2e 走 `NEXT_DIST_DIR=.next-e2e` external server;改注入路由/协议域后 dev 需重启;**next dev 对 monorepo 包热重载不可靠,验证以 prod build 为准**。
5. 若决定把 `outputs.panelPosition` 纳入 logging config schema(使 right 真正用户可达),需保持向后兼容。

### 涉及包
`packages/ui`(pi-chat 右侧布局 + logs-panel 的 Select)、可能 `packages/protocol`/`components` + `packages/server`(若纳入 panelPosition 到 logging config schema)。

### 与既有关系
- 承接 logging-system(packages/logger + 面板 + 配置)的右侧位置;替换 unified-command-result-layer 调试期加的临时降级 clamp。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
