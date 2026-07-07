# Requirements Document

## Project Description (Input)
source 声明式 agent routes(agent-declared HTTP routes):让 agent source 在 AgentDefinition 声明具名 routes,pi-web 服务端按会话命名空间挂载 HTTP 端点(形如 POST /api/sessions/:id/agent-routes/&lt;name&gt;),将 HTTP 请求经统一命令层(ui-rpc 命令,同步 HTTP 响应体,禁走 SSE 空闲控制流)转发进 agent 子进程的 extension 处理器,响应原路同步返回。

含:鉴权与会话归属校验、方法/名称白名单、payload 大小上限、agent busy 时语义、新顶层 API 段的 Next catch-all 转发器(避免静默 404)、agent-kit 类型面(AgentDefinition.routes)与装配期接线;并在 examples/aigc-canvas-agent 落一个演示 route(如画廊统计/canvas 数据查询)+ 浏览器 e2e。

架构约束:pi JSONL agent→server 仅 event/response/extension_ui_request 三类,route 转发必须骑在既有 ui-rpc 请求-响应通道上,协议(sse-frame union)零新增或最小新增。

背景:pi-web 现有 `routes:` 注入接缝(`InjectedRoute`)为宿主装配层专用(`lib/app/pi-handler.ts`),agent source(examples 目录/外部源)无法声明自己的 HTTP 端点;「请求-响应」语义现只能经统一命令层(`client.uiRpcCommand` → ui-rpc → agent extension 命令处理器)由前端发起。本特性面向需要**外部系统(curl/webhook/第三方服务)直接打进 agent** 的场景,把 HTTP 面桥接到既有命令通道上。

## Introduction

pi-web 的 agent 以「一会话一子进程」运行,现有对外 HTTP 面全部由宿主装配层定义;agent source 作者没有任何手段把自己 agent 的能力暴露成可被外部系统(curl / webhook / 第三方服务)直接调用的 HTTP 端点。本特性引入 **source 声明式 agent routes**:agent 作者在 agent 定义中声明具名 routes,pi-web 服务端将其挂载为**以会话为锚**的 HTTP 端点,请求经既有 agent 命令通道转发进该会话的 agent 子进程处理,响应在同一个 HTTP 请求-响应周期内同步返回。

「以会话为锚」是本特性的根本形态约束:agent 进程的生命周期跟随会话,不存在会话之外可接收请求的 agent 进程,故所有 agent route 均要求调用方持有目标会话标识。

## Boundary Context

- **In scope**:agent 定义中的 routes 声明面与装配期校验;会话命名空间下的 HTTP 端点挂载与请求转发闭环(同步响应);route 清单的可发现性;鉴权/会话归属/请求体上限/运维关断;agent 忙碌(流式生成中)时的行为;examples/aigc-canvas-agent 演示 route + 浏览器 e2e。
- **Out of scope**:流式/分块响应的 route(仅同步 JSON 响应);不锚定会话的全局 routes(无会话即无 agent 进程);跨会话广播或聚合调用;宿主 `routes:` 注入接缝的行为变更;pi SDK(上游 npm 包)的任何改动;webhook 注册/回调管理等更上层编排。
- **Adjacent expectations**:请求转发复用既有 agent 命令请求-响应通道(unified-command-result-layer / surface 桥接先例),本特性不新建 agent↔server 传输;鉴权复用既有请求级/会话级两层接缝,agent-route 端点与其他会话级端点同门;请求体上限沿附件上传「按声明长度提前拒绝」先例;会话命名空间下的路径已被既有 sessions API 段整体转发,新端点不得出现「可声明但静默 404」的挂载缺口。

## Requirements

### Requirement 1:routes 声明面(agent 作者)

**Objective:** As an agent source 作者, I want 在 agent 定义中声明具名 routes(名称、HTTP 方法、对应的 agent 侧处理器), so that 不改 pi-web 宿主代码就能把 agent 能力暴露为 HTTP 端点。

#### Acceptance Criteria
1.1 The agent 定义类型面 SHALL 支持可选的 routes 声明列表,每项至少含:route 名称、允许的 HTTP 方法、agent 侧处理器标识;未声明 routes 的 agent 定义完全不受本特性影响(类型与运行时行为均零变化)。
1.2 When 装配期载入的 agent 定义含 routes 声明 THEN 装配层 SHALL 校验每项声明:名称非空且仅含小写字母/数字/连字符、同一定义内名称唯一、HTTP 方法属于允许集合(GET/POST)。
1.3 If routes 声明校验失败 THEN 装配层 SHALL 以含 route 名称与失败原因的明确错误使会话创建失败,而非静默忽略该声明。
1.4 When agent 定义声明了合法 routes 且会话创建成功 THEN 系统 SHALL 使这些 routes 在该会话的 HTTP 命名空间下立即可调,无需额外的宿主端配置。

### Requirement 2:HTTP 挂载与可发现性(外部调用者)

**Objective:** As an 外部系统集成者, I want 按稳定的会话命名空间 URL 调用 agent 声明的 routes 并能枚举可用清单, so that 无需阅读 agent 源码即可完成集成。

#### Acceptance Criteria
2.1 When 调用方以声明允许的方法请求 `/api/sessions/{sessionId}/agent-routes/{name}` 且该会话的 agent 声明了 `{name}` THEN 系统 SHALL 受理请求并进入转发流程(Requirement 3)。
2.2 If 请求的 `{name}` 未被该会话的 agent 声明 THEN 系统 SHALL 返回 404 与结构化错误体(含错误码与消息)。
2.3 If 请求方法不在该 route 声明允许的方法集合内 THEN 系统 SHALL 返回 405 与结构化错误体。
2.4 If 目标会话不存在 THEN 系统 SHALL 返回 404(与既有会话级端点的「会话不存在」语义一致)。
2.5 When 调用方 GET `/api/sessions/{sessionId}/agent-routes` THEN 系统 SHALL 返回该会话当前可用的 route 清单(名称与允许方法),对未声明任何 routes 的会话返回空清单而非错误。
2.6 The 系统 SHALL 保证上述端点在整站部署形态下可达:不允许出现「服务端已挂载但 HTTP 层静默 404」的挂载缺口(既有顶层 API 段转发覆盖须经测试证明)。

### Requirement 3:请求转发与同步响应闭环

**Objective:** As an 外部系统集成者, I want 请求被转发进目标会话的 agent 处理器并在同一 HTTP 请求-响应周期内拿到结果, so that 集成方无需订阅任何流即可完成一次调用。

#### Acceptance Criteria
3.1 When 受理的 route 请求进入转发 THEN 系统 SHALL 把请求上下文(route 名称、HTTP 方法、URL 查询参数、JSON 请求体)传递给该会话 agent 子进程中与声明绑定的处理器。
3.2 When agent 处理器正常返回 THEN 系统 SHALL 以 200 与处理器返回的 JSON 结果作为 HTTP 响应体同步返回给调用方(同一请求-响应周期,不经任何 SSE/事件流)。
3.3 If agent 处理器执行抛错或返回结构化失败 THEN 系统 SHALL 返回 502 与结构化错误体(含处理器侧错误消息),不使 HTTP 请求悬挂。
3.4 If agent 在转发超时时限内未响应 THEN 系统 SHALL 返回 504 与结构化错误体;超时时限 SHALL 有确定的默认值并可由运维配置。
3.5 The route 调用 SHALL 不触发 LLM 推理轮、不向对话历史注入任何消息、不在对话 UI 产生任何可见变化(既有对话流帧序不受影响)。
3.6 If 请求体不是合法 JSON(对声明为需要请求体的方法) THEN 系统 SHALL 返回 400 与结构化错误体,不进入转发。

### Requirement 4:鉴权、请求体上限与运维关断

**Objective:** As a pi-web 运维者, I want agent-route 端点与既有安全面同门,并有请求体上限与全局关断, so that 新暴露面不引入越权、资源滥用或不可控风险。

#### Acceptance Criteria
4.1 The agent-route 全部端点(含清单端点) SHALL 与既有会话级端点适用同一请求级鉴权与会话级授权门:请求级拒绝返回 401,会话归属拒绝返回 403。
4.2 If 请求声明的内容长度超过请求体上限 THEN 系统 SHALL 返回 413 与结构化错误体,且不读取完整请求体;上限 SHALL 有确定的默认值并可由运维配置。
4.3 Where 运维经服务端配置显式关断 agent routes 能力 THEN 系统 SHALL 对全部 agent-route 端点返回 404,agent 声明与会话其余功能不受影响;该能力默认开启(声明即生效)。
4.4 The route 处理器 SHALL 只能经声明绑定被调用:未在声明中出现的 agent 侧命令/处理器不因本特性获得任何新的 HTTP 可达性。

### Requirement 5:agent 忙碌与并发语义

**Objective:** As an 外部系统集成者, I want agent 正在流式生成时 route 调用仍有确定行为, so that 集成方无需感知会话的对话状态。

#### Acceptance Criteria
5.1 While 目标会话的 agent 正在流式生成(忙碌) WHEN route 请求到达 THEN 系统 SHALL 照常受理并转发,响应仍在同一 HTTP 请求-响应周期内返回(或按 Requirement 3 的错误语义收敛)。
5.2 The route 调用 SHALL 不中断、不排队阻塞、不破坏正在进行的流式回复(既有 prompt 流回归测试保持全绿)。
5.3 When 多个 route 请求并发到达同一会话 THEN 系统 SHALL 各自独立配对请求与响应,不发生响应串扰(以并发测试证明)。

### Requirement 6:演示与文档(examples/aigc-canvas-agent)

**Objective:** As an agent source 作者, I want 一个可运行的官方演示与配套文档, so that 照抄即可为自己的 agent 声明 routes。

#### Acceptance Criteria
6.1 The examples/aigc-canvas-agent SHALL 声明至少一个演示 route(如画廊/canvas 快照统计查询),外部以 HTTP 客户端(如 curl)携会话标识调用即返回结构化 JSON。
6.2 The 演示 SHALL 在该 example 的 README 记载:声明方式、URL 形态、如何取得会话标识、一次完整调用示例与预期响应。
6.3 When 演示 route 被调用 THEN 该会话的对话 UI SHALL 无任何可见变化(印证 Requirement 3.5)。
6.4 The 产品手册 SHALL 新增/更新对应章节内容,覆盖声明面、端点形态、错误语义与安全门。

### Requirement 7:兼容与回归

**Objective:** As a pi-web 维护者, I want 本特性对既有协议与行为零破坏, so that 存量 source、前端与集成不受影响。

#### Acceptance Criteria
7.1 The 特性 SHALL 不改变既有 SSE 帧的种类与语义面向既有消费者的行为(协议面零新增或最小新增,新增项对旧前端不可见或可忽略)。
7.2 The 未声明 routes 的存量 agent source SHALL 在会话创建、对话、命令、附件等全部既有行为上零变化(全量回归测试保持全绿)。
7.3 When 特性完成 THEN 单元/集成测试与浏览器 e2e SHALL 以新鲜运行输出证明:声明→挂载→HTTP 调用→agent 处理→同步响应的闭环,及 404/405/400/413/502/504/401/403 错误语义。
