# Requirements Document

## Introduction
本特性重构 `@pi-web/ui` 的工具调用渲染层 `PiToolPart`，参考 AI SDK Elements `Tool` 组件设计，将其由单体卡片复合化为一组可装配、可独立替换的子组件，并对齐参考视觉（状态徽章、按状态展开、输入语法高亮、输出富渲染）。同时为宿主与 web 扩展（webext）新增更细的定制入口，但严格保留既有的数据属性契约、流式态语义、渲染器注册回退链与无障碍能力，确保现有单测与浏览器 e2e 不回归。

本特性面向两类使用者：**最终用户**（在会话中看到工具调用卡片）与**集成开发者**（宿主应用作者、agent source 的 `.pi/web` 扩展作者），后者需要按工具名或整体替换工具卡渲染。

## Boundary Context
- **In scope**：`PiToolPart` 复合化与子组件公开导出；状态徽章 4 态渲染；按状态的默认展开/折叠策略；输入 JSON 语法高亮与输出富渲染（复用既有 `Response`）；新增 `ComponentOverrides.ToolPart` 宿主覆盖入口；`PartRenderer` 的工具渲染器解析优先级；保留全部 data 属性、流式态、注册回退链、无障碍；单测与一条浏览器 e2e 验收。
- **Out of scope**：工具调用数据来源改造（数据仅来自 message parts，不引入 RPC 拉取）；`data-pi-tool-partial` 自定义 part 与 `PiToolPart` 之间既有的消费割裂；协议层 `tool-*` chunk schema；`PartRenderer` 中 `isToolPart` 的 part 判别规则；webext 子部件级注入（仅替换 `ToolOutput` 等单个子件）。
- **Adjacent expectations**：依赖既有 `RendererRegistry`（按 toolName 覆盖 + extId 命名空间隔离）、webext `applyExtensionRenderers`（`renderers.tools` 整卡替换）、`Response`（streamdown + 内置 shiki 高亮）保持现有契约不变；本特性不拥有这些模块的内部实现，只复用其公开能力。

## Requirements

### Requirement 1: 复合子组件 API
**Objective:** 作为集成开发者，我想要工具卡由可装配的子组件构成，以便我能复用折叠壳、仅替换其中某一部分或自行组合布局。

#### Acceptance Criteria
1. The 工具卡渲染层 shall 导出 `ToolHeader`、`ToolContent`、`ToolInput`、`ToolOutput` 四个子组件及其 props 类型。
2. The `PiToolPart` shall 作为装配壳，由上述子组件组合而成，并保持其对外 props（`part`、`message?`、`defaultOpen?`、`className?`）向后兼容。
3. When 集成开发者从 `@pi-web/ui` 包根导入，the 包导出面 shall 暴露这些子组件与 `PiToolPart`，且不破坏既有 `PiToolPart` / `ToolPart` / `PiToolPartProps` 导出。
4. Where 子组件被单独使用，the 子组件 shall 在缺省装配壳的情况下也能独立渲染其负责的区域（头部 / 内容容器 / 输入 / 输出）。

### Requirement 2: 状态徽章与流式态渲染
**Objective:** 作为最终用户，我想要工具卡清晰展示当前执行状态，以便我知道工具是在运行、流式输出、已完成还是出错。

#### Acceptance Criteria
1. While 工具 part 处于 `input-streaming` 或 `input-available` 状态，the `ToolHeader` shall 显示 "Running" 徽章并将 phase 标记为 `start`。
2. While 工具 part 处于 `output-available` 且 `preliminary === true`，the `ToolHeader` shall 显示 "Streaming" 徽章并附带旋转加载图标（Loader2），phase 标记为 `update`。
3. When 工具 part 进入 `output-available` 终态（非 preliminary），the `ToolHeader` shall 显示 "Completed" 徽章，phase 标记为 `end`。
4. If 工具 part 处于 `output-error` 状态，then the 工具卡 shall 显示 "Error" 徽章并应用 destructive 配色，phase 标记为 `error`。
5. The `ToolHeader` shall 显示工具名（`dynamic-tool` 取 `toolName`，静态取 `tool-` 前缀之后的部分）。

### Requirement 3: 按状态的默认展开策略
**Objective:** 作为最终用户，我想要已完成或出错的工具卡默认展开、运行中的默认折叠，以便我聚焦于需要查看的结果而不被进行中的噪声干扰。

#### Acceptance Criteria
1. When 工具 part 处于 `output-available` 终态或 `output-error` 状态且调用方未显式传入 `defaultOpen`，the 工具卡 shall 默认展开明细区。
2. While 工具 part 处于 `start` 或 `update` 状态且调用方未显式传入 `defaultOpen`，the 工具卡 shall 默认折叠明细区。
3. Where 调用方显式传入 `defaultOpen`，the 工具卡 shall 以该显式值作为初始展开状态，覆盖按状态推导的默认值。
4. When 用户点击头部折叠触发器，the 工具卡 shall 切换明细区的展开/折叠并更新 `aria-expanded`。

### Requirement 4: 输入与输出内容呈现
**Objective:** 作为最终用户，我想要工具入参以可读的语法高亮展示、输出支持富文本渲染，以便我更容易理解工具的输入与结果。

#### Acceptance Criteria
1. While 工具 part 处于 `start` 态，the `ToolInput` shall 以同步 JSON 代码块呈现入参：保留缩进与完整文本，并对 key/string/number/bool/null 做轻量 token 高亮（`<span>` + 主题色变量 `--pi-json-*`，亮暗适配），配 muted 背景的代码块外观，不引入新依赖。
2. The `ToolOutput` shall 接受 `React.ReactNode` 形式的 `output`，在未提供自定义节点时按内容类型默认渲染：字符串型经 `Response` 富渲染（markdown），数据型（对象/数组）以同步 JSON 代码块呈现。
3. If 工具 part 处于 `output-error` 态，then the `ToolOutput` shall 渲染 `errorText` 并应用 destructive 文字配色。
4. When `output` 为非字符串值（对象/数组），the `ToolOutput` 默认渲染 shall 以 JSON 形式安全序列化后呈现，序列化失败时回退为字符串表示。

### Requirement 5: 渲染器解析优先级与宿主覆盖
**Objective:** 作为集成开发者，我想要既能按工具名注册渲染器、也能整体替换默认工具卡，并有明确的优先级，以便定制不产生歧义。

#### Acceptance Criteria
1. The customization 契约 shall 在 `ComponentOverrides` 中新增可选 `ToolPart` 覆盖项，其组件契约与 `PiToolPartProps` 同构。
2. When `PartRenderer` 渲染一个工具 part，the `PartRenderer` shall 按优先级解析渲染器：先 `RendererRegistry.resolveToolRenderer(toolName)`，否则 `componentOverrides.ToolPart`，否则默认 `PiToolPart`。
3. Where 某工具名已在 `RendererRegistry` 注册渲染器，the `PartRenderer` shall 使用该注册渲染器，即使同时存在 `componentOverrides.ToolPart`。
4. Where 未注册按工具名渲染器但提供了 `componentOverrides.ToolPart`，the `PartRenderer` shall 使用 `componentOverrides.ToolPart` 替代默认 `PiToolPart`。

### Requirement 6: webext 扩展兼容
**Objective:** 作为 agent source 的 `.pi/web` 扩展作者，我想要既有的整卡替换能力在重构后继续可用，以便我的扩展不被破坏。

#### Acceptance Criteria
1. The 工具渲染器注册机制 shall 保持 `RendererRegistry` 按 `toolName` 注册、`extId` 命名空间隔离、未命中回退的语义不变。
2. When webext 通过 `renderers.tools` 声明工具渲染器并经 `applyExtensionRenderers` 应用，the `PartRenderer` shall 对相应工具名使用该扩展渲染器进行整卡替换。
3. The 扩展渲染器优先级 shall 高于 `componentOverrides.ToolPart` 与默认 `PiToolPart`。

### Requirement 7: 兼容性与可访问性回归不变量
**Objective:** 作为维护者，我想要重构保留既有数据属性与无障碍能力，以便现有单测、浏览器 e2e 与辅助技术不回归。

#### Acceptance Criteria
1. The 工具卡 shall 在根元素上保留 `data-pi-tool`、`data-pi-tool-phase`、`data-pi-tool-name` 属性，且 `data-pi-tool-phase` 取值仍为 `start` / `update` / `end` / `error` 之一。
2. The 工具卡 shall 保留状态徽章容器的 `data-pi-tool-status` 属性与明细区的 `data-pi-tool-detail` 属性。
3. The 折叠触发器 shall 提供 `aria-expanded` 与 `aria-controls`，并保持键盘可达（可聚焦、可激活）。
4. When 运行既有 `packages/ui` 单元测试套件，the 重构后的实现 shall 使依赖上述属性与交互的测试全部通过，必要时同步更新测试但不削弱其断言强度。
