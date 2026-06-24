# Brief — ui-components

> 语言:zh。权威设计:`PLAN.md` §1(AI Elements)、§4(渲染映射)、§13.1(`@blksails/pi-web-ui`)、§13.4(渲染器注册表/插槽)。

## 问题
- **谁**:想快速拥有成品聊天 UI 的集成方,以及本项目整站。
- **现状**:有了 headless hooks/transport,但需要把 AI Elements 装配成可直接用的 pi 聊天组件,并能渲染 pi 特有部件(工具/思考/权限/widget)。
- **改变**:提供有样式、可主题化、可扩展的 `@blksails/pi-web-ui` 组件集 + 渲染器注册表。

## 方法 / 范围
- **`<PiChat>`**:基于 AI Elements `Conversation/Message/Response/Reasoning/Tool/PromptInput/Actions` + `useChat(PiTransport)` 的拖入组件。
- **细粒度组件**:`<PiToolPart>`、`<PiReasoning>`、`<PiModelSelector>`、`<PiThinkingLevel>`、`<PiSessionStats>`、`<PiCommandPalette>`(基于 `get_commands` 的 "/" 补全)、`<PiPermissionDialog>`(extension UI:select/confirm/input/editor)。
- **渲染器注册表(★)**:`registerToolRenderer(toolName, Component)`、`registerDataPartRenderer(type, Component)`;`<PiChat>` 暴露 header/footer/sidebar/messageActions 插槽。
- **分发**:npm + shadcn registry(`npx pi-web add chat`);主题走 shadcn CSS 变量。
- **范围外**:不绑定具体后端/路由(app-shell 做);非 React 嵌入(未来 embed)。

## 依赖
- react-client。

## 测试 + e2e(硬性)
- **单元/组件**:`@testing-library/react` 渲染各组件;工具卡 start/update/end 三态;思考折叠;权限弹窗回填 ui-response;渲染器注册表覆盖默认。
- **e2e**:在 Storybook/测试页用 mock 会话驱动 `<PiChat>`,断言流式文本/工具卡/思考块/权限弹窗交互完整。

## 约束
- 仅依赖 react-client + shadcn/AI Elements;可被宿主主题继承;无障碍(键盘/aria)基本达标。
