# Research & Design Decisions

## Summary
- **Feature**: `slash-command-palette`
- **Discovery Scope**: Extension(接线已实现但未装配的组件)
- **Key Findings**:
  - `PiCommandPalette` 已完整实现 "/" 补全(过滤/键盘/ARIA/空错态)并从 `@blksails/pi-web-ui` 导出,但 grep 全仓零装配——是"建好未接线"的孤儿组件。
  - Enter 双触发的根因是 React 事件挂载层级:textarea 的 `onKeyDown`(React root)先于 palette 的 `document` 监听执行,palette 的 `preventDefault` 救不回已发出的提交。
  - 现有 e2e「Req 10.2 建议气泡」测的是**空态**网格(`startSession` 后无消息),故移除会话态紧凑气泡不破坏它。

## Research Log

### PiCommandPalette 现状与装配缺口
- **Context**: 判断该新建组件还是复用既有。
- **Sources Consulted**: `packages/ui/src/controls/pi-command-palette.tsx`、`packages/ui/src/index.ts:53`、`grep -rn CommandPalette`(零装配)、`packages/ui/test/controls/pi-command-palette.test.tsx`。
- **Findings**: 组件功能完备且有单测;`onChange("/name ")` 仅填充、`onSubmit` 可选;经 `document` keydown 捕获 ↑↓/Enter/Esc。
- **Implications**: 复用,不重写;装配落在 `pi-chat.tsx`,仅加一个 additive 回调以支持精确 Enter 让位。

### Enter 双触发根因
- **Context**: R4 要求命令模式 Enter 只用于选中,不能把 `/foo` 误发。
- **Sources Consulted**: `prompt-input.tsx` `handleKeyDown`、`pi-command-palette.tsx` 的 `document.addEventListener("keydown")`、React 事件委托模型。
- **Findings**: React 18/19 将合成事件挂在 root 容器(document 之下),冒泡顺序使 `PromptInput.onSubmit` 先于 palette 的 `preventDefault` 执行。
- **Implications**: 必须在 `PromptInput` 源头按 `suppressEnterSubmit` 拦截,而非依赖 palette 的 `preventDefault`。

### 方案 A(建议气泡)退化的影响面
- **Context**: 决策"B 做补全 / A 退化空态",需评估对 rich-chat-ui Req 10 与现有测试的影响。
- **Sources Consulted**: `pi-chat.tsx:491`(空态网格)/`:564`(会话态气泡)、`e2e/browser/rich-chat.e2e.ts:123`(Req 10.2)。
- **Findings**: Req 10.2 e2e 在 `startSession` 后即断言(空态),命中空态网格;会话态气泡无独立断言。
- **Implications**: 移除会话态气泡安全;在 Boundary Commitments 记为对 rich-chat-ui Req 10 会话态观感的**有意取代**(Revalidation Trigger)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | Notes |
|--------|-------------|-----------|-------|-------|
| 装配层协调 + 受控单源(选定) | PiChat 持有 input/suppress 状态,palette 经 onCaptureChange 上报捕获态 | 命令模式判定单源,Enter 让位精确,palette 不重写 | 给 palette 加一个 additive prop | 与现有受控装配一致 |
| PiChat 自行复算过滤 | PiChat 用 controls.commands 复制 includes 过滤判断候选数 | 不改 palette | 过滤逻辑两处易发散 | 否决 |
| 全量抑制(只看 startsWith("/")) | 命令模式一律抑制 Enter | 最简 | 无候选时 Enter 成死键 | 否决,违反 R4.2 "有候选" |

## Design Decisions

### Decision: 用 `suppressEnterSubmit` 而非依赖 palette 的 preventDefault
- **Context**: 阻止命令模式下 `/foo` 被误发。
- **Alternatives Considered**: 1) 仅靠 palette `document` 监听 `preventDefault`(被 React 顺序击穿);2) 把 palette 键盘逻辑改为 capture 阶段(侵入大)。
- **Selected Approach**: `PromptInput` 新增 `suppressEnterSubmit`,装配层在"命令模式且有候选"时置真。
- **Rationale**: 从提交源头拦截,最小侵入,可单测。
- **Trade-offs**: 需在 PiChat 与 palette 间传一个捕获态信号(`onCaptureChange`)。
- **Follow-up**: e2e 验证 Enter 选中不发送、无候选时字面量正常发出。

### Decision: 浮层 `absolute bottom-full` 叠加于共享 inputWithWidgets
- **Context**: R6 不顶高输入框;空态与会话态共用输入片段。
- **Selected Approach**: 在共享 `inputWithWidgets` 外包 `relative` 容器,palette `absolute bottom-full` + `z`,仅 `controls!==undefined` 时渲染。
- **Rationale**: 一处接线覆盖两分支;不占布局流。
- **Trade-offs**: 浮层在视口顶部附近时可能上溢——当前输入框置底/居中,向上展开空间充足,暂不处理翻转。

## Risks & Mitigations
- 事件顺序在不同 React 版本变化 → 以 `suppressEnterSubmit` 单测锁定行为,不依赖隐式顺序。
- 移除会话态气泡引发 rich-chat-ui 回归 → 已核验无独立断言;记为 Revalidation Trigger。
- 浮层与通知浮层 z 冲突 → 通知层 `z-50`,palette 取低于它但高于内容的层级。

## References
- `packages/ui/src/controls/pi-command-palette.tsx` — 复用的浮层组件
- `packages/ui/src/chat/pi-chat.tsx` — 装配点(:409 inputWithWidgets, :491/:564 suggestions)
- `packages/ui/src/elements/prompt-input.tsx` — Enter 提交逻辑
- `e2e/browser/rich-chat.e2e.ts` — 现有富聊天 e2e(Req 10.2 空态建议)
