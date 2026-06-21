# Implementation Plan

- [x] 1. ChatApp 同源重建 + SessionView 顶栏按钮
- [x] 1.1 实现同源新建(key-remount)与「切换源」按钮(`components/chat-app.tsx`)
  - `ChatApp`:新增 `const [nonce, setNonce] = React.useState(0)`。
  - 新增 `onNewByAgentSource`:`setSession((s) => s === undefined ? s : { create: s.create })`(丢 resumeId、保留 source)+ `setNonce((n) => n + 1)`。
  - 渲染 `SessionView` 时传 `key={\`${session.create.source}#${nonce}\`}` 与 `onNewByAgentSource`。
  - `SessionView`:props 增加 `readonly onNewByAgentSource: () => void`;顶栏 "New session" 按钮 `onClick` 由 `onReset` 改为 `onNewByAgentSource`,加 `data-new-session`;新增「切换源」按钮 `onClick={onReset}`,加 `data-switch-source`。
  - 错误态"重新选择源"入口(`:253-260`)保持 `onClick={onReset}` 不变。
  - 观察完成:活动会话点 "New session" 仍停留会话(不回选择器)且 SessionView 以新 key 重挂;点「切换源」回到 `AgentSourcePicker`;`tsc --noEmit` 通过。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_
  - _Boundary: ChatApp 同源重建, SessionView 顶栏按钮_

- [x] 2. 组件测试
- [x] 2.1 扩展 `test/chat-app.test.tsx`
  - 用例:活动会话点击 `[data-switch-source]` → 渲染 `[data-agent-source-picker]`(且 `[data-session-active]` 消失)(2.1/2.2)。
  - 用例:活动会话点击 `[data-new-session]` → 仍在会话(`[data-agent-source-picker]` 不出现、`[data-session-active]` 仍在),不回选择器(1.1)。
  - 观察完成:`vitest run test/chat-app.test.tsx` 全绿。
  - _Requirements: 1.1, 2.1, 2.2_
  - _Depends: 1.1_

- [x] 3. 浏览器 e2e(隔离 build)
- [x] 3.1 新增 `e2e/browser/new-by-agent-source.e2e.ts`
  - 沿用既有骨架(`PI_WEB_STUB_AGENT=1`、选 `./examples/hello-agent` 进入会话)。
  - 断言:记录当前 `[data-session-id]`;点 `[data-new-session]` → `[data-session-id]` 变为新 id(≠原)、URL 为 `/session/:newId`、可再发一轮 prompt 得到回复(1.1/1.2/1.3/1.4)。
  - 断言:点 `[data-switch-source]` → `[data-agent-source-picker]` 出现(2.1/2.2)。
  - 观察完成:`NEXT_DIST_DIR=.next-e2e` + external server 模式下 `playwright test e2e/browser/new-by-agent-source.e2e.ts` 通过。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 4.2, 4.3_
  - _Depends: 1.1_

- [x] 4. 验收与新鲜证据
- [x] 4.1 运行组件测试 + e2e,收集验收证据
  - 跑 `test/chat-app.test.tsx`(app 包)与隔离 build e2e;不在 dev 运行时执行 `next build`(用 `.next-e2e`)。
  - 观察完成:贴出 vitest 与 playwright 实际通过输出(新鲜证据),参照 `kiro-verify-completion`。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 2.1, 3.1_
