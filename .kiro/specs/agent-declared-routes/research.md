# Research & Design Decisions — agent-declared-routes

## Summary
- **Feature**: `agent-declared-routes`
- **Discovery Scope**: Extension(骑在既有命令通道/桥接先例上的集成型特性)
- **Key Findings**:
  - 既有 ui-rpc 「agent 转发」路径是 fire-and-ack(HTTP 快 ack + SSE `control:ui-rpc` 异步回流),**不满足同步响应需求**;同步请求-响应配对的现成先例是 clearQueue(pending map + 关联 id + 超时 reject)。
  - 声明面下发的现成先例是 `slash_completions`:runner 装配期(`runRpcMode` 之前、stdout 仍归 pi-web 掌控的窗口)向 stdout 推自建 JSONL 帧,`PiSession.handleRawLine` 在就绪门之前识别并按会话缓存。
  - agent 子进程侧「server→agent 下行 + agent→server 回写」的现成先例是 wireSurfaceBridge/wireStateBridge/clearQueue-wiring:`runRpcMode` 前挂第二个 stdin reader,回写必须 `fs.writeSync(1)` 直写 fd1(`runRpcMode` 的 takeOverStdout 劫持 `process.stdout.write`)。
  - Router 的 `:param` 段提取是通用的(`matchPath` 对任意 `:xxx` 模板段生效),`/sessions/:id/agent-routes/:name` 无需扩展 Router;`:id` 端点自动获得会话存在性校验(404)与 authResolver(401)/authorizeSession(403)双层鉴权门。
  - `/api/sessions/[[...path]]` Next catch-all 已整体转发 sessions 段,新端点嵌套其下**不需要**新增顶层转发器(需求描述中的「新顶层 API 段转发器」担忧消解,以测试证明覆盖即可)。
  - 浏览器 e2e 走 `PI_WEB_STUB_AGENT=1`,stub 是真实子进程(`lib/app/stub-agent-process.mjs`)说同一 JSONL 协议——stub 补 routes 声明帧与请求应答即可支撑 e2e;真实 runner 接线由「对真实子进程的集成测试」覆盖(state-injection-bridge 先例:fd1 直写坑只有真实子进程测试能抓到)。

## Research Log

### ui-rpc 通道形态与同步响应的匹配度
- **Context**: 需求 3.2 要求同一 HTTP 请求-响应周期内同步返回 agent 处理结果。
- **Sources Consulted**: `packages/server/src/http/routes/command-routes.ts:281-323`(makeUiRpcHandler)、`packages/server/src/session/pi-session.ts:723-761`(uiRpc/emitUiRpcResponse)、`.kiro/specs/unified-command-result-layer/design.md`。
- **Findings**:
  - host 命令(决策 A):服务端执行,同步 HTTP 响应体——但执行体在主进程,不适用于「转发进 agent」。
  - agent 转发:`session.uiRpc(req)` 只发不等(`return ack()`),响应经 `handleRawLine` 翻成 `control:"ui-rpc"` SSE 帧广播,按 correlationId 客户端配对。
  - clearQueue(`pi-session.ts:843-865`):`pendingClearQueue` map + 自建帧 `piweb_clear_queue_result` 按 id 配对 + 20s 超时 reject——**主进程内同步等待子进程回写**的完整先例。
- **Implications**: agent route 的转发采用 clearQueue 模式(pending map + 专用帧 + 超时),而非复用 ui_rpc 帧对;HTTP handler `await session.invokeAgentRoute(...)` 后直接回 HTTP 响应体,SSE 面零触碰(Req 7.1)。

### 声明面:AgentDefinition → 主进程路由表
- **Context**: 主进程需要在 HTTP 层做 404/405/清单,必须知道 agent 声明了哪些 routes;而 AgentDefinition 在**子进程**内载入(jiti)。
- **Sources Consulted**: `packages/server/src/runner/slash-completions-wiring.ts`、`packages/server/src/session/pi-session.ts:615-622`(装配期帧缓存,早于就绪门)、`packages/agent-kit/src/types.ts:57-110`。
- **Findings**: `slashCompletions` 即同构问题的既有解:runner 归一化 factory 携带纯数据声明 → 装配期 stdout 推 `slash_completions` 帧 → PiSession 无 active 约束缓存。
- **Implications**: 新增 `agent_routes` 声明帧(仅 name/methods/description 纯数据;handler 函数留在子进程 registry),PiSession 按会话缓存为路由表;HTTP 层据表做 404/405/清单。

### 子进程侧分发与回写
- **Context**: 请求怎么进 agent、响应怎么出来。
- **Sources Consulted**: `packages/server/src/runner/surface-wiring.ts:109-250`、`packages/server/src/runner/runner.ts:334-350`(装配序)、记忆 state-injection-bridge(fs.writeSync(1) 坑)。
- **Findings**: 第二 stdin reader 模式成熟:逐行 JSON 解析,只消费自己的帧类型,其余放行;回写单次原子 `writeSync(1)`;装配序在 `runRpcMode` 之前。
- **Implications**: 新增 `agent-routes-wiring.ts`,消费 `piweb_agent_route_request` 帧,按 name 查子进程内 handler registry,invoke(async,天然支持并发),结果以 `piweb_agent_route_result` 回写,永不抛(错误归一化为 result.ok=false)。

### HTTP 层:挂载、鉴权、上限、门控
- **Sources Consulted**: `packages/server/src/http/router.ts:93-186`、`packages/server/src/http/auth.ts`、`packages/server/src/http/routes/attachment-routes.ts:39,68-79`(25MiB Content-Length 提前拒 413)、bash-route 门控先例(`PI_WEB_BASH_ENABLED`,服务端权威门)。
- **Findings**: `:id` 端点免费获得 401/403/404(会话不存在);Router `:name` 模板段现成;413 先例按 Content-Length 提前拒;env 门控先例是服务端权威(关→404)。
- **Implications**: 端点注册为 builtin 路由(create-handler 内,非 injected);`PI_WEB_AGENT_ROUTES_DISABLED=1` 关断(默认开,Req 4.3 反向于 bash 的默认关——声明本身已是 agent 作者显式 opt-in);body 上限默认 1 MiB(`PI_WEB_AGENT_ROUTE_BODY_LIMIT`);超时默认 20s(`PI_WEB_AGENT_ROUTE_TIMEOUT_MS`),对齐 clearQueue。

### e2e 可测性
- **Findings**: 浏览器 e2e 全线跑 stub(`lib/app/stub-agent-process.mjs`,真实子进程同协议);aigc-canvas e2e 先例即 stub 代答 canvas 命令。真实 runner 的 fd1/stdin 接线只有真实子进程集成测试能验(state-injection-bridge 教训)。
- **Implications**: 测试三层:单测(校验/wiring/配对)+ 真实子进程集成测试(spawn 带 routes 的 fixture agent,闭环)+ 浏览器 e2e(stub 声明演示 routes,`page.request` 直调 HTTP 断言)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 复用 ui_rpc 帧对(新 payload 形状) | route 请求塞进 `{"type":"ui_rpc"}`,以 payload 形状区分消费者 | 帧类型零新增 | 三个 stdin 消费者按 payload 形状互相「猜」归属,易误伤;`ui_rpc_response` 回流会被 handleRawLine 翻成 SSE control 帧,需加豁免分支,触碰既有路径 | 否决:多路复用歧义是真实风险 |
| B. 专用帧对(clearQueue 模式)★ | `piweb_agent_route_request/result` 自建帧,pending map + id 配对 + 超时 | 消费归属零歧义;同步等待先例成熟;SSE/协议零触碰;真实传输(stdin/stdout JSONL)复用 | 新增两个帧 schema | **采用**。「不新建传输」满足:帧走同一 JSONL 通道,与 clearQueue/state 桥同族 |
| C. handler 绑定 surface 命令(domain/action) | route 声明指向已注册 surface 命令 | 复用 surface dispatch | 强迫无 surface 的 agent 先建 surface;DX 差;间接层无价值 | 否决 |

## Design Decisions

### D1:声明与实现同址(handler 函数在 AgentDefinition 内)
routes 声明含 handler 函数(`AgentRouteHandler`),与声明同在 index.ts。定义在子进程载入,函数天然可用;主进程只拿纯数据投影(name/methods/description)。DX 最优,且与「声明即 opt-in」的安全叙事一致(Req 4.4:未声明的处理器零 HTTP 可达性)。

### D2:同步等待用 clearQueue 模式,默认 20s 超时
`PiSession.invokeAgentRoute` 走 pending map + 专用结果帧 + 超时 reject(504)。不触碰 `ui_rpc_response` → SSE 的既有翻译路径。

### D3:装配期声明帧 + 服务端二次校验
runner 侧(agent-loader 归一化时)做权威校验(名称格式/唯一/方法白名单),非法→装配失败进程退出→会话创建失败(Req 1.3);主进程收帧时二次 zod 校验,非法帧丢弃并记日志(防御,routes 不挂载→404,不崩会话)。

### D4:端点为 builtin 路由 + 默认开启 + 服务端权威关断
`GET /sessions/:id/agent-routes`(清单)与 `GET|POST /sessions/:id/agent-routes/:name`(调用)注册进 create-handler 内置表;`PI_WEB_AGENT_ROUTES_DISABLED=1` 全局关断(→404)。默认开启的理由:声明行为本身是 agent 作者显式 opt-in,信任级同 agent 代码自身(与 bash 默认关的 RCE 场景不同类)。

### D5:方法白名单 GET/POST,默认 ["GET"]
v1 只允许 GET/POST(Req 1.2);声明省略 methods 时默认 `["GET"]`(演示主场景是只读查询)。

### D6:错误码字典
`ROUTE_NOT_FOUND`(404)/`METHOD_NOT_ALLOWED`(405)/`INVALID_BODY`(400)/`PAYLOAD_TOO_LARGE`(413)/`ROUTE_HANDLER_ERROR`(502)/`ROUTE_TIMEOUT`(504);401/403/会话 404 由 Router/auth 层既有语义承担。结构化错误体复用既有 `errorResponse` 形状。

### D7:前端零改动
外部调用者用普通 HTTP 客户端;PiClient/react/ui 不加 API(需求无前端消费者)。SSE 帧 union 零新增(Req 7.1 取零新增档)。
