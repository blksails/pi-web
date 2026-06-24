# Requirements Document

## Introduction

本特性交付 `agent-source-resolver`——pi-web 会话创建流程中的 **agent 源解析器**。给定一个 `source`(本地目录或 git 仓库),它负责把源解析为统一的、可被下游消费的结果:**模式判定**(自定义 agent / 通用 pi CLI)、**spawn 规格**(`spawnSpec = { cmd, args, cwd, env }`)、**工作目录** `cwd` 与**信任决策** `trust`。它集中处理三件长期易踩坑的事:目录/git 两种来源的统一化、有/无入口文件两种模式的判定、以及 headless 下 `.pi/` 项目资源默认被静默忽略的信任门控(`PLAN.md` §3.0.0/§3.0.1/§10.0.C)。

本解析器**只产出规格,不拉起进程**:它不 spawn 子进程(归 `rpc-channel`),也不实现 bootstrap runner 本体(归 `agent-runner`)。它消费上游 `protocol-contract` 定义的 spawnSpec/DTO 类型,产出下游 `rpc-channel` / `session-engine` 可直接拉起的解析结果。

**谁有问题**:会话创建流程需要知道"给定一个 source 该 spawn 什么、是自定义 agent 还是通用 CLI、要不要信任 `.pi/`"。
**现状**:无统一的源解析;目录/git 两类来源、有/无 `index` 两类模式、project trust 在 headless 下默认静默忽略 `.pi/`,极易踩坑。
**应改变**:提供一个 `AgentSourceResolver`,把 `source` → `{ mode, spawnSpec, cwd, trust }`,集中处理探测与信任策略,并预留可插拔的源解析与信任策略接缝。

## Boundary Context

- **In scope**:源类型识别(本地目录 abs/rel、git 三种 URL 形态);git 源克隆/更新到缓存(pinned ref、非交互);本地目录直接使用;入口文件探测与优先级;`package.json#pi-web.entry` 覆盖;双模式(custom/cli)判定;按来源的信任策略 `trustPolicy(source)` 与其在两种模式下的落地映射;同 `source@ref` 缓存复用与并发去重;产出 `{ mode, spawnSpec, cwd, trust }`。
- **Out of scope**:spawn / 启动子进程(归 `rpc-channel`);bootstrap runner 本体与 `index.ts` 的 jiti 载入(归 `agent-runner`);RPC JSONL framing、SSE、HTTP 端点;会话注册与生命周期(归 `session-engine` / `http-api`);扩展安装(`pi install`,归 `extension-management`);沙箱/容器隔离实现(归生产硬化);protocol 类型与 zod schema 的定义(归 `protocol-contract`,本特性只消费)。
- **Adjacent expectations**:解析结果 `spawnSpec` 的形状必须满足 `rpc-channel` 的 `local` 通道(child_process)直接拉起的需求;`mode`/`trust` 语义须可被 `session-engine` 与 `agent-runner` 一致消费;spawnSpec/DTO 类型来自 `@blksails/protocol`。

## Requirements

### Requirement 1: 源类型识别
**Objective:** 作为会话创建流程,我想让解析器准确识别任意 `source` 字符串属于哪种来源类型,以便后续选择正确的解析路径。

#### Acceptance Criteria
1. When source 为绝对路径(以 `/` 起始)或相对路径(以 `./` 或 `../` 起始), the AgentSourceResolver shall 将其识别为本地目录来源。
2. When source 为 `git:host/user/repo@ref` 形态, the AgentSourceResolver shall 将其识别为 git 来源并解析出 host、repo 路径与 ref。
3. When source 为 `https://host/user/repo@ref` 或 `ssh://...@ref` 形态, the AgentSourceResolver shall 将其识别为 git 来源并解析出克隆 URL 与 ref。
4. When source 为 git 来源但未显式带 `@ref`, the AgentSourceResolver shall 使用默认 ref(远端默认分支)并在结果中标明所用 ref。
5. If source 为空、无法归类为受支持的本地目录或 git 形态, then the AgentSourceResolver shall 返回可识别的来源类型错误,并指明原始 source 值。
6. When source 未指定(缺省), the AgentSourceResolver shall 使用默认工作区作为 cwd 并按"无入口"路径处理(即等价通用 CLI 模式)。

### Requirement 2: Git 源解析到缓存
**Objective:** 作为会话创建流程,我想让 git 来源被非交互地克隆/更新到本地缓存并定位到固定 ref,以便得到一个稳定的本地目录供后续探测。

#### Acceptance Criteria
1. When 解析 git 来源, the AgentSourceResolver shall 将其克隆/更新到按 `source@ref` 派生的缓存目录(如 `~/.pi-web/agents/git/<host>/<path>@<ref>`)。
2. When 同一 `source@ref` 的缓存目录已存在且有效, the AgentSourceResolver shall 复用该缓存而非重新克隆。
3. While 执行任何 git 操作, the AgentSourceResolver shall 以非交互方式运行(设置 `GIT_TERMINAL_PROMPT=0` 并对 ssh 使用 BatchMode),不得弹出任何交互式凭据或主机确认提示。
4. When 两个会话请求并发解析同一 `source@ref`, the AgentSourceResolver shall 去重为单次克隆/更新,二者复用同一缓存结果。
5. When git 来源解析成功, the AgentSourceResolver shall 将检出工作树固定在指定 ref(pinned),使后续探测基于该 ref 的内容。
6. If git 克隆或更新失败(网络、鉴权、ref 不存在), then the AgentSourceResolver shall 返回包含 source、ref 与失败原因的源解析错误,并且不产出 spawnSpec。

### Requirement 3: 入口探测与优先级
**Objective:** 作为会话创建流程,我想在解析后的目录根定位 agent 入口文件并遵循确定的优先级,以便判定该用哪种模式启动。

#### Acceptance Criteria
1. When 在目标目录根探测入口, the AgentSourceResolver shall 按 `index.ts` > `index.js` > `index.mjs` 的固定优先级选取第一个存在的文件作为入口。
2. Where 目标目录的 `package.json` 含 `pi-web.entry` 字段, the AgentSourceResolver shall 以该字段指向的文件作为入口,覆盖默认优先级探测结果。
3. If `package.json#pi-web.entry` 指向的文件不存在, then the AgentSourceResolver shall 返回入口覆盖无效错误,并指明被覆盖的路径,而不静默回退到默认探测。
4. When 目标目录既无默认优先级入口文件、也无有效 `pi-web.entry` 覆盖, the AgentSourceResolver shall 判定为"无入口"。
5. When 探测到有效入口, the AgentSourceResolver shall 在结果中提供该入口文件的解析后绝对路径。

### Requirement 4: 双模式判定
**Objective:** 作为会话创建流程,我想由"是否存在入口文件"自动决定模式与对应 spawnSpec,以便对外保持同一套 RPC 协议而仅启动配置不同。

#### Acceptance Criteria
1. When 目标目录存在有效入口, the AgentSourceResolver shall 判定 `mode = "custom"`,并产出以 bootstrap runner 为目标的 spawnSpec(`node --import jiti/register <runner> --agent <入口路径> --cwd <work>` 语义)。
2. When 目标目录无入口(含 source 缺省情形), the AgentSourceResolver shall 判定 `mode = "cli"`,并产出以通用 pi CLI 为目标的 spawnSpec(`node <pkg>/dist/cli.js --mode rpc --cwd <source>` 语义)。
3. The AgentSourceResolver shall 产出统一形状的 `spawnSpec = { cmd, args, cwd, env }`,其类型与 `@blksails/protocol` 定义一致。
4. When 产出任一模式的 spawnSpec, the AgentSourceResolver shall 将解析得到的工作目录写入 `spawnSpec.cwd` 与结果顶层 `cwd`,二者一致。
5. The AgentSourceResolver shall 不在自身进程内执行 spawnSpec,也不载入或执行入口文件代码——只产出规格供下游拉起。

### Requirement 5: 信任策略与落地
**Objective:** 作为安全敏感的会话创建流程,我想以可插拔、按来源的信任策略显式决定是否信任 `.pi/` 项目资源,以避免 headless 下静默忽略,同时不无脑全开导致任意代码执行。

#### Acceptance Criteria
1. When 解析任一来源, the AgentSourceResolver shall 调用可插拔的 `trustPolicy(source)` 得到 `trust ∈ {"always","never","ask"}` 并纳入结果。
2. Where 未提供自定义 `trustPolicy`, the AgentSourceResolver shall 使用默认策略,其默认值为 `"ask"`。
3. When `trust = "always"` 且 `mode = "cli"`, the AgentSourceResolver shall 在 spawnSpec.args 中加入单次信任标志(`--approve`),使 `.pi/` 项目资源在子进程中加载。
4. When `trust = "always"` 且 `mode = "custom"`, the AgentSourceResolver shall 通过 spawnSpec(参数或 env)向 runner 传递"信任 `.pi/`"的决策,使 runner 可据此放行项目信任。
5. When `trust = "never"`, the AgentSourceResolver shall 产出忽略 `.pi/` 项目资源的 spawnSpec(cli 模式可用 `--no-approve` 单次忽略),且不传递任何信任放行信号。
6. When `trust = "ask"`(headless 默认), the AgentSourceResolver shall 不向子进程传递任何信任放行信号,使 `.pi/` 项目资源在非交互模式下按默认被忽略,且本特性不产生任何交互式信任提示。
7. The AgentSourceResolver shall 确保 context 文件(`AGENTS.md`/`CLAUDE.md`)与全局/用户级扩展的加载不受 `trust` 决策影响(由子进程相对其 agentDir 加载,本特性不抑制)。
8. The AgentSourceResolver shall 在结果中保留所用 `trust` 取值,使下游可审计该会话的信任决策。

### Requirement 6: 缓存与并发
**Objective:** 作为会话创建流程,我想让同一来源在重复或并发请求下高效复用,以避免重复克隆与竞态。

#### Acceptance Criteria
1. When 多次解析同一 `source@ref`(git), the AgentSourceResolver shall 复用既有缓存目录,不重复克隆。
2. While 同一 `source@ref` 的克隆/更新正在进行, the AgentSourceResolver shall 让并发请求等待同一进行中的操作而非各自发起。
3. If 缓存目录存在但不完整或损坏(例如缺少 git 元数据), then the AgentSourceResolver shall 重新建立该缓存而非使用损坏内容。
4. The AgentSourceResolver shall 使本地目录来源直接使用其路径,不进入克隆缓存流程。

### Requirement 7: 隔离与 agentDir
**Objective:** 作为多租户/隔离敏感的会话创建流程,我想让解析结果能承载 agentDir 隔离配置,以便不同会话/租户互不干扰。

#### Acceptance Criteria
1. Where 调用方提供 agentDir 隔离配置, the AgentSourceResolver shall 通过 `spawnSpec.env` 的 `PI_CODING_AGENT_DIR` 传递该 agentDir(而非 `PI_AGENT_DIR`)。
2. Where 调用方提供额外 env(如 provider API key), the AgentSourceResolver shall 将其并入 `spawnSpec.env`,不覆盖隔离相关的关键变量。
3. The AgentSourceResolver shall 不读取或泄露 env 中的敏感值到日志或错误信息中。

### Requirement 8: 可插拔扩展点
**Objective:** 作为面向未来(pi cloud / 自定义源)的引擎,我想让源解析与信任策略可被外部替换,以便扩展新源类型而不改核心。

#### Acceptance Criteria
1. Where 调用方注册了自定义 `sourceResolver` 插件, the AgentSourceResolver shall 在内置 dir/git 解析之外支持其声明的源类型。
2. Where 调用方提供了自定义 `trustPolicy(source)`, the AgentSourceResolver shall 使用该策略替代默认策略。
3. The AgentSourceResolver shall 暴露稳定的解析入口接口,使下游 `session-engine` 以单一调用获得 `{ mode, spawnSpec, cwd, trust }`。

### Requirement 9: 可测试性(单元 / 集成 / e2e 硬性)
**Objective:** 作为项目质量门禁,我想让本特性的每条核心行为都可在无真实远端/无真实 spawn 的条件下被自动化验证,以满足"测试 + e2e(硬性)"要求。

#### Acceptance Criteria
1. The AgentSourceResolver shall 使源类型识别、入口探测优先级、`pi-web.entry` 覆盖、双模式判定与 `trustPolicy` 决策矩阵均为可被纯函数单元测试覆盖的确定性行为。
2. The AgentSourceResolver shall 使其 trust 决策矩阵单测覆盖 headless 下 `ask` → 忽略 `.pi/`(不传放行信号)的关键用例。
3. When 解析含入口的本地目录与不含入口的本地目录, the AgentSourceResolver shall 产出可在集成测试中断言的、正确的 `mode` 与 `spawnSpec`。
4. When 以本地裸库(bare repo)模拟远端解析 git 源, the AgentSourceResolver shall 在集成测试中完成克隆到缓存并定位 ref,无需访问外部网络。
5. The AgentSourceResolver shall 使两种 fixture 目录解析出的 `spawnSpec` 形状满足 `rpc-channel` 的 local 通道可据此拉起的契约(在本特性内以轻量跨 spec 健全性测试验证 spawnSpec 形状,不实际长期运行子进程)。
6. The AgentSourceResolver shall 通过单一测试命令运行其全部单元、集成与 e2e 健全性测试并产出可验证结果。
