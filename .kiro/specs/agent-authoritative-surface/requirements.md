# Requirements Document

## Introduction

富交互 UI 表面(surface)——画廊、队列、实时面板——与 agent 之间此前没有统一的通信约定。同一个模式在 pi-web 中已零散实现三次(`state-injection-bridge` 的 KV 桥 + 写回、`message-queue-ui` 的 `control:"queue"` 粘性帧 + clearQueue、`unified-command-result-layer` 的 ui-rpc 命令),每新增一个富 surface 都要重新手接三条边并重踩同一批坑(粘性帧丢态、宿主误焊领域语义、命令 payload 承载路径)。

本特性把这个已被 pi 约束逼出来的 **CQRS 范式**(状态权威永在 agent 进程、UI 只镜像快照 + 只发结构化命令、宿主做领域无关的中立搬运)提炼为一套按 `domain` 命名的 SDK:agent 侧 `createSurface({domain, initialState, commands, hydrate})` 持有权威 state、派发结构化命令、(重)建时重建;UI 侧 `useSurface(domain) → {state, run, available, rev}` 镜像快照、发命令、由能力探针驱动退化。目标是让新建一个 surface 从"手接三条边"变成"填一个 config",且宿主零领域语义。

本特性走**路线 A**:零 protocol 结构改动、零 REST 端点。下行复用现有 `control:"state"` KV 桥(`key = "surface:<domain>"`),上行复用 Tier3 `ui-rpc` 命令通道(细化 payload、不改 `UiRpcRequestSchema` 结构),命令经 **agent 转发路径**进入子进程,响应经 `control:"ui-rpc"` 按 `correlationId` 异步配对。大负载一律走 `att_` 引用,二进制永不进帧。

## Boundary Context

- **In scope**:agent 侧 `createSurface` 门面(权威 state 持有 + 命令派发 + `hydrate` 钩子);runner 子进程内接收 `ui_rpc` 命令行并派发到 surface 命令表的接线(经 `fs.writeSync(1)` 直写 fd1 回流响应);UI 侧 `useSurface` hook(快照镜像 + `run` 命令 + `available` 能力探针 + `rev`);`SurfaceCommandPayload` / `SurfaceCommandResult` schema(细化 ui-rpc 的 `unknown` payload/result,不改 `UiRpcRequestSchema` 结构);能力探针命令 `surface:<domain>` 注册 + 退化契约;SDK 包边界落地;端到端最小回归 surface 示例 + 浏览器 e2e。
- **Out of scope**:任何具体 domain 的业务落地(Canvas 归 `aigc-canvas`);`control:"state"` 桥的**通用粘性帧修复本身**(归上游 `state-injection-bridge` 扩展,本特性只消费它);任何新 REST 端点;`pi.appendEntry` 持久层;宿主主进程 host 命令路径(surface 严禁走此路径);多 domain 类型化 snapshot 的路线 B(封闭 union 松绑)。
- **Adjacent expectations**:上游 `state-injection-bridge` 已在 `PiSession.handleRawLine` 的 `piweb_state` 分支通用登记粘性帧(`sticky.set(\`state:${key}\`, frame)`),使 `control:"state"` 重连可回放——本特性的"刷新后 surface 仍在"依赖该修复已就位;上游 `unified-command-result-layer` 的 ui-rpc 命令通道(`makeUiRpcHandler` 的 host 拦截、`createUiRpcBus`)与 `attachment-store`(Bulk 签名 URL)、`web-ui-custom-rendering`(`SlotContribution` 具名槽挂载)均已就位。

## Requirements

### Requirement 1: agent 侧 createSurface 门面

**Objective:** As an agent 作者, I want 一个按 `domain` 命名的 `createSurface` 门面来持有权威快照并派发结构化命令, so that 新建一个富交互 surface 只需填 config、而不必手接 state 桥 / ui-rpc / attachment 三条边。

#### Acceptance Criteria
1. When 作者以 `createSurface({domain, initialState, commands, hydrate?})` 创建 surface, the createSurface SDK shall 返回一个 `SurfaceHandle`,其持有以 `domain` 为唯一标识的权威快照,初值为 `initialState`。
2. When 确定性代码(如工具 `execute`)调用 `handle.update(reducer)`, the createSurface SDK shall 用 reducer 计算新快照、经 `state-injection-bridge` 写入原语以 `key = "surface:<domain>"` 推送 `control:"state"` 下行帧,并使 `rev` 由现有状态桥单调分配。
3. When surface 命令被派发到 `handle.dispatch(action, args)`(`ctx` 由 SDK 内部构建,不作为入参), the createSurface SDK shall 调用 `commands[action]` 并把结果**归一化**为 `SurfaceCommandResult`:handler 返回普通值 → 包成 `{ok:true, data}`;handler 返回**非抛错**显式失败 `{ok:false, error:{code,message}}`(如下游 `runImageTool` 的 `details.ok===false`)→ 原样透传 `{ok:false, error}`,保留稳定领域 `code`(如 `edit_failed`);并在命令处理器内经 `ctx.setState(reducer)` 推送最新快照。
4. If `commands` 中不存在被请求的 `action`,或命令处理器**抛出** error,或处理器返回显式失败 `{ok:false, error}`, then the createSurface SDK shall 返回 `ok:false` 且带稳定 `error.code`(不存在 action → `"unknown_action"`;抛出 error → 优先取 error 的 `.code`,如自定义 `SurfaceCommandError{code}`,无则兜底 `"dispatch_failed"`;非抛错显式失败 → 透传处理器给出的领域 `code`),不抛异常、不崩会话。
5. The createSurface SDK shall 使 `initialState` 的默认值下沉到函数体内构造(避免跨 surface 共享同一引用)。
6. Where `hydrate` 钩子被提供, the createSurface SDK shall 在子进程(重)启动装配期调用 `hydrate()` 以从领域数据源(如 attachment store)枚举重建初始快照,并在重建后推送粘性快照。

### Requirement 2: 命令上行走 agent 转发路径(不走 host 命令路径)

**Objective:** As an AAS SDK, I want surface 命令经 ui-rpc 的 agent 转发路径进入子进程, so that 命令处理器能拿到 agent 侧的 provider/model/key 与领域编排器,而宿主主进程不认领任何领域语义。

#### Acceptance Criteria
1. When UI 发起 surface 命令, the useSurface hook shall 经 `createUiRpcBus` 发 `UiRpcRequest{point:"command", action:"execute", payload: SurfaceCommandPayload{domain, action, args?}}`,其 payload **不含顶层 `name` 字段**。
2. When 服务端 `makeUiRpcHandler` 收到该请求, the ui-rpc handler shall 因 `CommandExecutePayloadSchema.safeParse(payload)` 失败而不命中 host 命令注册表,从而落到 `session.uiRpc(req)` 转发进 agent 子进程。
3. The AAS SDK shall 不使用 `client.uiRpcCommand`(host 命令同步响应体,运行在宿主主进程),surface 命令一律经异步 ui-rpc 转发。
4. When agent 处理器执行完毕, the runner surface 接线 shall 以 `{"type":"ui_rpc_response","response":{correlationId, ok, result}}` 回流响应,其中 `result` 为 `SurfaceCommandResult`。
5. When 响应下行到达 UI, the useSurface hook shall 经 `createUiRpcBus` 按 `correlationId` 异步配对,`run(...)` 的 Promise 解析为该 `SurfaceCommandResult`。
6. If ui-rpc 请求超时或发送失败, then the ui-rpc bus shall 以 `ok:false` 结算(既有 `TIMEOUT` / `SEND_FAILED` 语义),不抛、不阻塞输入。

### Requirement 3: runner 子进程内 ui-rpc 命令接收与派发

**Objective:** As pi-web runner, I want 一条运行在 agent 子进程内的接线来接收 `ui_rpc` 命令行并派发到 surface 命令表, so that 转发进子进程的 surface 命令能在能拿到 provider/编排器的子进程内被确定性代码执行——这是 `state-injection-bridge` 显式留下的"通用 ui_rpc 真实 handler"缺口。

#### Acceptance Criteria
1. When runner 装配会话运行时, the runner shall 在 `runRpcMode` **之前**挂一个第二个 stdin JSONL 读取器,截获 `{"type":"ui_rpc","request":{...}}` 行。
2. When 截获的请求满足 `point==="command"` 且 `action==="execute"` 且 `SurfaceCommandPayloadSchema.safeParse(payload)` 成功, the runner surface 接线 shall 按 `payload.domain` 在进程内 surface 注册表中查找目标 surface 并派发 `payload.action` / `payload.args`。
3. When surface 命令派发完成, the runner surface 接线 shall 把 `ui_rpc_response` 行经 `fs.writeSync(1, ...)` **直写 fd1**(而非 `process.stdout.write`),因为 pi 的 `runRpcMode` 用 `takeOverStdout` 把 `process.stdout.write` 劫持转 stderr。
4. If 截获的行不是 surface 命令(其它 `point`、非 `execute`、或 payload 不匹配), then the runner surface 接线 shall 不干预该行,交由既有链路(webext contribution / pi)处理。
5. If 目标 `domain` 未注册或命令处理器抛出, then the runner surface 接线 shall 回流 `ok:false` 且带稳定 `error.code`,不崩会话。
6. Where 没有任何 surface 注册, the runner surface 接线 shall 惰性 no-op(不影响未使用 AAS 的会话行为)。

### Requirement 4: UI 侧 useSurface hook

**Objective:** As a UI 开发者, I want 一个 `useSurface(domain)` hook 来镜像权威快照、发结构化命令并读取能力, so that surface 渲染器只关心领域视图与交互,不必手接 SSE 订阅、ui-rpc 总线与命令面板。

#### Acceptance Criteria
1. When surface 渲染器调用 `useSurface(domain)`, the useSurface hook shall 返回 `{ state, run, available, rev }`。
2. When `control:"state"` 帧中 `key === "surface:<domain>"` 的快照到达, the useSurface hook shall 经既有 `ControlStore.states` 切片(基于 `useExtensionState`)更新 `state`,并按 `rev` 单调收敛、丢弃乱序/过期帧。
3. While 尚未收到任何该 domain 的快照, the useSurface hook shall 使 `state` 为 `null`。
4. When 调用 `run(action, args?)`, the useSurface hook shall 经 ui-rpc bus 发 `SurfaceCommandPayload` 并返回解析为 `SurfaceCommandResult` 的 Promise(见 Requirement 2)。
5. The useSurface hook shall 使 `rev` 反映当前镜像快照的修订号(供调试与乐观更新对齐)。

### Requirement 5: 能力协商与退化契约

**Objective:** As pi-web, I want surface 经能力探针协商可用性并在不支持时优雅退化, so that 换任意无关 agent source 时 pi-web 照跑、surface 不报错不空转——这是宿主与 agent source 独立性的验证。

#### Acceptance Criteria
1. When `createSurface` 创建一个 surface, the createSurface SDK shall 注册一个只读探针命令 `surface:<domain>`(经 `pi.registerCommand`),使其在 `getCommands` 响应中可见。
2. When surface 渲染器挂载, the useSurface hook shall 经 `getCommands()` 查询 `surface:<domain>` 是否存在以决定 `available`。
3. If `available === false`, then the surface 渲染器 shall 降级到只读 / 纯客户端能力,不报错、不空转、不发无效命令。
4. While `available === true`, the useSurface hook shall 允许 `run(...)` 正常派发命令。
5. Where agent source 与当前 surface domain 无关(未注册该 domain), the pi-web 宿主 shall 正常运行会话的全部既有能力,不受 surface 缺失影响。

### Requirement 6: 命令 payload/result 契约

**Objective:** As protocol 层, I want `SurfaceCommandPayload` / `SurfaceCommandResult` 细化 ui-rpc 的 `unknown` payload/result, so that surface 命令有类型化、可校验的载荷,而 `UiRpcRequestSchema` 结构与既有消费者向后兼容。

#### Acceptance Criteria
1. The protocol 层 shall 定义 `SurfaceCommandPayloadSchema`,含 `domain: string(非空)`、`action: string(非空)`、`args: unknown(可选)`,且**不含顶层 `name`**。
2. The protocol 层 shall 定义 `SurfaceCommandResultSchema`,含 `domain`、`action`、`ok: boolean`、`data: unknown(可选)`、`error: {code, message}(可选)`。
3. The protocol 层 shall 不修改 `UiRpcRequestSchema` / `UiRpcResponseSchema` / `UiRpcControlPayloadSchema` 的结构(payload/result 仍为 `unknown`,surface schema 在消费侧细化)。
4. When 服务端或 UI 接收 surface 命令/结果, the 消费方 shall 以 `safeParse` 校验载荷,失败时安全拒绝或回流 `ok:false`,不抛。
5. The protocol 层 shall 不新增任何顶层 `control` 帧类型(不扩 `ControlPayloadSchema` 的判别联合)。

### Requirement 7: Bulk 大负载走 att_ 引用

**Objective:** As AAS SDK, I want 大负载(图像、mask、拼贴产物)一律走 `att_` 引用, so that 二进制永不进入 SSE 帧或命令 payload,快照与命令保持轻量。

#### Acceptance Criteria
1. When surface 命令 `args` 或快照 `value` 需要承载二进制资源, the AAS SDK shall 仅传递 `att_<id>` 引用与签名 `displayUrl`,base64/二进制永不进帧。
2. When 命令处理器需要读写附件, the SurfaceCtx shall 经既有 `AttachmentToolContext`(`getAttachmentToolContext()` 附件 seam)resolve `att_` 与落库产物。
3. The AAS SDK shall 复用既有 attachment store 基础设施,不新增 AIGC/领域语义到附件层。

### Requirement 8: 宿主中立性

**Objective:** As pi-web 宿主, I want 搬运 surface 通信时不认识任何领域语义, so that 可以无限增加 domain 而不腐蚀宿主、agent source 保持独立。

#### Acceptance Criteria
1. The pi-web 宿主(`app/`、`packages/server`) shall 在转发 `control:"state"` 帧时把 `value` 当作 `unknown` 不 peek。
2. The pi-web 宿主 shall 在转发 ui-rpc 命令时把 `payload`/`result` 当作 `unknown` 不解析领域字段。
3. When 对 `app/` 与 `packages/server` 执行 grep 领域语义字符串(如 `canvas` / `gallery` / `image_edit`), the 检查 shall 找不到任何匹配(领域知识只活在 agent extension 与 UI 渲染器两端)。
4. When surface 渲染器经 `SlotContribution` 具名槽挂载, the pi-web 宿主 shall 把槽名当作不透明字符串,不常驻、不知情。

### Requirement 9: SDK 包边界与挂载

**Objective:** As pi-web 维护者, I want SDK 落到与既有分层一致的包边界, so that agent 侧值代码不进前端 bundle、UI hook 与既有 react hook 同源,新建 surface 的接入方式与既有 webext 挂载一致。

#### Acceptance Criteria
1. The AAS SDK shall 把 agent 侧运行时代码(`createSurface` + runner 接线)落在 `@blksails/pi-web-tool-kit` 的 runtime 子入口(含 pi SDK 值导入的代码只经 `/runtime` 加载,不进前端 bundle)与 `@blksails/pi-web-server` 的 runner 层。
2. The AAS SDK shall 把 UI 侧 `useSurface` hook 落在 `@blksails/pi-web-react`,与既有 `useExtensionState` / `createUiRpcBus` 同源。
3. The AAS SDK shall 把 `SurfaceCommandPayload/Result` schema 落在 `@blksails/pi-web-protocol` 的 `web-ext` 域。
4. When surface 渲染器需要挂载到宿主, the surface shall 复用既有 `SlotContribution` 具名槽机制,不新造 renderer 机制。

### Requirement 10: 质量门(测试 / e2e / 类型安全)

**Objective:** As pi-web 项目, I want AAS 以新鲜运行证据证明正确, so that 满足项目硬规则(单元/集成测试 + 浏览器 e2e + TypeScript strict、无 `any`)。

#### Acceptance Criteria
1. The AAS 实现 shall 以 TypeScript strict 编写,不使用 `any`,全工作区 `typecheck` 通过。
2. The AAS 实现 shall 为每个可测单元(schema、createSurface、runner 接线派发、useSurface)提供单元测试。
3. The AAS 实现 shall 提供**真实子进程集成测试**覆盖"ui-rpc 命令转发 → 子进程派发 → `fs.writeSync(1)` 回流响应"与"命令内 `ctx.setState` → `control:"state"` 下行帧"(fd1 直写坑只有真实子进程能抓到)。
4. The AAS 实现 shall 提供一个浏览器 e2e 验证:经一个最小 surface 示例走"命令 → 转发 → 派发 → 快照回流镜像 → 视图更新"与"非该 domain 的 source → `available===false` → 退化"完整闭环。
5. When AAS 未被任何会话使用, the pi-web shall 表现与未引入 AAS 时一致(零回归)。
