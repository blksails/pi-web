# Implementation Plan

- [x] 1. 富版 PiChat 接入内核自有用量区
- [x] 1.1 在 `pi-chat.tsx` 新增 `showSessionStats` prop 并挂载 `PiSessionStats`
  - 在 `PiChatProps` 增加可选字段 `readonly showSessionStats?: boolean`（默认 `true`）。
  - `import { PiSessionStats } from "../controls/pi-session-stats.js";`。
  - 在主列 `conversationBody`（`isEmpty ? welcome : conversationBody` 块）之后、`<ExtSlotRegion ... slot="artifactSurface" />`（`:904`）之前，插入内核自有用量区：当 `showSessionStats !== false && controls !== undefined` 时渲染 `<div data-pi-session-stats-region><PiSessionStats controls={controls} /></div>`；否则不渲染。
  - 不经 `ExtSlotRegion`、不进 `panelRight`/`aside`；作为 `conversationBody` 的兄弟块级元素插入（不进入底部输入 dock）。
  - 观察完成：富版 `PiChat`（提供 `controls`）渲染出 `[data-pi-session-stats-region]` 且其内含 `[data-pi-session-stats]`；`showSessionStats={false}` 时该区不在 DOM。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2, 4.3, 5.1, 5.2, 5.3_
  - _Boundary: Rich PiChat 用量状态区_

- [x] 2. 组件测试
- [x] 2.1 新增 `packages/ui/test/chat/pi-chat-session-stats.test.tsx`
  - 用例 A：富版 `PiChat`（mock `controls.stats`）渲染 `[data-pi-session-stats-region]`、`[data-pi-session-stats]`，四个 `[data-pi-stat="messages|toolCalls|tokens|cost"]` 值与 mock 一致；cost 为 `$` 货币格式。
  - 用例 B：`showSessionStats={false}` 时不渲染用量区。
  - 用例 C：`controls.stats === undefined` 时渲染空态「No stats yet」。
  - 用例 D：传入声明了 `statusBar` slot 的 `extension` 时，`[data-pi-ext-status-bar]` 与 `[data-pi-session-stats]` **同时存在**（并存不顶替）。
  - 用例 E：用量区不出现在 `[data-pi-chat-aside]`（panelRight）内。
  - 观察完成：`vitest run` 跑该文件 5 个用例全绿。
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 3.2, 4.1, 4.3_
  - _Boundary: Rich PiChat 用量状态区, PiSessionStats_
  - _Depends: 1.1_

- [x] 3. 浏览器 e2e（隔离 build）
- [x] 3.1 新增 `e2e/browser/session-usage-panel.e2e.ts`
  - 沿用既有骨架（`PI_WEB_STUB_AGENT=1`、`startSession` 选 `./examples/hello-agent` → 进入会话）。
  - 断言 1：会话激活后 `[data-pi-session-stats]` 可见，四项 `[data-pi-stat]` 字段存在（渲染 + 字段）。
  - 断言 2：发送一次 prompt 并完成一轮回复后，用量字段（tokens/messages 等）随 `stats` 刷新为更新值（实时刷新）。
  - 观察完成：`NEXT_DIST_DIR=.next-e2e` + external server 模式下 `playwright test e2e/browser/session-usage-panel.e2e.ts` 通过。
  - _Requirements: 1.1, 2.1, 3.1, 6.2, 6.3_
  - _Depends: 1.1_

- [x]* 3.2 e2e 并存校验（webext statusBar 与用量区并存）
  - 在存在 `statusBar` 贡献的 agent 源/或注入扩展场景下，断言 `[data-pi-ext-status-bar]` 与 `[data-pi-session-stats]` 并存。
  - 若现有 e2e fixture 无 statusBar 贡献源，则以组件测试用例 D 覆盖此项并在本任务标注说明（避免新建 fixture 过度扩张）。
  - _Requirements: 4.1_
  - _Depends: 3.1_

- [x] 4. 验收与新鲜证据
- [x] 4.1 运行单测 + e2e，收集验收证据
  - 跑 `pnpm --filter @blksails/ui test`（或等价）确认组件测试通过；跑隔离 build e2e 确认 3.1 通过。
  - 不在 dev 运行时执行 `next build`（隔离 build 用 `.next-e2e`，避免污染共享 `.next`）。
  - 观察完成：贴出 vitest 与 playwright 的实际通过输出（新鲜证据），参照 `kiro-verify-completion`。
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Depends: 2.1, 3.1_
