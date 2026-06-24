# Implementation Plan

- [ ] 1. 组件能力扩展(两个独立 boundary,可并行)
- [x] 1.1 (P) 为输入外壳增加命令模式下的 Enter 让位能力
  - 给 `PromptInput` 增加可选的"抑制 Enter 提交"能力:开启时,按 Enter(非 Shift)阻止换行且不触发提交,把 Enter 让给命令浮层选中。
  - Shift+Enter 在抑制开启时仍插入换行而不提交。
  - 未开启或缺省时维持既有提交行为(非空白则提交)。
  - 完成态:`PromptInput` 暴露新可选 prop,单测可验证抑制开启时 Enter 不调用 onSubmit、Shift+Enter 仍换行、缺省时照常提交。
  - _Requirements: 4.1, 4.3, 4.4_
  - _Boundary: PromptInput_

- [x] 1.2 (P) 为命令浮层增加"是否捕获按键"的上报回调
  - 给 `PiCommandPalette` 增加可选回调,在"命令模式开启且过滤后有候选项"这一捕获态发生变化时上报最新布尔值;关闭或无候选时上报 false。
  - 不改动既有的命令模式判定、子串过滤、↑↓/Enter/Esc 导航与 listbox/option ARIA。
  - 完成态:浮层在有候选→true、无候选/关闭→false 时回调一次,单测可验证回调时序与取值。
  - _Requirements: 4.2_
  - _Boundary: PiCommandPalette_

- [ ] 2. 在富聊天装配层接入与协调
- [x] 2.1 接入命令补全浮层并完成触发、导航、选中填充与执行沿用
  - 在 `PiChat` 共享输入区上方以绝对定位叠加渲染命令补全浮层,不占布局流、不顶高输入框;层级取 `z-40`(低于通知浮层 `z-50`、高于内容)使其可见可交互;仅在控制能力可用时渲染。
  - 输入以 "/" 开头进入命令模式;会话就绪后经既有拉取得到候选并按输入过滤展示;复用浮层既有键盘/鼠标导航与 ARIA。
  - 选中命令时把输入框填充为 `"/name "`(命令名后带空格)且不发送;用户补参后按 Enter 正常提交;以 "/" 开头的消息原样发出,不在 web 端解析或展开。
  - 完成态:浏览器中输入 "/" 出现浮层、过滤生效、选中后输入框为 `"/name "` 且消息区无新增;补参 Enter 后完整斜杠文本作为消息发出。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 8.1, 8.2_
  - _Depends: 1.1, 1.2_
  - _Boundary: PiChat_

- [x] 2.2 接入命令模式下的 Enter 让位与降级处理
  - 把浮层上报的捕获态接到输入外壳的"抑制 Enter 提交":命令模式且有候选时 Enter 仅用于选中、不发送;无候选时不抑制,字面量命令照常发出。
  - 控制能力不可用时不渲染浮层且不抛错;拉取失败或命令为空/无匹配时复用浮层既有错误态/空态;错误态或空态下 Esc 退出命令模式。
  - 完成态:命令模式有候选时按 Enter 不发送 `/foo`;控制能力缺失时浮层不渲染且聊天可继续;空/错误态不崩溃。
  - _Requirements: 4.2, 7.1, 7.2, 7.3, 7.4_
  - _Depends: 2.1_
  - _Boundary: PiChat_

- [x] 2.3 会话态退化建议气泡,保留空会话引导与命令拉取
  - 会话进行中(已有消息)不再渲染既有"建议气泡"(方案 A),命令补全交由浮层;空会话仍展示建议网格(命令∪预设,或回落 starter)。
  - 会话就绪后仍拉取一次命令,供浮层与空态建议同源使用。
  - 完成态:空态可见建议网格;发出一条消息进入会话态后不再渲染建议气泡;命令拉取不因退化而停止。
  - _Requirements: 5.1, 5.2, 5.3_
  - _Depends: 2.1_
  - _Boundary: PiChat_

- [ ] 3. 校验
- [x] 3.1 单元/集成测试
  - 输入外壳:抑制开启时 Enter 不提交、Shift+Enter 换行、缺省照常提交。
  - 命令浮层:捕获态回调在有候选→true、无候选/关闭→false。
  - 装配集成:控制能力不可用时不渲染浮层;会话态不渲染建议气泡、空态渲染网格;命令模式时输入外壳收到抑制开启。
  - 完成态:相关 Vitest 用例通过,`pnpm test:app` 与包级 `pnpm -r run test` 绿。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 7.1_

- [x] 3.2 Playwright 端到端测试
  - 斜杠补全主路径:输入 "/" 弹层、过滤、↑↓ 改高亮、Enter 选中后输入框为 `"/name "` 且未发送。
  - Enter 让位:命令模式有候选时 Enter 不发送 `/foo`;补参后 Enter 正常发出完整斜杠文本。
  - Esc 关闭浮层并退出命令模式;方案 A 退化:空态有网格、会话态无气泡;降级:无命令时空态不崩溃、聊天可继续。
  - 复用 `PI_WEB_STUB_AGENT` 桩与 `examples/hello-agent` 源经 `startSession` 建会话;本机 dev 运行时不跑 `next build`。
  - 完成态:新增 e2e 规约通过,既有 `e2e/browser/rich-chat.e2e.ts` 不回归。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 4.2, 5.1, 5.2, 6.1, 6.2, 7.2, 7.3, 8.1_
  - _Depends: 2.1, 2.2, 2.3_

## Implementation Notes
- 2.1:本特性与并行特性 `extension-ui-inline-interaction`(`PiPermissionDialog`→`PiInteraction` 重命名)共享 `pi-chat.tsx` 工作树。该重构遗漏了 `packages/ui/src/index.ts` 的 `PiInteraction` 顶层导出,致 `@blksails/ui` typecheck/测试一度 RED;已按用户指向(`ui.PiInteraction`)补上该导出使包恢复绿色(221/221)。重构文件(`index.ts`、`pi-chat-basic.tsx`、`elements/pi-interaction.tsx`)属并行特性、未纳入本 spec 的任务提交,由其所有者提交。
