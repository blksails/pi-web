# Brief — react-client

> 语言:zh。权威设计:`PLAN.md` §4(ChatTransport)、§13.1(`@pi-web/react`)、§13.3 B(headless hooks)。

## 问题
- **谁**:任何 React/Next 项目(含本项目 ui-components 与第三方自研 UI)。
- **现状**:有了 HTTP/SSE 契约,但前端要手写 SSE 订阅、命令调用、AI SDK 接入,重复且易错。
- **改变**:提供无样式的 headless 层:一个 AI SDK v5 `ChatTransport` + 一组 hooks,让 `useChat` 与 pi 控制开箱即用。

## 方法 / 范围
- **`PiTransport`**(实现 AI SDK v5 `ChatTransport`):`sendMessages()` POST `/messages` 并把 `/stream` 的 SSE 转为 `ReadableStream<UIMessageChunk>`;`reconnectToStream()` 断线重连。
- **`createPiClient(baseUrl, fetch?)`**:封装 REST 调用(建会话、命令、stats、commands、ui-response)。
- **hooks**:`usePiSession`(建/连会话 + 状态)、`usePiControls`(model/thinking/abort/steer/stats/commands)、`useExtensionUI`(扩展UI 请求队列 → 暴露给上层弹窗)。
- 旁路 control 帧(extension-ui/queue/stats/error)分流到 hooks,不污染 useChat 消息。
- **范围外**:不带样式/组件(ui-components 做)。

## 依赖
- protocol-contract、http-api(消费其契约)。

## 测试 + e2e(硬性)
- **单元**:`PiTransport` 对 mock SSE 流的解析(text/reasoning/tool/data-part → UIMessageChunk);重连逻辑;`createPiClient` 请求拼装。
- **集成/组件**:用 `@testing-library/react` 跑 `useChat({transport:PiTransport})` 对 mock server,断言消息流式更新;hooks 状态机。
- **e2e**:接真实 http-api(stub agent)→ hook 驱动一轮 prompt→流式回复;extension UI 请求经 `useExtensionUI` 冒泡。

## 约束
- 浏览器环境;仅依赖 protocol + AI SDK,不依赖后端实现细节。
