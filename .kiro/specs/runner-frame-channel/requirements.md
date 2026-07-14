# Requirements Document

## Introduction

`packages/server/src/runner` 是 pi-web server(父进程)与 agent runner(子进程)之间的接线层。其中四个入站桥 —— `state-wiring.ts` / `surface-wiring.ts` / `clear-queue-wiring.ts` / `agent-routes-wiring.ts` —— 是**同一套父子 IPC 机制的逐字重复**:各自重声明一份流接口、各挂一个 `stdin` data 读取器、各建一个 JSONL 行解析器(同一行 stdin 被解析四遍)、各写一遍上行 writer 选择、过滤骨架与幂等 cleanup。

第一性表述:server ↔ runner 之间本质是**一条 IPC 通道**,承载「pi RPC」与「pi-web 自定义帧」两层叠加协议,按 `frame.type` 解复用。本 spec 把四根平行线收敛为**一条带类型的帧通道 + 一张按 type 注册的 handler 表**,抽取共享原语,并把「上行只走 RPC 行通道」「声明帧在接管前发」两条既有隐性约束固化为可强制、可测试的不变式。这是一次**纯行为保持(zero behavior change)重构**:对 server、UI、agent 以及本地/云两种运行模式,外部可观测行为逐字不变。

## Boundary Context

- **In scope**:`packages/server/src/runner/` 下四个入站桥的收敛;新增共享原语模块(帧通道/上行 writer/装配期声明帧/批量释放/集中 seam key);`runner.ts` 装配序与收尾的对应改写;共享原语与迁移后各桥的单元测试;与既有 `rpc-channel` 的 `JsonlLineReader` 衔接。
- **Out of scope**:不改 pi-clouds 仓(cloud-bridge / agent-runner / sandbox)、不改 pi 上游、不改任何线协议帧的格式或字段(帧 schema 冻结);`attachment-wiring`(tool hook 组合)与 `session-title-wiring`(prototype patch)两机制不重写、不并入帧通道;不改各桥面向 UI 的语义。
- **Adjacent expectations**:依赖 pi 的 `runRpcMode`/`takeOverStdout` 现有行为不变;依赖沙箱内 `agent-runner` 全量转发子进程 stdout 行、cloud-bridge 行无关字节泵的现有契约(本 spec 不修改它们,只要求继续满足);seam key 必须与 `@blksails/pi-web-tool-kit` 侧常量保持一致。

## Requirements

### Requirement 1: 单一入站帧通道与类型注册表

**Objective:** 作为 pi-web runner 维护者,我希望有一条按 `frame.type` 分发的单一入站帧通道,以便新增父子消息类型只需注册一个 handler,而非复制整套 stdin 读取骨架。

#### Acceptance Criteria

1. The Frame Channel shall 在 runner 子进程内对 `process.stdin` 只安装一个 data 读取器、只维护一个 JSONL 行解析器,供所有已注册帧类型共享。
2. When 调用方以 `(type, schema, handler)` 注册一个帧类型, the Frame Channel shall 返回一个解绑句柄,并在后续收到匹配 `type` 且通过该 `schema` 校验的行时调用对应 handler。
3. When 收到一行不匹配任何已注册帧类型(pi RPC 命令行、他桥请求行、非 JSON 行), the Frame Channel shall 放行该行(不消费、不回包、不干预),使 pi 自身的 stdin 读取器继续处理它。
4. If 一行匹配某注册 `type` 但未通过其 `schema` 校验, the Frame Channel shall 丢弃该畸形行且不调用 handler、不抛出。
5. The Frame Channel shall 支持在测试中注入替代的可读输入流,而不改变生产默认(`process.stdin`)。

### Requirement 2: 上行输出统一走 RPC 行通道(fd1 不变式)

**Objective:** 作为运维者,我希望 handler 产生的所有上行帧都落在承载 pi RPC 事件的同一行通道上,以便这些帧在本地与 ACS sandbox 云链路下都能抵达 server,而非静默丢失。

#### Acceptance Criteria

1. When 一个 handler 需要回送或推送一帧, the Frame Channel shall 经统一的上行 writer 将其写入进程原始 stdout 文件描述符(即承载 pi RPC 帧的同一 `{type:"line"}` 通道)。
2. The Frame Channel 提供的 handler 上下文 shall 只暴露「经统一 writer 发帧」这一条上行出口,使 handler 在正常用法下无需也无从经 `process.stdout.write` 发出运行期帧。
3. While runner 处于 pi RPC 模式(`takeOverStdout` 已生效), the Frame Channel shall 保证运行期上行帧不被重定向到 stderr(即不经被接管的 `process.stdout`)。
4. The 上行 writer shall 支持在测试中注入替代的可写出口以捕获写出内容,且注入不改变生产默认(直写原始 fd1)。
5. When 上行 writer 写出一帧, the Frame Channel shall 以单次原子写发出完整一行(含行尾换行),不与其他写入交织成半行。

### Requirement 3: 装配期声明帧的时序与通道

**Objective:** 作为 pi-web runner 维护者,我希望装配期一次性声明帧(如 slash 补全、路由声明)在 pi 接管 stdout 之前经装配窗口发出,以便它们进入 RPC 行通道而非日志通道。

#### Acceptance Criteria

1. When runner 在进入 `runRpcMode` 之前发出装配期声明帧, the 装配层 shall 经装配窗口 stdout 写出该帧(此窗口 `process.stdout` 仍指向原始 fd1)。
2. Where 一个能力无声明内容(无 slash 补全、无路由), the 装配层 shall 不发出任何声明帧(存量 source 零行为变化)。
3. The 装配期声明帧写出 shall 支持测试注入替代出口,且注入不改变生产默认。
4. The 装配层 shall 保证所有装配期声明帧在 `runRpcMode(runtime)` 调用之前完成写出。

### Requirement 4: 四个入站桥迁移且行为逐字保持

**Objective:** 作为 pi-web 用户与 agent 作者,我希望 state / surface / clear-queue / agent-routes 四项能力在重构后行为完全不变,以便共享状态、surface 命令、队列取回、声明式路由继续如常工作。

#### Acceptance Criteria

1. When 收到 `piweb_state_set` / `piweb_state_delete` 写回行, the 状态桥 shall 改动权威状态核并如重构前一样触发下行 `piweb_state` 变更帧(键、值、rev、deleted 语义不变)。
2. When 收到 `ui_rpc` 行且其为 surface 命令(`point=command` / `action=execute` / 合法 `SurfaceCommandPayload`), the surface 桥 shall 按 `domain` 派发并回送 `ui_rpc_response`(含 `correlationId`、`ok`、`result`);未注册 domain 仍回 `surface_not_registered`。
3. When 收到 `piweb_clear_queue` 请求行, the 取回桥 shall 调当前绑定 session 的 `clearQueue()` 并回送 `piweb_clear_queue_result`(含 `id`、`steering`、`followUp`);`clearQueue` 抛错时回空结果不吞语义。
4. When 归一化 routes 非空, the 路由桥 shall 在装配期发一条 `agent_routes` 纯数据声明帧(不含 handler 引用),并在收到 `piweb_agent_route_request` 时按 `name` 派发 handler、回送 `piweb_agent_route_result`;未注册回 `route_not_registered`、handler 抛错回 `handler_error`、返回值不可序列化回 `handler_error`。
5. Where 某桥无声明/无注册(空 routes、无 surface 注册、store env 缺失), the 对应桥 shall 保持重构前的惰性 no-op 与优雅降级行为,不影响未使用该能力的会话。
6. The 四个桥迁移 shall 不改变各自面向 server 与 UI 的帧类型、字段与错误码。

### Requirement 5: 机制 C 两桥保持独立不并入通道

**Objective:** 作为 pi-web runner 维护者,我希望进程内 hook 拦截类接线不被强行塞入跨进程帧通道,以便重构边界清晰、不引入错误抽象。

#### Acceptance Criteria

1. The 重构 shall 不改变 `attachment-wiring`(组合 `agent.beforeToolCall`/`afterToolCall`)的行为与对外接口。
2. The 重构 shall 不改变 `session-title-wiring`(prototype-patch `session.bindExtensions`)的行为与对外接口。
3. The 重构 shall 不将上述两机制迁移进帧通道或使其依赖帧通道。

### Requirement 6: 能力对象契约、幂等清理与统一释放

**Objective:** 作为 pi-web runner 维护者,我希望每个接线仍返回一致的能力对象、清理保持幂等,且 runner 收尾以统一方式释放所有接线,以便消除重复的 try/catch 并保证会话结束不泄漏。

#### Acceptance Criteria

1. The 每个迁移后的接线 shall 继续返回带 `installed`(或 `available`)与 `cleanup` 的能力对象。
2. When `cleanup` 被多次调用, the 对应接线 shall 保持幂等(仅第一次生效),并卸载其读取器/订阅/seam。
3. When runner 会话生命周期结束(`SIGTERM`/`SIGINT`/`beforeExit`), the 装配层 shall 统一遍历释放所有接线,单个接线释放抛错时记录诊断并继续释放其余,绝不因单点失败中断收尾。
4. If 帧通道或任一接线在安装阶段失败, the 装配层 shall 记录诊断、降级该能力并继续启动会话(不抛出、不崩溃)。

### Requirement 7: 共享原语的单一权威与可测试性

**Objective:** 作为 pi-web runner 维护者,我希望流接口、上行 writer、帧通道、装配期发帧、批量释放与 seam key 各有单一权威来源并可独立单测,以便协议管道不再随每次新增而漂移。

#### Acceptance Criteria

1. The 共享原语模块 shall 单一处声明可读/可写流的最小视图接口,替换原先四份重复声明。
2. The 各 globalThis seam key(会话状态、surface 注册表、attachment 工具上下文)shall 集中于单一常量来源,并标注须与 tool-kit 侧一致。
3. The 帧通道、上行 writer、装配期发帧、批量释放 shall 各自具备独立单元测试,覆盖注册/分发/放行/畸形丢弃/幂等 cleanup/失败降级。
4. The 重构 shall 复用既有 `rpc-channel` 的 `JsonlLineReader`,不另造行解析器。

### Requirement 8: 本地与 ACS sandbox 云链路行为等价

**Objective:** 作为运维者,我希望重构后的父子帧协议在本地 pi-web 模式与经 ACS sandbox 的云模式下行为完全等价,以便「云上运行必须兼容 pi-web 模式」这一约束得到保证。

#### Acceptance Criteria

1. The 重构后的父子帧协议 shall 保持为纯 JSONL、每帧自包含且可 JSON 序列化,不引入除「一行写 fd1 / 一行进 stdin」以外的 fd 级旁路或非行传输假设。
2. While 经 ACS sandbox 三跳线泵(server → 行无关 cloud-bridge → 全量转发的 agent-runner → 沙箱内 runner)运行, the 帧通道 shall 使所有入站与上行自定义帧与本地模式逐字一致地送达。
3. When 断线重连触发 ring-buffer 重放, the 上行帧 shall 因每帧自包含且请求-响应帧携带 `correlationId`/`id` 而在 server 侧安全去重或按无 pending 丢弃(不产生重复副作用)。
4. The 重构 shall 不要求对 pi-clouds 仓做任何配套改动即在云链路生效。

### Requirement 9: 验收基线为零行为变更且既有测试全绿

**Objective:** 作为发布把关者,我希望本次纯管道重构以既有测试与 e2e 全绿为硬性验收,以便确认没有任何回归。

#### Acceptance Criteria

1. When 运行 `packages/server` 既有单元测试(含四桥各自既有测试), the 测试套件 shall 全部通过。
2. When 运行浏览器与 node e2e 套件, the 相关用例 shall 全部通过(排除与本 spec 无关的既有已知失败)。
3. The 重构 shall 不新增或修改任何面向外部的帧 schema、CLI 参数或配置项。
4. Where 引入新增共享原语模块, the 该模块 shall 附带独立单元测试且随套件一并通过。
