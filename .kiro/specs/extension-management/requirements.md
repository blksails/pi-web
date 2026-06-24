# Requirements Document

## Introduction

`extension-management` 是 pi-web 依赖图最外围的特性之一,为运维/管理员提供一套**受控的扩展管理 API**,并为前端命令面板提供数据源。它把 pi 已有的 `pi install/list/remove` 资源管理能力与 `get_commands` RPC 暴露到 Web 侧,同时把 `agent-source-resolver` 定义的信任策略(`trustPolicy`)在真实安装/会话场景中**落地**。

核心张力:**扩展安装 = 远程代码执行(RCE)**。pi 官方明确警告扩展/包以完整系统权限执行任意代码;把"装扩展"开放给 Web 用户等同把 RCE 做成功能(`PLAN.md` §10.1.3)。因此本 spec 的全部安装路径必须满足**仅管理员、来源白名单 + 版本固定、`--ignore-scripts`、非交互 git env、安装审计**这一组硬约束。沙箱/容器隔离是生产硬化关注点(`PLAN.md` §11.2),本 spec 引用而不实现。

本 spec **消费而非重定义**上游契约:HTTP handler 模式 / 路由约定 / 鉴权接缝 / `createPiWebHandler`(含其 `routes?` 路由注入接缝)/ 命令面板数据源路由 `GET /sessions/:id/commands` 取自 `http-api`;`PiSession`、命令转发(含 `get_commands`)、会话重启/`new_session` 语义取自 `session-engine`;`trustPolicy(source) → "always"|"never"|"ask"` 契约取自 `agent-source-resolver`(其 PUBLIC 包入口同时暴露 `TrustDecision`、`TrustFragment` 与 `applyTrust`)。权威需求见 `PLAN.md` §10(资源体系)、§10.0.C(信任门控)、§10.1(pi packages 安装)、§10.1.3(RCE 治理)、§11.2/§11.4(沙箱/多租户)。

## Boundary Context

- **In scope**(本 spec 拥有):
  - REST 端点:`GET /extensions`(列出已安装,读 settings 或 `pi list`)、`POST /extensions`(安装,shell out `pi install <source>`)、`DELETE /extensions/:id`(卸载,`pi remove`)、`POST /sessions/:id/reload`(重启子进程 / `new_session` 重载该会话扩展)。这些路由经 `http-api` 的 `createPiWebHandler` `routes?` 注入接缝(`PiWebHandlerOptions.routes: ReadonlyArray<{method,path,handler}>`)并入路由表。
  - **安装治理**:来源白名单校验(拒绝任意 URL)、版本固定(`npm:@scope/pkg@x.y.z`、git pinned ref)、`pi install` 参数装配(含 `--ignore-scripts`)、非交互 git env(`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode)。
  - **信任落地**:把 `agent-source-resolver` 的 `trustPolicy(source)` 决策映射到 `.pi/` 项目资源加载——CLI 模式 `--approve` / `defaultProjectTrust`、custom 模式 runner 信任传递点。
  - **安全治理**:安装/卸载/重载端点的**管理员授权门控**(经 `http-api` 鉴权接缝)、安装/卸载审计记录(谁、何时、源、结果)。
- **Out of scope**(本 spec 不拥有,留给其他 spec / 未来):
  - 命令面板数据源路由 `GET /sessions/:id/commands`(归 `http-api`;本 spec 不实现该路由,仅在 reload 后/集成 e2e 场景**消费**其输出验证命令出现)。
  - 命令面板 / 扩展管理界面的 UI 渲染(归 `ui-components`)。
  - 沙箱 / 容器隔离执行(`PLAN.md` §11.2 生产硬化,本 spec 引用,不实现)。
  - 子进程 spawn、JSONL framing、`PiRpcChannel`(归 `rpc-channel`)。
  - 会话对象、事件广播、事件→UIMessage 翻译、`get_commands` 的 RPC 转发实现本身(归 `session-engine`,仅消费其 `PiSession` 契约)。
  - agent 源解析、`spawnSpec` 生成、`trustPolicy` 默认值与决策算法本身(归 `agent-source-resolver`,仅消费其决策结果并落地)。
  - HTTP handler 工厂、`Router`、`createPiWebHandler` 的 `routes?` 注入接缝接口、SSE 编码、鉴权接缝接口、`GET /sessions/:id/commands` 路由本体(归 `http-api`,本 spec 经 `routes?` 接缝注册自身四路由并复用其鉴权接缝,且消费其命令面板路由输出)。
  - protocol 类型 / zod schema / `protocolVersion` 常量定义(归 `protocol-contract`,仅消费)。
  - 完整多租户隔离 / 密钥管理 / per-tenant agentDir 落地(`PLAN.md` §11.4 生产硬化,留接缝)。
- **Adjacent expectations**:
  - 仅在 **Node runtime** 运行;`pi install`/`pi list`/`pi remove` 经 `node:child_process` 调用系统 `pi` CLI;依赖 `git`(git 源)与受管的 npm 安装环境。
  - 安装写入 `settings.json` 后,**新建会话**自动加载新扩展;**已有会话**需经 `POST /sessions/:id/reload` 重启子进程 / `new_session` 才生效(`PLAN.md` §10.1.2)。
  - 管理员授权依赖 `http-api` 的 `authResolver`/`authorizeSession` 接缝产出的身份/角色上下文;本 spec 定义"安装类操作需管理员"的判定,但不实现具体身份认证机制。
  - e2e 依赖一个本地 fixture 扩展(`.pi/extensions` 或本地 pi package)+ `session-engine` 经 rpc-channel 起 agent 子进程(stub 或真实 `pi --mode rpc`)。

## Requirements

### Requirement 1: 列出已安装扩展(GET /extensions)

**Objective:** 作为运维/管理员,我想要列出当前已安装的扩展(全局与项目级),以便了解 agent 可用的能力来源并据此做启用/卸载决策。

#### Acceptance Criteria

1. When 收到 `GET /extensions` 请求, the Extension Management Service shall 通过读取 settings 或调用 `pi list` 返回已安装扩展清单,每条含来源标识、来源类型(npm/git/local)、版本/ref(如有)与作用域(全局/项目)。
2. Where 同时存在全局与项目级扩展, the Extension Management Service shall 在响应中区分并标注各条目的作用域。
3. If `pi list` 调用失败或 settings 不可读, the Extension Management Service shall 返回明确的错误响应(非 500 的可识别错误码或带原因摘要的 500),且不泄露 env 敏感值。
4. When 没有任何已安装扩展, the Extension Management Service shall 返回空列表而非错误。
5. The Extension Management Service shall 使响应形状以 `@blksails/protocol` 定义的扩展列表 DTO 为准,不自定义字段命名。

### Requirement 2: 受控扩展安装(POST /extensions)

**Objective:** 作为管理员,我想要通过受控接口安装扩展,以便在不直接接触服务器命令行的情况下扩展 agent 能力,同时把 RCE 风险约束在白名单与版本固定之内。

#### Acceptance Criteria

1. When 收到 `POST /extensions` 且请求体含有效 `source`, the Extension Management Service shall 在通过来源白名单与版本固定校验后,shell out 执行 `pi install <source>` 并返回安装结果。
2. If 请求体缺少 `source` 或 `source` 类型/格式非法, the Extension Management Service shall 返回 400 并附字段路径,不执行任何安装命令。
3. If `source` 不匹配来源白名单(例如任意 `http(s)://` URL、未列入白名单的 npm scope 或 git host), the Extension Management Service shall 拒绝安装并返回明确的拒绝错误,不执行 `pi install`。
4. If `source` 未固定版本(npm 缺 `@x.y.z`、git 缺 pinned ref), the Extension Management Service shall 拒绝安装并返回要求版本固定的错误,不执行 `pi install`。
5. When 装配 `pi install` 命令参数, the Extension Management Service shall 始终包含 `--ignore-scripts`(禁 npm 生命周期脚本),并在 git 源场景注入非交互 env(`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode)。
6. If `pi install` 子进程以非零码退出或超时, the Extension Management Service shall 返回安装失败错误(含原因摘要,剥离 env 敏感值),并保证不产生半完成的成功响应。
7. While 一次安装命令正在执行, the Extension Management Service shall 以非交互方式运行子进程(不挂起等待终端输入)。

### Requirement 3: 扩展卸载(DELETE /extensions/:id)

**Objective:** 作为管理员,我想要卸载已安装的扩展,以便移除不再需要或不可信的能力来源。

#### Acceptance Criteria

1. When 收到 `DELETE /extensions/:id` 且 `:id` 指向已安装扩展, the Extension Management Service shall shell out 执行 `pi remove <source>` 并返回卸载结果。
2. If `:id` 不对应任何已安装扩展, the Extension Management Service shall 返回 404,不执行 `pi remove`。
3. If `pi remove` 子进程以非零码退出或超时, the Extension Management Service shall 返回卸载失败错误(含原因摘要,剥离 env 敏感值)。
4. The Extension Management Service shall 以非交互方式执行卸载子进程。

### Requirement 4: 会话扩展重载(POST /sessions/:id/reload)

**Objective:** 作为管理员/用户,我想要在不丢失会话入口的前提下让已有会话加载新安装的扩展,以便安装后立即在该会话使用,而无需手动新建会话。

#### Acceptance Criteria

1. When 收到 `POST /sessions/:id/reload` 且会话存在且处于活动状态, the Extension Management Service shall 触发该会话子进程的重载——以重启子进程或 `new_session` 的方式重建会话运行时,使其加载最新扩展。
2. If `:id` 不对应任何会话, the Extension Management Service shall 返回 404。
3. If 目标会话已停止, the Extension Management Service shall 返回 409,不尝试重载。
4. When 重载完成, the Extension Management Service shall 返回 ack,且重载后会话可被检索并接受命令转发。
5. While 重载进行中, the Extension Management Service shall 保证不静默丢弃重载请求(以错误或 ack 明确收束)。

### Requirement 5: 命令面板数据源(消费 http-api 的 GET /sessions/:id/commands)

**Objective:** 作为本特性,我想要把命令面板数据源对齐到 `http-api` 拥有的 `GET /sessions/:id/commands`,以便安装/重载扩展后能验证该会话的 `/命令`(extension / prompt / skill)正确出现;该路由本身由 `http-api` 实现,本特性不重复实现。

> 注:`GET /sessions/:id/commands` 的路由处理器、`PiSession.getCommands()`/RPC `get_commands` 透传、命令清单 DTO 形状均归 `http-api`(及其下游 `session-engine`/`@blksails/protocol`)。本特性**仅消费**该路由的输出作为命令面板数据源,不拥有该端点。

#### Acceptance Criteria

1. The Extension Management Service shall 把命令面板数据源对齐到 `http-api` 拥有的 `GET /sessions/:id/commands`,而不在本特性内实现该路由或重复定义其命令清单 DTO。
2. When 一次安装后经新会话或 `POST /sessions/:id/reload` 使扩展生效, the Extension Management Service shall 经消费 `http-api` 的 `GET /sessions/:id/commands` 在集成/e2e 中验证该扩展注册的 `/命令` 出现(来源 extension/prompt/skill)。
3. The Extension Management Service shall 不实现命令展开、命令清单 DTO 形状定义或 "/" 命令面板的 UI 渲染(分别归 `http-api`/`@blksails/protocol`/`ui-components`)。

### Requirement 6: 信任策略落地(.pi/ 项目资源)

**Objective:** 作为系统,我想要把 `agent-source-resolver` 的 `trustPolicy(source)` 决策在安装/会话创建场景中正确落地,以便 `.pi/` 项目扩展/skills/prompts 在显式信任时被加载、在默认 `ask` 时被安全忽略,消除"扩展明明在却没加载"的静默失败。

#### Acceptance Criteria

1. When 创建会话或重载时一个来源被 `trustPolicy` 判定为 `"always"` 且会话为 CLI 模式, the Extension Management Service shall 使该会话的 `.pi/` 项目资源被加载(经 `--approve` 或该会话 agentDir 的 `defaultProjectTrust:"always"`)。
2. When 一个来源被 `trustPolicy` 判定为 `"always"` 且会话为 custom 模式, the Extension Management Service shall 经 spawnSpec 向 runner 传递信任 `.pi/` 的决策信号(承接 `agent-source-resolver` 的 custom 落地约定)。
3. While `trustPolicy` 判定为 `"ask"`(默认)或 `"never"`, the Extension Management Service shall 不向子进程传递任何 `.pi/` 项目资源放行信号(headless 下默认忽略 `.pi/` 项目资源)。
4. The Extension Management Service shall 在任何信任取值下都不抑制 context 文件(`AGENTS.md`/`CLAUDE.md`)与全局/用户扩展的加载。
5. While 在 headless / 非交互模式运行, the Extension Management Service shall 保证信任落地不产生交互式提示或挂起。
6. The Extension Management Service shall 消费 `agent-source-resolver` 暴露的 `trustPolicy` 决策结果,而不重定义其默认值或决策算法。

### Requirement 7: 安装类操作的管理员授权门控

**Objective:** 作为安全责任方,我想要把扩展安装/卸载/会话重载限定为仅管理员可执行,以便把 RCE 风险控制在受信任的运维角色,普通用户无法触发任意代码安装。

#### Acceptance Criteria

1. While 处理 `POST /extensions`、`DELETE /extensions/:id`、`POST /sessions/:id/reload`, the Extension Management Service shall 先经 `http-api` 鉴权接缝判定调用方是否具备管理员权限,非管理员一律拒绝。
2. If 调用方未通过管理员判定, the Extension Management Service shall 返回 403(已认证但无权限)或 401(未认证),不执行任何安装/卸载/重载命令。
3. Where 鉴权接缝未配置(默认放行), the Extension Management Service shall 以可配置的"管理员判定策略"接缝决定默认行为,并将该默认作为显式可见的安全决策(不静默把任意调用方视为管理员)。
4. The Extension Management Service shall 对其拥有的只读端点(`GET /extensions`)不强制管理员门控(其授权沿用 `http-api` 默认会话授权语义);`GET /sessions/:id/commands` 的授权归 `http-api`(本特性不拥有该路由)。
5. The Extension Management Service shall 复用 `http-api` 的鉴权接缝(`authResolver`/`authorizeSession`)而非自建身份认证机制。

### Requirement 8: 安装审计记录

**Objective:** 作为安全/合规责任方,我想要每次扩展安装/卸载都留下审计记录,以便事后追溯"谁、何时、对哪个源、做了什么、结果如何"。

#### Acceptance Criteria

1. When 一次安装或卸载操作被发起(无论成功或失败), the Extension Management Service shall 产生一条审计记录,至少包含操作者身份(来自鉴权上下文)、时间戳、操作类型、来源标识与结果(成功/失败 + 原因摘要)。
2. The Extension Management Service shall 保证审计记录不包含 env 敏感值(provider key、凭据等)。
3. The Extension Management Service shall 经可注入的审计接缝(`onAudit` 钩子或等价)产出记录,默认实现至少结构化输出,使生产可替换为持久化落库(`PLAN.md` §11.7)。
4. If 白名单/版本固定校验在执行命令前拒绝了一次安装, the Extension Management Service shall 仍产生一条标注"被拒绝"及拒绝原因的审计记录。

### Requirement 9: 非功能约束与安全边界

**Objective:** 作为系统,我想要把 RCE、非交互执行、敏感数据与运行时前提作为显式约束,以便部署方清楚本特性的安全假设与边界。

#### Acceptance Criteria

1. The Extension Management Service shall 把扩展安装视为 RCE,并将沙箱/容器隔离声明为生产硬化关注点(`PLAN.md` §11.2),本特性不在宿主裸跑环境中实现隔离,仅引用。
2. While 执行任何 `pi`/git 子进程, the Extension Management Service shall 注入非交互 env(`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode),并对子进程设置超时上限以防挂起。
3. The Extension Management Service shall 在所有错误响应、审计记录与日志中剥离 env 敏感值与子进程完整命令行中的凭据。
4. The Extension Management Service shall 仅在 Node runtime 运行,经 `node:child_process` 调用系统 `pi` CLI,不在 Edge/Serverless 假设下工作。

### Requirement 10: 可测试性(测试 + e2e 硬性要求)

**Objective:** 作为项目维护者,我想要本特性具备可由单一命令运行的单元/集成/e2e 测试,并以新鲜运行证据证明通过,以便满足项目对"测试 + e2e(硬性)"的强制要求。

#### Acceptance Criteria

1. The Extension Management Service shall 提供单元测试覆盖:来源白名单拒绝任意 URL/非白名单源、版本固定校验、`pi install` 参数装配(含 `--ignore-scripts` 与非交互 git env)、信任决策落地映射、审计记录内容与脱敏。
2. The Extension Management Service shall 提供集成测试:对一个本地 fixture 扩展执行 `install → list`(列表出现该扩展)→ 在新会话经消费 `http-api` 拥有的 `GET /sessions/:id/commands`(本特性不实现该路由)出现该命令 → `remove`(列表移除该扩展),子进程行为以真实 `pi` 或受控替身验证。
3. The Extension Management Service shall 提供 e2e 测试:安装一个本地 `.pi/extensions` 或 pi package → 经新会话或 `POST /sessions/:id/reload` 后经消费 `http-api` 拥有的 `GET /sessions/:id/commands` 含该扩展注册的 `/command` → 通过 prompt 调用该命令使其生效。
4. The Extension Management Service shall 使全部单元/集成/e2e 测试可由单一命令运行,并在真实 `pi` 不可用时回退到受控替身。
5. The Extension Management Service shall 使涉及子进程的逻辑(命令装配、白名单、信任、审计)以可注入/可 mock 的边界设计,使核心决策可脱离真实子进程单测。
