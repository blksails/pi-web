# Implementation Plan — logs-panel-right-layout

- [x] 1. 根因定位(隔离法)
  - [x] 1.1 隔离确证 LogsPanel-in-aside 为崩溃源(占位 div 替换 → 不崩)
    - 完成态:确认错误栈指向 radix Select(SelectItemText/useComposedRefs),排除 dock ResizeObserver 与纯高度
    - _Requirements: 1.1_

- [x] 2. 核心修复:level 过滤改原生 select
  - [x] 2.1 `logs-panel.tsx`:radix `Select` → 原生 `<select>`(保留 data-pi-logs-level-filter / handleLevelChange);移除未用 radix 导入
    - 完成态:三位置渲染不再 #185;level 切换可用
    - _Requirements: 1.1, 1.2, 4.1, 4.3_

- [x] 3. 右侧布局有界高度
  - [x] 3.1 `pi-chat.tsx`:aside `lg:flex lg:flex-col min-h-0`;right 日志区 `flex min-h-0 flex-1 flex-col overflow-hidden` + `LogsPanel flex-1 min-h-0`
    - 完成态:right 日志面板在固定高度内滚动显示
    - _Requirements: 1.1, 1.3, 4.2_

- [x] 4. 移除临时降级 + 默认还原
  - [x] 4.1 `pi-chat.tsx`:移除 effectiveLogsPosition(right→bottom)与 showLogsRight=false,恢复真实 right 判定
    - 完成态:logsPanelPosition==="right" 真实驱动右侧 aside
    - _Requirements: 2.1, 2.2_
  - [x] 4.2 `logging.ts`:schema 默认还原 committed `"bottom"`
    - 完成态:默认 bottom;right 经配置 opt-in
    - _Requirements: 6.2_

- [x] 5. 测试与回归
  - [x] 5.1 新增 `e2e/browser/logs-panel-right.e2e.ts`:路由 mock 强制 right → 右侧渲染 + 命令面板不崩 + 原生 select + 无 #185
    - 完成态:right e2e 绿
    - _Requirements: 5.1, 1.2, 4.1_
  - [x] 5.2 `logging-system.e2e.ts`:level 过滤交互改原生 selectOption
    - 完成态:不再用 radix trigger.click/option.click
    - _Requirements: 4.3, 5.2_
  - [x] 5.3 回归:slash/unified/plugin e2e 全绿(default bottom);logs 单测绿;app typecheck 0
    - 完成态:无新增回归;logging-system 5 失败经 baseline 取证为 pre-existing harness(logging-demo 浏览器日志在手动 server 不产),非本次引入
    - _Requirements: 3.1, 3.2, 3.3, 5.3_
