# Requirements Document

## Introduction

本特性交付 `@blksails/pi-web-ui`——pi-web 的**有样式、可主题化、可扩展**的浏览器组件层。它面向两类用户:想快速拥有成品聊天 UI 的第三方 React/Next 集成方,以及本项目整站(`app-shell`,消费本层组件闭合全链路)。

现状是:`@blksails/pi-web-react` 已提供 headless 的 `PiTransport` / `createPiClient` 与三个 hooks(`usePiSession` / `usePiControls` / `useExtensionUI`),但每个前端仍要重复地把 Vercel AI Elements 装配成 pi 聊天界面、为 pi 特有部件(工具卡、思考块、权限弹窗、扩展 widget)手写渲染、并接线模型/思考等级/统计等控制面板。本特性提供:

- `<PiChat>`:基于 AI Elements `Conversation/Message/Response/Reasoning/Tool/PromptInput/Actions` + `useChat(PiTransport)` 的**拖入组件**,一个组件即得到完整聊天界面。
- 细粒度组件:`<PiToolPart>`、`<PiReasoning>`、`<PiModelSelector>`、`<PiThinkingLevel>`、`<PiSessionStats>`、`<PiCommandPalette>`(基于 `get_commands` 的 "/" 补全)、`<PiPermissionDialog>`(扩展 UI:select/confirm/input/editor)。
- **渲染器注册表**:`registerToolRenderer(toolName, Component)` 与 `registerDataPartRenderer(type, Component)`,让 pi 扩展的自定义工具/部件映射到自定义 React UI;`<PiChat>` 暴露 header/footer/sidebar/messageActions 插槽。
- **分发**:npm 包 + shadcn registry(`npx pi-web add chat`);主题全部走 shadcn CSS 变量,继承宿主项目主题。

本特性运行于浏览器环境,**仅依赖** `@blksails/pi-web-react`(headless 层)与 shadcn/AI Elements;不依赖任何后端实现细节,不绑定具体后端/路由,不做非 React 嵌入。无障碍(键盘可达、aria 标注)基本达标。

## Boundary Context

- **In scope(本特性负责)**:
  - `<PiChat>` 拖入组件:装配 AI Elements + `useChat(PiTransport)`,渲染流式文本、思考块、工具卡、data-part 与权限弹窗;暴露 header/footer/sidebar/messageActions 插槽。
  - 细粒度有样式组件:`<PiToolPart>`(工具卡 start/update/end 三态)、`<PiReasoning>`(可折叠思考)、`<PiModelSelector>`、`<PiThinkingLevel>`、`<PiSessionStats>`、`<PiCommandPalette>`("/" 命令补全)、`<PiPermissionDialog>`(扩展 UI 四类:select/confirm/input/editor)。
  - 渲染器注册表:`registerToolRenderer` / `registerDataPartRenderer` 注册与解析;默认渲染器回退;注册项覆盖默认。
  - 分发产物:npm 包导出面 + shadcn registry 清单(`npx pi-web add chat`);主题以 shadcn CSS 变量定义,继承宿主。
  - 无障碍:键盘可达与 aria 角色/标签基本达标。
- **Out of scope(本特性不负责)**:
  - 后端引擎、REST/SSE 端点、会话进程驻留、事件→UIMessage 翻译、子进程 spawn、鉴权策略落地(归 `http-api` / `session-engine` / 后端引擎)。
  - 具体后端地址/路由的绑定与整站页面装配、agent 源选择、全链路 e2e(归 `app-shell`)。
  - `PiTransport` / hooks / `createPiClient` / SSE 解码 / control 帧分流的实现(归 `react-client`,本层仅消费)。
  - 协议类型 / zod schema / `protocolVersion` 常量定义(归 `protocol-contract`,经 `react-client` 间接消费)。
  - 扩展安装/卸载与 `get_commands` 后端实现(归 `extension-management`;本层仅消费 `usePiControls` 暴露的命令列表与 `useExtensionUI` 暴露的扩展 UI 队列)。
  - 非 React 集成(Web Component / iframe,归未来 `embed-integrations`)。
- **Adjacent expectations(对相邻系统/spec 的依赖与不拥有项)**:
  - 依赖 `@blksails/pi-web-react` 提供 `usePiSession`(暴露绑定的 `PiTransport` 与连接态)、`usePiControls`(model/thinking/abort/steer/follow_up/stats/commands)、`useExtensionUI`(扩展 UI 请求队列 + `respond` 回传)、`createPiClient`;本层不重定义这些行为,只装配与呈现。
  - 依赖 AI SDK v5 `@ai-sdk/react` 的 `useChat` 行为与消息 part 结构(text/reasoning/tool/data-part),以及 AI Elements 的 `Conversation/Message/Response/Reasoning/Tool/PromptInput/Actions` 组件 API。
  - 依赖 shadcn/ui(Radix + Tailwind v4)与其 CSS 变量主题约定;宿主提供 Tailwind 与 shadcn token。
  - 不持有服务端真值;消息流、控制态、扩展 UI 队列均来自 `@blksails/pi-web-react` 的派生状态。

## Requirements

### Requirement 1: `<PiChat>` 拖入聊天组件

**Objective:** As a 想快速拥有成品聊天 UI 的 React 开发者, I want 一个可直接拖入的 `<PiChat>` 组件, so that 我无需手工装配 AI Elements 与 hooks 即可获得完整的 pi 聊天界面

#### Acceptance Criteria

1. The `<PiChat>` 组件 shall 接收一个由 `@blksails/pi-web-react` 的 `usePiSession` 提供的会话/传输入参(或在内部经传入的会话配置建立),并用 `useChat({ transport })` 驱动消息流。
2. When 会话产生流式文本增量, the `<PiChat>` 组件 shall 经 AI Elements `Conversation/Message/Response` 增量渲染助手消息的 Markdown 文本。
3. When 用户在输入区提交内容, the `<PiChat>` 组件 shall 经 AI Elements `PromptInput` 发送 prompt 并在界面追加用户消息。
4. When 单条消息同时包含文本、思考、工具调用与 data-part, the `<PiChat>` 组件 shall 按各 part 类型分派到对应渲染(文本→`Response`、思考→`<PiReasoning>`、工具→`<PiToolPart>`、data-part→注册的 data-part 渲染器)。
5. While 会话处于流式生成中, the `<PiChat>` 组件 shall 提供可见的进行中指示并允许用户触发中止(经 `usePiControls.abort`)。
6. When 出现扩展 UI 请求, the `<PiChat>` 组件 shall 弹出 `<PiPermissionDialog>` 并在用户作答后将响应回传(经 `useExtensionUI.respond`)。
7. The `<PiChat>` 组件 shall 不实现任何 REST/SSE 传输逻辑,仅消费 `@blksails/pi-web-react` 暴露的 transport 与 hooks。

### Requirement 2: 工具卡组件 `<PiToolPart>`(start/update/end 三态)

**Objective:** As a 查看 agent 运行过程的用户, I want 工具调用以清晰的卡片呈现其开始、增量与结果, so that 我能理解 agent 正在做什么以及结果如何

#### Acceptance Criteria

1. When 收到工具调用输入(对应 `tool-input-available`), the `<PiToolPart>` 组件 shall 以"开始(start)"态显示工具名与入参。
2. When 收到工具执行的增量输出(对应工具 `data-part` 累积值更新), the `<PiToolPart>` 组件 shall 以"更新(update)"态用最新累积值替换显示内容。
3. When 收到工具执行结果(对应 `tool-output-available`), the `<PiToolPart>` 组件 shall 以"结束(end)"态显示结果,并在结果标记为错误时以错误样式呈现。
4. Where 某工具名已经过 `registerToolRenderer` 注册自定义渲染器, the `<PiToolPart>` 组件 shall 使用注册的组件渲染而非默认工具卡。
5. The `<PiToolPart>` 组件 shall 为可展开/折叠的明细区域提供键盘可达与 aria 状态标注。

### Requirement 3: 思考块组件 `<PiReasoning>`(可折叠)

**Objective:** As a 想了解 agent 推理但不被其淹没的用户, I want 思考内容以可折叠块呈现, so that 我可以按需展开查看而默认不占用主视线

#### Acceptance Criteria

1. When 收到思考流(对应 `reasoning-start/delta/end`), the `<PiReasoning>` 组件 shall 增量渲染思考文本。
2. The `<PiReasoning>` 组件 shall 默认以折叠状态呈现,并提供展开/折叠切换。
3. When 用户切换展开/折叠状态, the `<PiReasoning>` 组件 shall 即时更新可见性并经 aria 反映当前展开状态。
4. While 思考流仍在进行中, the `<PiReasoning>` 组件 shall 提供进行中指示。
5. The `<PiReasoning>` 组件 shall 支持键盘触发展开/折叠。

### Requirement 4: 控制组件 `<PiModelSelector>` / `<PiThinkingLevel>` / `<PiSessionStats>`

**Objective:** As a 想调整与监控会话的用户, I want 可视的模型选择、思考等级与会话统计控件, so that 我能切换模型/思考强度并查看用量与成本

#### Acceptance Criteria

1. The `<PiModelSelector>` 组件 shall 展示可选模型列表并在用户选择后经 `usePiControls.setModel` 提交。
2. While 模型切换操作进行中, the `<PiModelSelector>` 组件 shall 显示进行中态;若操作失败, then the `<PiModelSelector>` 组件 shall 显示可辨识的错误提示且不静默失败。
3. The `<PiThinkingLevel>` 组件 shall 展示可选思考等级并在用户选择后经 `usePiControls.setThinking` 提交。
4. The `<PiSessionStats>` 组件 shall 展示来自 `usePiControls` 的会话统计(用量/成本等),并在统计更新时刷新显示。
5. The 控制组件 shall 仅经 `@blksails/pi-web-react` 的 hooks 发起操作,不向 `useChat` 消息流写入内容。

### Requirement 5: 命令面板 `<PiCommandPalette>`("/" 补全)

**Objective:** As a 想用斜杠命令的用户, I want 输入 "/" 时弹出命令补全, so that 我能快速发现并选用 agent 暴露的命令

#### Acceptance Criteria

1. When 用户在输入区键入 "/" 触发命令模式, the `<PiCommandPalette>` 组件 shall 展示来自 `usePiControls.getCommands`(`get_commands`)的命令候选列表。
2. When 用户继续输入字符, the `<PiCommandPalette>` 组件 shall 依据输入对候选命令进行过滤。
3. When 用户选择某条命令(点击或回车), the `<PiCommandPalette>` 组件 shall 将该命令填入或提交到输入区。
4. The `<PiCommandPalette>` 组件 shall 支持上下方向键在候选项间移动、回车确认、Esc 关闭,并经 aria 标注当前活动项。
5. If 命令列表为空或获取失败, then the `<PiCommandPalette>` 组件 shall 显示空态/错误态而非崩溃。

### Requirement 6: 权限弹窗 `<PiPermissionDialog>`(扩展 UI 四类)

**Objective:** As a 需要对 agent 请求作答的用户, I want 一个一致的弹窗呈现扩展 UI 请求, so that 我能完成 select/confirm/input/editor 交互并把响应回传给会话

#### Acceptance Criteria

1. When 扩展 UI 请求为 `select` 类型, the `<PiPermissionDialog>` 组件 shall 呈现可选项并允许用户选择。
2. When 扩展 UI 请求为 `confirm` 类型, the `<PiPermissionDialog>` 组件 shall 呈现确认/取消选项。
3. When 扩展 UI 请求为 `input` 类型, the `<PiPermissionDialog>` 组件 shall 呈现文本输入控件。
4. When 扩展 UI 请求为 `editor` 类型, the `<PiPermissionDialog>` 组件 shall 呈现多行编辑控件。
5. When 用户提交作答, the `<PiPermissionDialog>` 组件 shall 经 `useExtensionUI.respond` 回传与请求匹配的 ui-response。
6. If 回传失败, then the `<PiPermissionDialog>` 组件 shall 保留弹窗并显示错误,允许用户重试。
7. The `<PiPermissionDialog>` 组件 shall 实现焦点捕获、Esc 关闭与 aria 对话框语义。

### Requirement 7: 渲染器注册表(工具/data-part)

**Objective:** As a 想把 pi 扩展的自定义工具/部件接入界面的开发者, I want 一个渲染器注册表, so that 我能用自定义 React 组件渲染特定工具或 data-part 而无需改动 `<PiChat>`

#### Acceptance Criteria

1. The 系统 shall 提供 `registerToolRenderer(toolName, Component)` 以按工具名注册自定义工具渲染器。
2. The 系统 shall 提供 `registerDataPartRenderer(type, Component)` 以按 data-part 类型注册自定义渲染器。
3. When 渲染某工具调用且该工具名已注册渲染器, the 渲染解析逻辑 shall 使用注册的组件而非默认 `<PiToolPart>`。
4. When 渲染某 data-part 且该 type 已注册渲染器, the 渲染解析逻辑 shall 使用注册的组件渲染该 part。
5. If 某工具名/data-part type 未注册渲染器, then the 渲染解析逻辑 shall 回退到默认渲染器。
6. Where 同一名称被重复注册, the 注册表 shall 以最后注册的渲染器为准(覆盖语义),并保持解析结果可预测。

### Requirement 8: `<PiChat>` 插槽

**Objective:** As a 想定制聊天布局的集成方, I want `<PiChat>` 暴露布局插槽, so that 我能注入自定义页头/页脚/侧栏与每条消息的操作区

#### Acceptance Criteria

1. The `<PiChat>` 组件 shall 接受 `header` 插槽并将其渲染在聊天区上方。
2. The `<PiChat>` 组件 shall 接受 `footer` 插槽并将其渲染在输入区下方/附近。
3. The `<PiChat>` 组件 shall 接受 `sidebar` 插槽并将其渲染在聊天区一侧。
4. The `<PiChat>` 组件 shall 接受 `messageActions` 插槽并为每条消息渲染相应操作区(经 AI Elements `Actions`)。
5. Where 某插槽未提供, the `<PiChat>` 组件 shall 使用合理默认(或不渲染该区域)而不报错。

### Requirement 9: 分发与主题(npm + shadcn registry + CSS 变量)

**Objective:** As a 想以多种方式取用组件的集成方, I want 既能从 npm 导入也能用 shadcn CLI 拉取源码, so that 我可按需在受控源码与包依赖之间选择,并让组件继承我的主题

#### Acceptance Criteria

1. The `@blksails/pi-web-ui` 包 shall 提供聚合 npm 导出面,覆盖 `<PiChat>`、各细粒度组件、渲染器注册表 API 与相关类型。
2. The `@blksails/pi-web-ui` shall 提供 shadcn registry 清单,使集成方可经 `npx pi-web add chat` 将组件源码加入其项目。
3. The 组件样式 shall 全部以 shadcn CSS 变量定义,使其继承宿主项目主题而无需修改组件源码。
4. The `@blksails/pi-web-ui` shall 仅依赖 `@blksails/pi-web-react` 与 shadcn/AI Elements,不引入后端依赖或非 React 集成产物。

### Requirement 10: 无障碍(键盘/aria)

**Objective:** As a 依赖键盘与辅助技术的用户, I want 组件可键盘操作并带语义标注, so that 我能在不使用鼠标的情况下完成聊天与对话交互

#### Acceptance Criteria

1. The 交互式组件(输入、选择、对话框、命令面板、折叠块) shall 可经键盘聚焦与操作。
2. When 弹出 `<PiPermissionDialog>`, the 弹窗 shall 捕获焦点并支持 Esc 关闭,关闭后将焦点还原至触发元素。
3. The 组件 shall 为按钮、对话框、可展开区域、列表活动项等提供恰当的 aria 角色/状态标注。
4. The `<PiCommandPalette>` shall 支持方向键导航与回车/Esc 操作,并以 aria 标注当前活动候选项。

### Requirement 11: 测试与 e2e(硬性)

**Objective:** As a 维护本组件库的工程师, I want 单元/组件测试与 e2e 验证覆盖关键行为, so that 组件库在变更后仍以新鲜运行证据保证可用

#### Acceptance Criteria

1. The 测试套件 shall 用 `@testing-library/react` 为每个对外组件提供渲染测试。
2. The 测试套件 shall 验证 `<PiToolPart>` 的 start/update/end 三态渲染。
3. The 测试套件 shall 验证 `<PiReasoning>` 的折叠/展开行为。
4. The 测试套件 shall 验证 `<PiPermissionDialog>` 提交后经 `useExtensionUI.respond` 回传 ui-response。
5. The 测试套件 shall 验证渲染器注册表的注册项覆盖默认渲染器(工具与 data-part 各一)。
6. The 测试套件 shall 包含一项 e2e:在测试页/Storybook 中以 mock 会话驱动 `<PiChat>`,断言流式文本、工具卡、思考块与权限弹窗交互完整。
7. The 测试套件 shall 可由单一命令运行全部单元/组件/e2e 并产出可验证结果。
