# Research Log — tool-call-ui-redesign

## Discovery Scope
Extension（对现有系统的扩展）→ light discovery。聚焦集成点、既有模式、兼容性。代码库探索已在前序对话中完成，本日志固化关键发现与决策。

## Key Findings（代码库现状，含路径:行号）

### 工具卡渲染
- `packages/ui/src/parts/pi-tool-part.tsx`：单体 `PiToolPart`。
  - `ToolPart` 类型（19-21）：`Extract<AnyPart, {type: \`tool-${string}\`}> | Extract<AnyPart, {type:"dynamic-tool"}>`。
  - `phaseOf`（38-50）：`input-streaming`/`input-available`→`start`；`output-error`→`error`；`output-available`+`preliminary===true`→`update`，否则→`end`。
  - `PHASE_LABEL`（62-67）：start=Running / update=Streaming / end=Completed / error=Error。
  - 现状：`defaultOpen=true` 恒展开；input/output 经 `JSON.stringify` 进 `<pre>`，无高亮。
  - data 属性：根 `data-pi-tool` / `data-pi-tool-phase` / `data-pi-tool-name`；徽章 `data-pi-tool-status`；明细 `data-pi-tool-detail`。
  - 无障碍：折叠按钮 `aria-expanded` + `aria-controls`（指向 `useId()` 内容区）。

### Part 分派
- `packages/ui/src/chat/part-renderer.tsx`：
  - `isToolPart`（39-41）：`type.startsWith("tool-") || type === "dynamic-tool"`。
  - `toolNameOf`（49-52）：`dynamic-tool`→`toolName`，静态→去 `tool-` 前缀。
  - 工具分派（91-96）：`registry.resolveToolRenderer(name) ?? PiToolPart`。
  - **未消费 `componentOverrides`**（当前工具分派无 overrides 入口）。

### 渲染器注册表
- `packages/ui/src/registry/renderer-registry.ts`：
  - `ToolRenderer = ComponentType<{ part: ToolPart; message: UIMessage }>`（23-26）。
  - 按 `toolName` + `extId` 命名空间注册；解析优先级：扩展逆序 → 宿主默认（extId="")→ undefined。

### 定制层
- `packages/ui/src/customization/component-overrides.ts`：`ComponentOverrides` 含 SubmitButton/Message/Markdown/Reasoning/… **不含工具卡**。
- `resolveComponent` 模式：`customization/resolve-component.ts`（宿主覆盖优先于默认）。

### webext
- `packages/ui/src/web-ext/apply-extension.tsx`（20-39）：`applyExtensionRenderers` 将 `ext.renderers.tools` 逐项 `registry.registerToolRenderer(name, comp, extId)`。整卡替换链路。

### 富渲染底座（关键：零新依赖）
- `packages/ui/src/ui/response.tsx`：`Response` = `<Streamdown>`，streamdown 依赖内置 shiki（`node_modules/streamdown/dist/index.d.ts` 含 `BundledTheme`/`shikiTheme`）。
  - 结论：input JSON 高亮可用 `Response` 渲染 ```` ```json ```` 代码块；output 富渲染可用 `Response` 直接渲染 markdown/代码。无需引入 shiki/prism。

## Design Decisions
1. **复合化但内聚单文件**：`ToolHeader`/`ToolContent`/`ToolInput`/`ToolOutput` 与 `PiToolPart` 同置 `pi-tool-part.tsx`，避免新增文件碎片；包根 `index.ts` 统一导出。理由：子件契约简单、共享 phase 推导与 data 属性，拆多文件收益低、回归面大。
2. **展开策略下沉到 `PiToolPart`**：`defaultOpen` 由 `defaultOpen ?? (phase==='end'||phase==='error')` 推导。显式传入覆盖。
3. **新增 `ComponentOverrides.ToolPart`**：契约 = `ComponentType<PiToolPartProps>`。`PartRenderer` 工具分派改为三级：`resolveToolRenderer(name)` → `componentOverrides?.ToolPart` → `PiToolPart`。
4. **input 高亮经 Response**：`ToolInput` 把入参 `JSON.stringify` 包入 ```` ```json fenced block 交给 `Response`。回退：序列化失败用纯文本。
5. **output 富渲染**：`ToolOutput` 接受 `output?: React.ReactNode`；为节点则直接渲染；为字符串/数据则经 `Response` 或 JSON 序列化。`PiToolPart` 装配时把 `part.output` 转成默认渲染节点传入。

## Synthesis Outcomes
- **Build-vs-adopt**：富渲染**复用** `Response`（adopt），不新建高亮组件。
- **Simplification**：复合子件**不**拆多文件（同文件多导出），降低回归与 import 改动面。
- **Boundary**：数据来源不动（仅 message parts）；~~`data-pi-tool-partial` 割裂不修~~（**已于 2026-06-20 后续改动修复**：partial 改走 `tool-output-available` preliminary 喂同卡,`data-pi-tool-partial` part 已移除；详见 design.md Non-Goals）；`isToolPart` 判别不动。

## R4 — Response/streamdown 对 JSON 代码块异步高亮（实测证据）
探针（jsdom + vitest，`packages/ui/src/ui/response.tsx`）：
- 纯文本：`<Response>hello world</Response>` → 同步 `textContent === "hello world"`。
- JSON 代码块：`<Response>{"```json\n{...}\n```"}</Response>` → 同步 `textContent === ""`；`waitFor`（~2s）后才得 `"json{  \"q\": \"pi\"}"`（带语言前缀、缩进/换行被压缩）。
结论：shiki 高亮**异步**且破坏文本格式 → 工具入参/数据型输出**不**用 Response，改用同步 `<pre><code class="language-json">` 代码块（保留缩进、textContent 可断言、可访问、无闪烁、零依赖）。字符串型输出仍用 Response 富渲染。
影响需求 4.1 / 4.2 措辞与 ToolInput/ToolOutput 默认实现（已更新）。

## Risks / Triggers
- **R1 展开策略变更**：从恒展开改为按状态，可能影响断言「明细默认可见」的既有单测/e2e → 需审查并同步更新测试（不削弱断言）。
- **R2 data 属性回归**：复合化后须保证根/徽章/明细 data 属性位置不变。
- **R3 优先级歧义**：registry 与 overrides 同时存在时以 registry 胜出，须有单测覆盖。
- **Revalidation trigger**：若未来 `ToolRenderer` 契约（part/message）或 `ComponentOverrides` 形状变化，consumers（webext、宿主）需重校。
