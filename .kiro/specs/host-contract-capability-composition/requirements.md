# Requirements Document

## Introduction

本 spec 是 pi-web 宿主契约 v1 的 **M3 里程碑**:建 `defaultCapabilities()` 并让 **pi-web 自身的路由装配改为经 `composeCapabilities()`**(契约 §8.3 M3)。

M1(`host-contract-ports`)已交付泛型引擎 `composeCapabilities<TDeps,TRoute>(input)`、描述符类型 `CapabilityDescriptor<TDeps,TRoute>` / `CapabilityDecision` 与 16 项冻结名册 `HOST_CAPABILITY_IDS_V1`,但**刻意未绑定真实工厂**(M1 `types.ts` 注释明言「校验落点在 M3 接入 `pi-handler.ts`、`TDeps` 收敛为具体依赖对象之后」)。M3 完成这最后一步。

**动机**(契约 §5.2 / 集成设计 §3):pi-web 的能力面今天只有**一处权威装配点** —— `lib/app/pi-handler.ts` 的 `routes` 数组(15 个注入式路由工厂 + 独立的 `hostCommands`)。pi-clouds **完全重写**了这个数组(只保留 5 组、无 `hostCommands`),导致 **12 个能力面在云端静默消失**(`pi-clouds/apps/cloud/lib/handler.ts:487-505`),「漏掉」与「有意弃用」在架构上不可区分、零编译信号、零运行时信号。M3 把这件事变成:宿主必须对**每个** id 显式 `use`/`replace`/`decline`,未表态即**组装期抛错**。

M3 是**纯装配重构**:pi-web 本地经 compose 装配后,注入的路由集与 `hostCommands` 必须与现状**逐一致(行为零变化)**。真正的价值是让这条装配路径成为两端(pi-clouds C2、desktop D4)必须遵守的强制表态入口。

**权威依据**:`docs/pi-web-host-contract-v1.md` §5(P3 能力面清单)、§5.3(16 id 冻结名册)、§8.3(M3);集成设计 `docs/desktop-cloud-integration-design.md` §3(R3 能力面清单契约)。所有现状事实(文件:行号)见下方各需求。

## Boundary Context

- **In scope**:
  - 新建 `defaultCapabilities(deps: HostDeps): readonly CapabilityDescriptor<HostDeps, HostContribution>[]`,返回 §5.3 的 **16 个** descriptor,各 id 绑定现有工厂。
  - 收敛泛型 `TDeps` → 具体 `HostDeps`(15+1 工厂的 deps 并集);确定 `TRoute` 的具体形态以统一容纳「路由」与「非路由的 `host.commands`」。
  - 改 `lib/app/pi-handler.ts` 唯一装配点:构造 `HostDeps` + 静态 `decisions`(pi-web 对 16 id 全表态)+ 经 `composeCapabilities` 产出,再分拣回 `routes` 与 `hostCommands`。
  - 三个条件挂载工厂(llm/ai/auth)从外层三元映射为 compose 内的等价语义。
  - 新增装配级等价测试(compose 产出 = 现状工厂并集)。
- **Out of scope**:
  - **不删除** `aigc.models` / `vision.models` 两个领域泄漏端点(集成设计 §5.4 的独立拆分,属 model-catalog / §5 后续 spec)。它们不在 16 名册,M3 维持其现状接线(compose 之外)。
  - **不改** M1 冻结面:`composeCapabilities` 引擎、`CapabilityDescriptor`/`CapabilityDecision` 类型、`HOST_CAPABILITY_IDS_V1` 名册、`CapabilityProvider`(P2)。
  - **不实现** `EnvCapabilityProvider` / `HttpCapabilityProvider`(P2 内建实现,属两端接入/后续)。
  - **不迁移** 任何 store 到 Workspace(属 M4)。
  - **不改** 各路由工厂自身的实现与对外签名(只改「它们如何被装配」)。
- **Adjacent expectations**:
  - pi-clouds(C2)据本切片对 16 id 显式表态(其 `createCloudSessionListRoutes` 对应 `replace` 语义;云端专属路由不在 16 名册),`composeCapabilities` 构建通过、`decline` reason 进启动日志。
  - desktop(D4)对 16 id 表态(多数 `use`)。
  - M3 不改 `packages/*` 对外签名以外的既有工厂行为;两端差异只出现在 `decisions`。

## Requirements

### Requirement 1: defaultCapabilities 绑定 16 个 v1 能力面

**Objective:** As a pi-web 宿主契约的维护者, I want 一个把 16 个冻结 id 绑定到现有工厂的 `defaultCapabilities(deps)`, so that 两端有一份可引用的默认能力面清单作为表态基线。

#### Acceptance Criteria
1. The 系统 shall 导出 `defaultCapabilities(deps: HostDeps)`,返回恰好 16 个 `CapabilityDescriptor`,其 `id` 集合与 `HOST_CAPABILITY_IDS_V1` **逐一相等**(既不多也不少)。
2. When 绑定各 descriptor 的 `factory`, the 系统 shall 使每个 id 对应契约 §5.3 表所列的现有工厂(`config.domains`→`createConfigRoutes`、`config.mcp`→`createMcpConfigRoutes`、… `host.commands`→宿主命令)。
3. The `defaultCapabilities` shall 不包含 `aigc.models` / `vision.models`(它们不入 v1 名册)。
4. If `HOST_CAPABILITY_IDS_V1` 与 `defaultCapabilities` 产出的 id 集合不一致, then the 装配级测试 shall 转红(名册与绑定不得漂移)。

### Requirement 2: pi-web 装配改经 composeCapabilities 且全表态

**Objective:** As a 契约模型的验证者, I want pi-web 的唯一装配点经 `composeCapabilities` 产出路由, so that pi-web 自身成为「强制表态」的第一个遵守者,证明机制在真实装配中工作。

#### Acceptance Criteria
1. The `lib/app/pi-handler.ts` 装配 shall 经 `composeCapabilities({ descriptors: defaultCapabilities(deps), decisions, deps, onDecline })` 产出贡献集,不再以裸 spread 直接拼装 15 个工厂。
2. The pi-web `decisions` shall 对 16 个 id **全部显式表态**(缺任一 id 则 `composeCapabilities` 抛 `missing-decision`,构建期失败)。
3. While pi-web 本地默认装配, the `decisions` shall 使 16 id 的**净效果**与现状一致(启用的工厂产出其路由,未启用的产出空)。
4. Where 某能力面被 `decline`, the 装配 shall 经 `onDecline` 回调把 `id` 与 `reason` 记入启动日志(契约 §5.2 第 2 条)。
5. The `composeCapabilities` 引擎(M1)shall 保持不变——M3 只提供 `descriptors`/`decisions`/`deps`,不修改引擎逻辑。

### Requirement 3: host.commands 非路由的统一表态与接回

**Objective:** As a 装配者, I want 非路由的 `host.commands` 也纳入同一次 compose 的强制表态, so that 它不再因「不产路由」而游离于表态机制之外(这正是它在云端静默缺席的根因)。

#### Acceptance Criteria
1. The `host.commands` shall 作为 16 名册的一员进入同一份 `decisions`,与 15 个路由能力面在**同一次** `composeCapabilities` 调用中一起被强制表态。
2. The 系统 shall 定义一个能同时容纳「路由贡献」与「命令贡献」的 `TRoute` 形态(可判别联合),使 compose 的产出可被装配层分拣。
3. When compose 产出后, the 装配层 shall 把「路由贡献」汇入 `createPiWebHandler` 的 `routes`、把「命令贡献」汇入 `hostCommands` 属性(经 `createHostCommandRegistry`),二者的净效果与现状一致。
4. If `host.commands` 被 `decline`(如某宿主不支持宿主命令), then the 装配 shall 产出**空**的命令集且不报错(降级可用)。

### Requirement 4: 条件挂载工厂的等价映射

**Objective:** As a 维护者, I want 三个条件挂载工厂(llm/ai/auth)在 compose 下的行为与现状三元逐一致, so that 「网关/登录未配置时不挂载」这一既有行为不被改变。

#### Acceptance Criteria
1. While `config.llmGateway?.serve` 为假(现状), the `gateway.llm` 能力面 shall 产出**空**路由集(等价于现状 `... : []`)。
2. While AI 网关未配置(`aiGwConfig === undefined`)/云登录未配置(`cloudLoginConfig === undefined`), the `gateway.ai` / `auth.session` 能力面 shall 分别产出空路由集。
3. When 上述条件为真(已配置), the 对应能力面 shall 产出与现状 `createLlmGatewayRoutes` / `createAiGatewayRoutes` / `createAuthRoutes` **完全相同**的路由(method+path+handler 语义不变)。
4. The 条件判定 shall 内聚到能力面 `factory`(读 `deps` 中的配置),而非在 `decisions` 中动态构造——使 pi-web 的 `decisions` 保持静态、可读。

### Requirement 5: HostDeps 收敛为具体依赖对象

**Objective:** As a 实现者, I want 一个明确的 `HostDeps` 类型收敛 15+1 工厂的依赖并集, so that descriptor 的 `factory(deps)` 各取所需,且 TDeps 从泛型落到具体(M1 预告的收敛点)。

#### Acceptance Criteria
1. The 系统 shall 定义 `HostDeps` 类型,容纳现状各工厂所需依赖的并集:`AppConfig` 派生项(`agentDir`/`defaultCwd`/`llmGateway` 等)与 `buildSingleton` 内构造的运行时单例(`store`/`manager`/`attachmentStore`/`aiGwConfig`/`aiGatewayKeyResolver`/`cloudLoginConfig`/`authSessionState`/扩展管理接缝等)。
2. When 某工厂用**双位置参数**(`createAttachmentRoutes(store, options)`、`createBashRoutes(store, options)`), the 对应 descriptor `factory` shall 内部适配 `(deps) => createX(deps.store, {...})`,不改工厂签名。
3. The `HostDeps` 的构造 shall 发生在 `buildSingleton()` 内(现状单例构造处),一次构造、传给 `defaultCapabilities` 与 compose。
4. The descriptor `requires` 字段 shall 保持声明性、装配期不校验(契约 §5.1 勘误⑬:`HostDeps` 收敛后校验仍恒真,本期不启用;记入设计说明诚实边界)。

### Requirement 6: 装配行为逐一致(行为零变化)

**Objective:** As a 验证者, I want 一份可复现证据证明经 compose 装配后的路由集与现状逐一致, so that M3 是纯装配重构而非功能变更。

#### Acceptance Criteria
1. The 系统 shall 新增装配级测试:构造代表性 `HostDeps`,断言 `composeCapabilities(defaultCapabilities(deps), 全 use)` 产出的**路由贡献**的 `{method, path}` 集合,与现状直接调用 15 个工厂(相同 deps、相同启用条件)的并集**相等**。
2. The 装配级测试 shall 断言 compose 产出的**命令贡献**接成的 registry 命令集,与现状 `hostCommands` 的命令集相等。
3. While 运行既有各工厂单测(`config-routes`/`session-list-routes`/`ai-gateway/routes`/`auth-routes`/… )与 `http/http.e2e.test.ts`, the 改动 shall 使其全部通过(不放宽/不删断言)。
4. If 某工厂在启用与未启用两态下, then 装配级测试 shall 覆盖两态并断言路由集随条件正确变化(等价现状三元)。
5. The `aigc.models` / `vision.models` 两端点 shall 在装配后仍然可达(维持现状,compose 之外),经既有 `aigc-models-routes.test.ts` 等确认不受影响。

### Requirement 7: 范围隔离与 M1 冻结面不动

**Objective:** As a M3 执行者, I want 明确只做装配接入, so that 不误伤 M1 冻结面、不越界做 §5 领域泄漏治理。

#### Acceptance Criteria
1. The 本 spec shall 不修改 `host-manifest/{compose,types,capability-ids}.ts`(M1 冻结引擎与名册)。
2. The 本 spec shall 不修改任何路由工厂自身的实现或对外签名(只改其被装配的方式)。
3. The 本 spec shall 不删除、不迁移 `aigc.models` / `vision.models`(属后续 spec)。
4. If 接入过程中发现必须改 M1 引擎或工厂签名才能装配, then the 执行者 shall 停止并回报边界冲突(可能意味着契约缺口,回契约修订而非打补丁)。

### Requirement 8: 垂直验证(回归 + fresh-evidence)

**Objective:** As a 契约模型的验证者, I want 可复现的「本地全绿」证据, so that M3 结论(强制表态机制在真实装配中成立、两端可据此表态)有新鲜凭据支撑。

#### Acceptance Criteria
1. While 改动完成, the 验证 shall 运行 `packages/server` 全量单测并全绿(真实计数;防 vitest 假绿:`no tests` 或 `Errors N error` 均不算通过)。
2. While 改动完成, the 验证 shall 运行 `packages/server` `typecheck` 零错误(TDeps 收敛后类型必须自洽)。
3. While 改动完成, the 验证 shall 运行受影响的 node e2e(至少 `http` 装配相关)并全绿,或对既有失败做基线对照证明与本 spec 无关。
4. The 验证 shall 以 fresh-evidence(命令 + 真实计数 + 时间戳)记录于 spec 的验证目录,不得以「应当通过」替代实际运行。
