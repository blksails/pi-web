# Requirements Document

## Project Description (Input)

在自定义 agent 模式下,pi-web 为每个会话 spawn 一个 **bootstrap runner** 子进程。编写自定义 agent 的用户用 pi SDK 写一个 `index.[ts|js]` 入口,但目前没有标准的载入方式,也没有把"用户定义"变成 `AgentSessionRuntime` 再跑 `runRpcMode` 的桥。本特性提供:

- **`@pi-web/agent-kit`**:导出 `defineAgent(def)` 类型帮助函数与 `AgentDefinition` 类型(`model/thinkingLevel/tools/customTools/excludeTools/noTools/systemPrompt/extensions/skills/promptTemplates/contextFiles/scopedModels` 等),运行时不强制依赖。
- **agent-loader**:用 `jiti` import `<agentPath>`,把 default export 归一化为三种形态:(a) 定义对象、(b) `(ctx) => 定义` 工厂、(c) 直接 `createRuntime`(`CreateAgentSessionRuntimeFactory`)工厂。
- **runner.ts**(子进程入口):解析 `--agent/--cwd/--agent-dir` 参数,把 `AgentDefinition` 映射为 `createAgentSessionServices`(`resourceLoaderOptions`:systemPrompt/extensions/skills/prompts/contextFiles) + `createAgentSessionFromServices`(model/tools/customTools 等)组装出 `CreateAgentSessionRuntimeFactory`,经 `createAgentSessionRuntime(...)` 得到 runtime,最后 `await runRpcMode(runtime)`。
- 处理 `resolveProjectTrust` 钩子(承接 agent-source 的信任决策)。

**权威设计**:根目录 `PLAN.md` §3.0.2(模块契约)、§3.0.3(bootstrap runner)、§10.0.B/§10.0.C(资源映射与信任),以及上游 `protocol-contract`(runner 输出帧必须与 CLI `pi --mode rpc` 逐字节一致)。

**范围外**:不解析 agent 源(归 `agent-source-resolver`);不从服务端 spawn 子进程(归 `rpc-channel` 的 `PiRpcProcess`);CLI 回退模式(`pi --mode rpc`)不经过 runner。

## Requirements

### Requirement 1: AgentDefinition 类型与 defineAgent() 帮助函数

**Objective:** 作为编写自定义 agent 的用户,我想要一个有类型提示的 `defineAgent()` 帮助函数和 `AgentDefinition` 类型,以便在 `index.ts` 里声明式定义 agent 能力且获得编译期校验,同时运行时不被强制依赖。

#### Acceptance Criteria

1. The `@pi-web/agent-kit` package shall 导出 `AgentDefinition` 类型,覆盖字段 `model`、`thinkingLevel`、`tools`、`customTools`、`excludeTools`、`noTools`、`systemPrompt`、`extensions`、`skills`、`promptTemplates`、`contextFiles`、`scopedModels`。
2. When 用户以一个 `AgentDefinition` 对象为参数调用 `defineAgent(def)`,the `@pi-web/agent-kit` package shall 原样返回该对象且不改变其运行时行为(仅提供类型推导)。
3. The `@pi-web/agent-kit` package shall 不引入任何强制运行时依赖,使得未导入 `@pi-web/agent-kit` 但 default export 结构匹配的 `index.ts` 仍能被 runner 正确载入。
4. Where 用户在 `index.ts` 提供了不符合 `AgentDefinition` 类型的字段,the TypeScript 编译器 shall 在编译期报告类型错误。

### Requirement 2: agent-loader 三形态归一化

**Objective:** 作为 bootstrap runner,我想要一个把用户 `index.ts` 的 default export 归一化为统一内部表示的加载器,以便后续映射逻辑无需关心用户用了哪种 export 形态。

#### Acceptance Criteria

1. When 给定一个 agent 入口路径,the agent-loader shall 用 `jiti` import 该路径并取其 default export。
2. When default export 是一个 `AgentDefinition` 定义对象,the agent-loader shall 把它归一化为一个 runtime factory(形态 a)。
3. When default export 是一个 `(ctx) => AgentDefinition | Promise<AgentDefinition>` 工厂函数,the agent-loader shall 以 `ctx`(含 `cwd`、`agentDir`、`env`)调用它,再把返回的定义归一化为 runtime factory(形态 b)。
4. When default export 是一个 `CreateAgentSessionRuntimeFactory`(直接 `createRuntime` 工厂),the agent-loader shall 直接使用它而不再二次映射(形态 c)。
5. If default export 缺失、为 `null`,或既不是定义对象、也不是函数,the agent-loader shall 抛出一个带可定位信息(入口路径与失败原因)的明确错误。
6. If 形态 b 的工厂函数调用抛出异常或返回非定义对象,the agent-loader shall 把它作为无效定义错误向上抛出,并保留原始失败原因。

### Requirement 3: AgentDefinition 到 SDK 选项的映射

**Objective:** 作为 bootstrap runner,我想要把归一化后的 `AgentDefinition` 准确映射为 pi SDK 的 `createAgentSessionServices` 与 `createAgentSessionFromServices` 选项,以便用户声明的能力被正确装配到 agent 会话运行时。

#### Acceptance Criteria

1. When 映射 `AgentDefinition` 的资源类字段,the runner shall 把 `systemPrompt` 映射到 `resourceLoaderOptions.systemPromptOverride`,把 `extensions` 中的路径项映射到 `additionalExtensionPaths`、工厂项映射到 `extensionFactories`,把 `skills` 映射到 `skillsOverride`,把 `promptTemplates` 映射到 `promptsOverride`,把 `contextFiles` 映射到 `agentsFilesOverride`。
2. When 映射 `AgentDefinition` 的会话类字段,the runner shall 把 `model`、`thinkingLevel`、`scopedModels`、`tools`、`excludeTools`、`noTools`、`customTools` 作为入参传给 `createAgentSessionFromServices`。
3. While 某个可选字段在 `AgentDefinition` 中未提供,the runner shall 不为该字段注入对应选项,从而保留 pi SDK 的默认发现行为。
4. The runner shall 用映射结果组装出一个 `CreateAgentSessionRuntimeFactory`,该工厂在被调用时返回包含 `services` 与 `diagnostics` 的运行时结果。

### Requirement 4: 子进程入口、参数解析与 RPC 启动

**Objective:** 作为被 spawn 的子进程,我想要一个标准的 runner 入口,它解析启动参数、组装运行时并进入标准 RPC 模式,以便后端能把任意自定义 agent 当作纯 RPC 端点对接。

#### Acceptance Criteria

1. When runner 进程启动,the runner shall 解析命令行参数 `--agent`(入口路径)、`--cwd`(工作目录)与可选的 `--agent-dir`。
2. If 必填参数 `--agent` 缺失,the runner shall 以非零退出码退出并在 stderr 输出可定位的错误说明。
3. When 参数解析完成,the runner shall 经由 agent-loader 与选项映射组装出 `CreateAgentSessionRuntimeFactory`,调用 `createAgentSessionRuntime(...)` 得到运行时,并以解析出的 `cwd` 创建 `SessionManager`。
4. When 运行时组装成功,the runner shall 调用 `await runRpcMode(runtime)` 进入标准 RPC 模式。
5. While runner 处于 RPC 模式,the runner shall 不在 pi-web 后端进程内执行用户代码(隔离),仅以子进程身份对外暴露纯 RPC。

### Requirement 5: 项目信任(resolveProjectTrust)

**Objective:** 作为 bootstrap runner,我想要承接来自 agent-source 的信任决策并把它作用于 pi 的项目资源加载,以便 `.pi/` 项目级扩展/skills/prompts 仅在显式信任时生效。

#### Acceptance Criteria

1. The runner shall 在 `createAgentSessionServices` 的资源加载选项中提供 `resolveProjectTrust` 钩子,以承接 agent-source 传入的信任决策。
2. While 信任决策为不信任,the runner shall 使 pi 在 headless 模式下忽略 `.pi/` 项目级资源(extensions/skills/prompts/settings)。
3. While 信任决策为信任,the runner shall 使 pi 加载 `.pi/` 项目级资源。
4. The runner shall 不改变 context 文件(AGENTS.md / CLAUDE.md)以及 user/global 扩展不受信任门控的既有 pi 行为。

### Requirement 6: 协议一致性

**Objective:** 作为下游 session 引擎与前端,我想要 runner 的 RPC 输出与 CLI `pi --mode rpc` 完全一致,以便传输桥、翻译层与前端在两种模式下完全复用。

#### Acceptance Criteria

1. The runner 的 RPC 输出帧 shall 与 CLI `pi --mode rpc` 逐字节一致(同为 SDK 的 `runRpcMode` 实现)。
2. When runner 收到 stdin 上的一条 `prompt` 命令,the runner shall 在 stdout 产出包含 `message_update`(含 `text_delta` 子事件)与 `agent_end` 的事件帧序列。
3. The runner 产出的每一帧 shall 能通过 `protocol-contract` 的 schema 校验(`AgentEvent` / `RpcResponse` 可辨识联合)。

### Requirement 7: 可测试性(单元 + 集成 + e2e,硬性)

**Objective:** 作为该 spec 的实现者,我想要明确、可验证的测试要求,以便用新鲜运行证据证明 runner 行为符合契约。

#### Acceptance Criteria

1. The agent-runner spec shall 提供单元测试,覆盖 `AgentDefinition` 三形态归一化(对象/工厂/createRuntime)、字段到 services/fromServices 选项的映射正确性,以及无效定义的错误处理(缺失/类型不符/工厂抛错)。
2. The agent-runner spec shall 提供集成测试,对示例 `examples/hello-agent/index.ts` 启动 runner 进程并完成一次 prompt。
3. The agent-runner spec shall 提供 e2e 测试:向 runner 进程 stdin 发送 `{"type":"prompt"}`,断言 stdout 收到 `message_update`(`text_delta`)与 `agent_end`,且每一帧通过 `protocol-contract` 的 schema 校验。
4. The agent-runner spec shall 以单一测试命令运行全部单元/集成/e2e 测试并产出可验证结果。

## Boundary Context

- **In scope**: `@pi-web/agent-kit`(`defineAgent`/`AgentDefinition` 类型);agent-loader(jiti import + 三形态归一化);runner.ts(参数解析 + 选项映射 + `createAgentSessionRuntime` + `runRpcMode`);`resolveProjectTrust` 钩子接线;示例 `examples/hello-agent/index.ts`;上述对应的单元/集成/e2e 测试。
- **Out of scope**: agent 源解析与入口探测、双模式判定、信任策略生成(归 `agent-source-resolver`);从服务端 spawn 子进程与 JSONL framing、三类消息分发(归 `rpc-channel` 的 `PiRpcProcess`);CLI 回退模式(`pi --mode rpc`)不经过 runner;事件→UIMessage 翻译(归 `session-engine`);协议类型/schema 定义本身(归 `protocol-contract`)。
- **Adjacent expectations**: 依赖 `protocol-contract` 提供的 schema 做帧校验(契约根);信任决策的"来源→是否信任"的策略判定由 `agent-source-resolver` 给出,runner 只负责把该决策作用到 `resolveProjectTrust`;运行环境 Node `>=22.19.0`;jiti 载入用户代码等同 RCE,须运行在受信/沙箱环境(PLAN.md §11.2)。
