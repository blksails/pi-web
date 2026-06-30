# Research & Design Decisions

## Summary
- **Feature**: `bang-shell-command`
- **Discovery Scope**: Extension(把已存在但未接入 Web 的 pi `bash` RPC 能力补齐到 pi-web 的 HTTP/前端/渲染/门控层)
- **Key Findings**:
  - pi agent RPC mode 已原生支持 `bash`/`abort_bash`,且 `!`(非 `!!`)由 agent 内部 `recordBashResult` 自动写入 LLM 上下文——pi-web 无需自管上下文。
  - 协议包(`command.ts` / `response.ts` / `session-state.ts:85` 的 `BashResultSchema`)与 RPC 通道(`pi-rpc-process.ts:679` 的 `bash()`)均已就绪,本特性零协议改动。
  - 结果回显必须走同步 HTTP 响应体 + 前端 `setMessages` 注入,**不能**走 SSE 流(否则重蹈 prompt 流冲突,见记忆 `unified-command-result-layer`)。

## Research Log

### pi agent 的 bash 能力(RPC vs TUI)
- **Context**:确认 bang 命令在 pi 中的实现位置与 RPC 可达性。
- **Sources Consulted**:`@earendil-works/pi-coding-agent@0.79.10` 反编译 dist——`modes/interactive/interactive-mode.js:184/1983/2147`(TUI bash 模式)、`modes/rpc/rpc-mode.js:430/436`(RPC `bash`/`abort_bash` case)、`core/agent-session.js:2074`(`executeBash`)、`:2094`(`recordBashResult`,`!!`→`excludeFromContext`)。
- **Findings**:
  - TUI:输入以 `!` 开头进 bash 模式,`!!` 排除上下文。
  - RPC `case "bash"`:`session.executeBash(command, undefined, { excludeFromContext })` → `success(id,"bash",result)`;`onChunk` 为 `undefined`,**无流式**,结果一次性返回。
  - `recordBashResult` 把 `bashExecution` role 消息写入 session 历史(除非 `excludeFromContext`),agent streaming 中则延后到 `agent_end` flush。
- **Implications**:pi-web 复用 RPC `bash` 即可;上下文语义免费获得;无流式(列 Non-Goal)。

### pi-web 后端 RPC 桥与路由注入
- **Context**:确认 pi-web 是否已能发 bash RPC、如何挂 HTTP 端点。
- **Sources Consulted**:`packages/server/src/rpc-channel/pi-rpc-process.ts:548`(`sendCommand`)、`:679`(`bash()`)、`packages/server/src/http/create-handler.ts`(`routes:` 注入)、`packages/server/src/session/pi-session.ts:710`(`getMessages` forward 模式)、`http/routes/query-routes.ts:74`。
- **Findings**:通道 `bash()` 已存在;`pi-session` **未**暴露 `bash` 转发(需补);路由经 `RouteSpec`/`InjectedRoute` 注入,内置优先。
- **Implications**:后端仅需 ① `pi-session.bash/abortBash` forward;② 新 `bash-routes`。

### 前端提交链路与回显机制
- **Context**:确认 `!` 在何处分流、结果如何进聊天流。
- **Sources Consulted**:`packages/ui/src/chat/pi-chat.tsx:627`(onSubmit `/` 分流)、`:559`(doSend→sendMessage)、`:614`(`/clear` 经 `chatRef.setMessages`)、`:357`(useChat 解构,注释警告不在 render 期解构 `setMessages`)、`packages/react/src/client/pi-client.ts:177/191`(`prompt`/`uiRpc`/`uiRpcCommand`)、`registry/renderer-registry.ts`、`chat/part-renderer.tsx:126`、`elements/prompt-input.tsx`。
- **Findings**:onSubmit 已有 builtin(`/` 同步 `uiRpcCommand`)/extension(`/` `prompt` fire-and-forget)两分流;`setMessages` 需经 `chatRef` 在回调内访问(render 期解构会无限循环);data part 经 `registerDataPartRenderer` + `resolveDataPartRenderer` 渲染。
- **Implications**:bash 分支照搬该范式;注入复用 `chatRef.setMessages`;卡片复用 data part 渲染器。

### 翻译层与历史回放
- **Context**:刷新后 bash 卡片能否回显。
- **Sources Consulted**:`packages/server/src/session/translate/translate-event.ts`(grep 无 `bashExecution`)、`http/routes/query-routes.ts:78`(`get_messages` 返回原始未翻译消息)。
- **Findings**:翻译层不认 `bashExecution` role;`get_messages` 原样返回。
- **Implications**:历史回放需额外改翻译层 + 前端历史映射 → 列为 Non-Goal。

### 能力开关范式与浏览器 env 约束
- **Context**:开关怎么做才合既有惯例且安全。
- **Sources Consulted**:`lib/app/logging-default.ts`(env→默认纯函数,默认关)、`lib/app/pi-handler.ts:243/277`、`components/chat-app.tsx:161/183/521`(`NEXT_PUBLIC_*`→prop)、`app/page.tsx:32`、记忆 `pi-web-logging-default-off` / `webext-runtime-install-csp-eval`。
- **Findings**:服务端默认值用纯函数从 env 推导;前端开关用构建期内联 `NEXT_PUBLIC_*`(浏览器不可整体读 `process.env`);server 组件读 env→传 prop。
- **Implications**:双 env 分离 + 服务端权威门控 + 前端 `enableBash` prop。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 同步 HTTP 旁路 + setMessages 注入(选用) | bash 走独立 POST,结果同步返回,前端注入消息 | 不碰 SSE,无 prompt 流冲突;契合请求-响应本质;复用既有接缝 | 刷新不回放(可接受,列 Non-Goal) | 与 `uiRpcCommand` host 命令同款思路 |
| 后端 SSE 推帧 | 执行后往会话 SSE 流推 uiMessageChunk | 自然进 useChat 消息流、可回放 | 重蹈 prompt 流冲突(记忆明确警告);复杂 | 否决 |
| 纯前端 fake(浏览器直接执行) | — | — | 浏览器无 shell;违背"在 agent cwd 执行" | 不可行 |

## Design Decisions

### Decision: 结果回显走同步响应体而非 SSE
- **Context**:bash 结果如何进聊天流。
- **Alternatives Considered**:① 同步 HTTP + setMessages;② 后端 SSE 推帧。
- **Selected Approach**:① —— `PiClient.bash` 同步拿 `BashResult`,经 `chatRef.setMessages` 注入 user 消息 + `data-bash-result` 卡片。
- **Rationale**:RPC `bash` 本就是一次性请求-响应;记忆 `unified-command-result-layer` 表明往空闲 SSE 流推帧破坏 prompt 流。
- **Trade-offs**:得简单与隔离;失去刷新回放(列 Non-Goal)。
- **Follow-up**:e2e 验证注入不触发 LLM(不调 `sendMessage`)。

### Decision: 默认关闭 + 双 env 分离 + 服务端权威 404
- **Context**:任意 shell 执行的安全门控。
- **Alternatives Considered**:① 单一 `NEXT_PUBLIC_` 开关;② 双 env 分离 + 服务端权威。
- **Selected Approach**:②——`PI_WEB_BASH_ENABLED`(server-only 权威,关则路由 404)+ `NEXT_PUBLIC_PI_WEB_BASH_ENABLED`(前端体验);默认关。
- **Rationale**:单一 public 开关会让安全边界落在客户端可见值上;分离使后端可彻底关死;404 不泄露端点存在。
- **Trade-offs**:两个 env 需同开才完整(以文档弥补)。
- **Follow-up**:文档登记;e2e A/B 两档。

### Decision: 不自管上下文,复用 agent recordBashResult
- **Context**:`!` 进 / `!!` 不进上下文。
- **Selected Approach**:仅透传 `excludeFromContext`,上下文写入交给 agent。
- **Rationale**:避免重复实现且与 TUI 行为一致。
- **Trade-offs**:依赖 agent 行为(已验证存在)。

## Risks & Mitigations
- **任意命令执行(RCE-by-design)** — 默认关闭 + 服务端权威 404 + 部署硬化文档明确风险。
- **禁用态副作用** — 在解析 body 前即返回 404。
- **`setMessages` 无限循环坑** — 仅经 `chatRef` 在回调内访问,不在 render 期解构。
- **e2e 抓不到输出** — 卡片用同步 `<pre>`,不用 streamdown/`Response`(jsdom 异步高亮坑)。
- **新增注入路由不生效** — handler 是 globalThis 单例,改后重启 dev。
- **前开后关导致 404** — 前端给可见错误反馈(Req 7.1)。

## References
- 记忆 `unified-command-result-layer` — host 命令须走同步 HTTP 响应体而非 SSE 空闲控制流。
- 记忆 `pi-web-logging-default-off` — 服务端权威门控 + env 默认关闭范式。
- 记忆 `webext-runtime-install-csp-eval` — 浏览器勿整体读 `process.env`。
- 记忆 `pi-web-streamdown-json-async` — jsdom 下代码块异步高亮,用同步 `pre`。
- 记忆 `pi-web-handler-singleton-restart` — 改注入路由后须重启 dev。
- pi `@earendil-works/pi-coding-agent@0.79.10` — `modes/rpc/rpc-mode.js`、`core/agent-session.js`。
