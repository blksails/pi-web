# Research Log — webext-empty-state-config

## Discovery Scope
Extension 型特性(在既有 agent-web-extension 5 层定制体系上做最小增量)。已通过代码调查锁定全部消费点,无需外部 Web 研究。

## Key Findings
1. **Tier5 消费惯例在宿主层,不在 PiChat**:`extension.config.theme`/`layout` 由 `components/chat-app.tsx:275,290` 读出并翻译为 `PiChat` 的 `style`/`layout` prop(`narrowLayoutPreset`)。→ 决策:`empty` 同样在 `chat-app.tsx` 翻译,不让 `PiChat` 认 `extension.config`,保持一致与低风险。
2. **append 天然成立**:`packages/react/src/hooks/use-suggestions.ts:45-49` 当前硬编码 `[...fromCommands, ...fromPresets]`,即默认 append。→ 只需为 `prepend`/`replace` 增排序分支,默认路径零行为变更(向后兼容免费)。
3. **建议项已可序列化**:`Suggestion = {id,label,value,mode}` 全为基础类型 → 可直接作为 protocol 层 `EmptySuggestion` schema,并作为 `suggestionsPresets` 透传,无需转换层。
4. **纯声明式加载已支持**:`packages/react/src/web-ext/extension-loader.ts:46-52` 对无 entry 扩展从 `manifest.config` 合成 `WebExtension.config`,`empty` 作为 config 子字段免费可用,零 bundle agent 可配。
5. **既有空状态定制优先级不受影响**:`slots.empty` > `components.EmptyState` > 默认;本特性只新增 title/subtitle/items 的来源,不触碰该链路。

## Design Decisions
- **DD1 消费点选择**:在 `chat-app.tsx`(宿主)消费 `config.empty`,而非在 `PiChat` 内部。理由:对齐 `theme`/`layout`,职责单一,`PiChat` 保持对 extension.config 无感。
- **DD2 合并入参下沉到 hook**:`useSuggestions` 新增 `merge`,而非在 `PiChat`/宿主手算顺序。理由:命令列表在 hook 内异步获取,排序须在能拿到 commands 的位置;也便于单测。
- **DD3 replace 空回落**:`replace` 且配置 starters 为空时回落 commands(而非显示空)。理由:避免误配置导致空状态无任何建议(Req 4.4)。
- **DD4 protocol 独立定义 EmptySuggestion**:protocol 不可依赖 react,故 `EmptySuggestion` 在 protocol 重新定义但字段与 `Suggestion` 对齐;宿主透传时类型相容。

## Synthesis Outcomes
- **Generalization**:无需新组件/新渲染层;复用既有 `Suggestion`/`EmptyState`/`suggestionsPresets`/`emptyTitle`/`emptySubtitle`。
- **Build-vs-adopt**:全部 adopt 既有机制,仅 4 处最小增量(schema/hook/prop/宿主映射)。
- **Simplification**:`append` 复用现状代码路径,默认行为零改动。

## Risks
- **R1**:`merge` 排序若改到默认分支会引入回归 → 缓解:默认 `append` 必须等价现状,单测固定该不变量(Req 6.2)。
- **R2**:protocol 的 `EmptySuggestion` 与 react `Suggestion` 漂移 → 缓解:设计标注两者字段对齐,evolve 时同步;由 traceability 与类型相容性兜底。
