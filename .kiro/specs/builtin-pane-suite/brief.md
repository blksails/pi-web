# Brief: builtin-pane-suite

## Problem

宿主具备了内置 pane 的装载机制(`host-builtin-panes`)与能力面(`pane-host-capabilities`)之后,
还需要真正的 pane 实现,用户才看得到价值:

- 用户在与 agent 对话时,想直接**看到工作目录里有什么**、**读/改某个文件**,而不必每句话都
  让 agent 代劳。
- 现有 **logging 面板**是宿主 shell 里的一块特设 UI(`logs-panel-right-layout`),与 panes
  体系并存,形成双轨:同样是"右侧一块可开关的工具面板",却走完全不同的装载、布局与生命周期。

## Current State

- 内置 pane 的装载与合并:由 `host-builtin-panes` 提供(上游)。
- 文件树 / 读 / 写 / 日志订阅能力:由 `pane-host-capabilities` 提供(上游)。
- Guest SDK 已有:`connectPaneGuest` + `PaneGuestProvider` / `usePaneGuest` / `withPaneGuest`。
- 现有 logs 面板:`logs-panel-right-layout` 已实现,是 shell 内特设面板,非 pane;
  其配置装载在 `components/logging-config-loader.tsx`。
- 参照实现:`examples/aigc-canvas-agent/web/`(真实业务 UI 推过 iframe 边界的完整样例)。
- 2026-07-30 复核:本 spec 的引用面(Guest SDK / logs 面板 / 示例)未受内核提取波次影响;
  但 `examples/aigc-canvas-agent` 正在 `feat/aigc-canvas-panes-migration` 分支被改动,
  拿它当参照时须确认看的是哪个版本。

## Desired Outcome

- **file_explorer**:浏览会话工作目录子树,展开/折叠、打开文件。
- **code_editor**:查看与编辑文件,写回磁盘,有明确的保存与冲突反馈。
- **logging**:现有 logs 面板转换为内置 pane,能力不回退(命名空间过滤、级别、实时追加等
  按现有面板实际能力对齐),shell 内的旧特设面板随之退役。
- 三者与第三方 pane 同构:同一 iframe guest 车道、同一协议、同一授权路径。

## Approach

逐 pane 实现 guest 侧 UI,数据一律经 `pane-host-capabilities` 授予的能力取得:

1. `file_explorer` 先行(只读能力面,验证通道)。
2. `code_editor` 接写回(引入保存语义与冲突反馈)。
3. `logging` 由现有面板转换 —— 先对齐能力清单,再迁移,最后退役旧面板。

★ **guest 侧必须对通道返回值做运行期校验**。`isolated-panes` Wave 5 已实证:
`guest.query<T>()` 的泛型是**断言不是校验**,route 未声明时宿主会把 404 错误体当正常结果
resolve 回来,直接解构即渲染期崩溃、整个 pane 被卸载。四条通道回来的都是未校验数据。

## Scope

- **In**:三个 pane 的 guest 实现与其 pane 定义;各自的空态/错误态/能力不可用降级;
  guest 侧返回值运行期校验;logging 旧面板的退役与迁移路径;三者的 browser e2e。
- **Out**:browser pane(→ `builtin-pane-browser`);能力面本身(→ `pane-host-capabilities`);
  装载与合并语义(→ `host-builtin-panes`);编辑器的 LSP / 语法诊断 / 多光标等 IDE 级特性
  (第一版明确不做,只做查看+编辑+保存)。

## Boundary Candidates

- 三个 pane 各自独立(可分别交付、分别 review)
- 「旧 logs 面板退役」是独立的迁移项,不能与新 pane 实现混为一谈

## Out of Boundary

- IDE 级编辑体验(LSP、重构、调试)
- 文件的创建/删除/重命名(第一版是否纳入需在 requirements 阶段裁定;倾向不做,写操作面越小
  安全面越小)
- 远程/沙箱会话下的文件访问(能力面已定义为不可用降级,pane 只需正确呈现该降级)

## Upstream / Downstream

- **Upstream**:`pane-host-capabilities`、`host-builtin-panes`、`isolated-panes`
- **Downstream**:无(叶子);但 logging pane 的转换会让 `logs-panel-right-layout` 进入退役态

## Existing Spec Touchpoints

- **Extends**:`logs-panel-right-layout`(其面板被本 spec 转换为 pane 并退役)
- **Adjacent**:`logging-system`(日志数据源与门控,不在此改)、`isolated-panes`(协议)、
  `builtin-pane-browser`(同批内置 pane,共享装载与降级约定)

## Constraints

- ★ **pane 时序问题必须以 browser e2e 为判据**(`isolated-panes` Wave 5 教训)。三个 pane
  各自须有真实浏览器取证,单测绿不构成交付。
- ★ pane 内容要给宿主浮层让位:宿主 `[data-pi-panel-ratio-switch]`
  (`absolute bottom-4 right-4 z-40`)会盖住 pane 右下角动作按钮,实测点击被拦截。
  pane 侧加底部内边距,不改宿主 chrome。
- logging pane 上线前不得删除旧面板;能力对齐取证后方可退役。
- 编辑器组件选型须自包含(生产 CSP 禁 `new Function`/eval —— 见 `webext-runtime-install-csp-eval`
  的历史坑),不得依赖运行期代码构造。
