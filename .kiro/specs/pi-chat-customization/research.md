# Research & Design Decisions

## Summary
- **Feature**: `pi-chat-customization`
- **Discovery Scope**: Extension(对既有 `packages/ui` 的 `PiChat` 装配层做非破坏式扩展)
- **Key Findings**:
  - `PiChat`(`packages/ui/src/chat/pi-chat.tsx`)已把所有元件以**确定的 props 接线**装配好(Attachments/ModelSelector/SpeechInput/WebSearchToggle/SubmitButton/Message/Suggestions/PromptInput);"细粒度覆盖"的本质就是**用相同 props 契约替换实现**,无需新增数据流。
  - 外观底座已是 shadcn CSS 变量 + `tailwind.config.ts` 的 `theme.extend` 映射;缺的是 ThemeProvider 运行时(明暗/跟随系统)与 preset 导出。无需引入 `next-themes`(包不应绑定 Next)。
  - 现有 `slots`(header/footer/sidebar/messageActions)与三个注册表是稳定扩展点;新增能力应与之**同构、共存、可选**,默认缺省即等于旧行为。
  - 图标全部硬编码 `lucide-react`(分散在各 element);可替换性应通过 React context + `useIcon(name, fallback)` 注入,默认回退到既有 lucide,保证非破坏。
  - 测试落点:`packages/ui` 用 vitest + @testing-library/react + jsdom(组件/集成测,已有 `test/elements`、`test/chat`);浏览器 e2e 用根层 playwright(隔离 build:`NEXT_DIST_DIR=.next-e2e` + external server)。

## Research Log

### 现有定制点与接线
- **Context**: 判定"细粒度覆盖"需要多少新数据流。
- **Sources Consulted**: `packages/ui/src/chat/pi-chat.tsx`(L388-437 toolbar/promptInput 装配、L555-620 会话态消息渲染、L518-552 空态)、`packages/ui/src/chat/slots.ts`。
- **Findings**:
  - 各控件 props 已固定:`Attachments{variant,items,supported,onAdd,onRemove,rejected}`、`ModelSelector{groups,current,available,onOpen,onSelect}`、`SpeechInput{onTranscript}`、`WebSearchToggle{enabled,onToggle}`、`SubmitButton{status,canSubmit,onSubmit,onStop}`、`Message{role,copyText,branch,onPrev,onNext,children}`、`Suggestions{items,layout,onFill,onSend}`。
  - DOM 钩子:`data-pi-chat-pro`、`data-pi-chat-empty`、`data-pi-chat-welcome`、`data-pi-chat-messages`、`data-pi-input-dock`(e2e/断言选择器)。
- **Implications**: 覆盖契约 = 复用既有 element 的 props 类型;PiChat 在装配点做 `slots > components > 默认` 解析,不改任何 hook 接线。

### 主题与 preset
- **Context**: R2/R3 需要运行时明暗切换与一行接入。
- **Findings**: `tailwind.config.ts` 用 `darkMode:"class"` + `colors` 映射 `hsl(var(--*))`;`styles.css` 提供 `:root` 与 `.dark` 两套令牌。运行时只需切换 `<html>.dark` 并在 `system` 下监听 `matchMedia("(prefers-color-scheme: dark)")`。
- **Implications**: 自建轻量 `ThemeProvider`(约 50 行)即可;`theme.extend` 抽到 `tailwind-preset` 导出,现有 config 改为 `presets:[piWebPreset]`(非破坏)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 组件覆盖映射(选定) | `components` 映射表 + `resolveComponent` 优先级解析,复用 element props 契约 | 改动小、与现有 slots/注册表同构、默认非破坏、可测 | 覆盖组件须遵守 props 契约 | 主力机制 |
| 全量 headless 重构 | 暴露全部子组件让宿主自行装配 | 上限最高 | 破坏现有 API、工作量大、超出本期边界 | 拒绝(超范围) |
| 引入 next-themes | 用社区库做主题 | 省实现 | 绑定 Next、与包无关依赖、SSR 约束 | 拒绝(自建更轻) |
| 图标 context 注入(选定) | `IconsProvider` + `useIcon(name, fallback)` | 非破坏、默认回退 lucide | 需逐个 element 接 `useIcon` | 主力机制 |

## Design Decisions

### Decision: 细粒度覆盖采用"同 props 契约替换"而非新数据流
- **Selected Approach**: 定义 `ComponentOverrides` 映射(key=组件位名,value=替换组件,其 props 类型 = 对应默认 element 的 props)。PiChat 在每个装配点用 `resolveComponent(slots, components, key, Default)` 取实现。
- **Rationale**: 现有装配已提供全部接线,覆盖只换"长相";复用既有 props 类型保证类型安全且零接线改动。
- **Trade-offs**: 覆盖者须实现既有 props 契约(以导出的 props 类型约束);换来零运行时风险与可预测优先级。

### Decision: `slots > components > 默认` 的统一解析
- **Selected Approach**: 整块 slot 命中即整块替换;否则查 components 覆盖;否则默认实现。对 Message 按 role 子映射解析。
- **Rationale**: 满足 R9 的确定优先级,且兼容既有 `slots`。

### Decision: 主题自建轻量 ThemeProvider,令牌 preset 导出
- **Selected Approach**: `ThemeProvider{mode:"light"|"dark"|"system"}` 管理 `<html>.dark`;`system` 监听 `matchMedia` 并随变化更新。`@blksails/ui/tailwind-preset` 导出 `theme.extend`。
- **Rationale**: 不绑定框架、最小依赖、与 `settings.theme` 三值语义一致。

### Decision: 图标经 context 注入,默认回退既有 lucide
- **Selected Approach**: `IconTheme = Partial<Record<IconSlot, ComponentType<IconProps>>>`;`useIcon(slot, FallbackLucide)`;各 element 改用 `useIcon`。`icons` prop 经 `IconsProvider` 下发。
- **Rationale**: 非破坏(缺省=lucide)、集中替换、保持尺寸/可访问性约束。

### Decision: layout 仅做预设枚举,不开放任意 grid template
- **Selected Approach**: `layout: "centered"|"wide"|"full"|"split"` → 映射到容器/消息区 className;`split` 划出让位区由现有 slots/children 承接。
- **Rationale**: 满足 R7 且不引入超范围的自定义骨架;Artifact 专属功能本期 out of boundary。

## Risks & Mitigations
- 图标改造面分散在多个 element —— 用 `useIcon(slot, fallback)`,缺省回退既有 lucide,逐个迁移且单测护栏,确保非破坏。
- 覆盖组件违反 props 契约 —— 导出各覆盖位的 props 类型作为公共契约,类型层强约束。
- 主题在 SSR/首帧闪烁(FOUC)—— ThemeProvider 在挂载即应用;`system` 用 `matchMedia`;首帧策略在实现说明中标注(可由宿主在 `<head>` 内联脚本预置 class,非本期强制)。
- 向后兼容回归 —— 新增入口全可选;增加"无新增入口即等于旧行为"的回归测试(R10.5)。

## References
- `packages/ui/src/chat/pi-chat.tsx` — 现有装配与接线基准
- `packages/ui/tailwind.config.ts`、`packages/ui/src/styles.css` — 令牌底座
- memory `pi-web-e2e-isolated-build` — 浏览器 e2e 隔离 build 运行法
