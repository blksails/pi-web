# Research & Design Decisions — agent-runner

## Summary
- **Feature**: `agent-runner`
- **Discovery Scope**: New Feature(greenfield);对 pi SDK 的 Complex Integration
- **Key Findings**:
  - runner 必须以 SDK 的 `runRpcMode` 作为唯一 RPC 出口,确保与 CLI `pi --mode rpc` 逐字节一致;runner 不自造任何 framing。
  - `AgentDefinition` 的三种 export 形态须收敛到同一个内部表示(`CreateAgentSessionRuntimeFactory`),后续映射逻辑只面对该统一表示。
  - 资源类字段映射到 `createAgentSessionServices.resourceLoaderOptions`,会话类字段映射到 `createAgentSessionFromServices`;`extensions` 需按"路径 vs 工厂"二分到 `additionalExtensionPaths` / `extensionFactories`。
  - `resolveProjectTrust` 是承接 agent-source 信任决策的唯一接缝;headless 下默认 `ask` 会静默丢弃 `.pi/` 项目资源,必须显式表态。

## Research Log

### 双模式同协议:runner 与 CLI 的关系
- **Context**:Req 6 要求 runner 输出与 CLI 逐字节一致。
- **Sources Consulted**:PLAN.md §3.0.0(双模式表)、§3.0.3(runner 伪代码)、tech.md「双模式同协议」、protocol-contract/design.md(契约根)。
- **Findings**:自定义模式走 SDK `runRpcMode(runtime)`,通用模式走 CLI `pi --mode rpc`,二者底层同实现。CLI 回退路径不经过 runner(本 spec 范围外)。
- **Implications**:runner 不实现协议帧;协议正确性由 SDK 保证,本 spec 用 protocol-contract 的 schema 做防回归校验。

### AgentDefinition 字段 → SDK 选项映射
- **Context**:Req 3 的映射正确性是核心单测项。
- **Sources Consulted**:PLAN.md §3.0.3 伪代码、§10.0.B「② index.ts 声明式」映射表、§3.0.2 字段清单。
- **Findings**:
  | AgentDefinition | → 目标 |
  |---|---|
  | `systemPrompt` | `resourceLoaderOptions.systemPromptOverride` |
  | `extensions`(路径) | `resourceLoaderOptions.additionalExtensionPaths` |
  | `extensions`(工厂) | `resourceLoaderOptions.extensionFactories` |
  | `skills` | `resourceLoaderOptions.skillsOverride` |
  | `promptTemplates` | `resourceLoaderOptions.promptsOverride` |
  | `contextFiles` | `resourceLoaderOptions.agentsFilesOverride` |
  | `model`/`thinkingLevel`/`scopedModels`/`tools`/`excludeTools`/`noTools`/`customTools` | `createAgentSessionFromServices` 入参 |
- **Implications**:`extensions` 数组需逐项判别(字符串=路径,函数/对象=工厂);未提供的字段不注入,保留 SDK 默认发现。

### 信任与 headless 资源加载
- **Context**:Req 5 的 `resolveProjectTrust`。
- **Sources Consulted**:PLAN.md §10.0.C(信任门控,★ 易踩坑)、§3.4。
- **Findings**:非交互(`--mode rpc`)不弹信任提示;无保存决定时按全局 `defaultProjectTrust`(默认 `ask` → 忽略 `.pi/` 项目资源)。SDK 提供 `resourceLoaderReloadOptions.resolveProjectTrust` 回调返回布尔。context 文件与 user/global 扩展不受信任门控。
- **Implications**:runner 把 agent-source 给出的布尔决策接到 `resolveProjectTrust`;不在 runner 内做"来源→是否信任"的策略判定(那是 agent-source-resolver 的职责)。

### jiti 载入与隔离
- **Context**:Req 4.5 隔离;约束 RCE。
- **Sources Consulted**:PLAN.md §3.0.3、§11.2、§10.3、tech.md。
- **Findings**:jiti 载入用户 `index.ts` 等同 RCE;runner 作为独立子进程运行,后端进程不跑用户代码。启动方式 `node --import jiti/register runner.ts` 或运行时 `createJiti()` 程序化 import。
- **Implications**:runner 是隔离边界;沙箱/受信由运行环境与 agent-source 保证,本 spec 仅承接信任决策。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Adapter + 子进程入口(选用) | agent-loader 归一化 + runner 映射并启动 `runRpcMode` | 边界清晰、可单测映射、隔离用户代码 | 依赖 SDK 内部选项形状 | 与 PLAN.md §3.0.3 一致 |
| 后端进程内载入用户代码 | 不 spawn 子进程,直接在后端 import | 少一次进程开销 | 用户代码 = RCE 跑在后端进程,违反隔离 | 否决 |

## Design Decisions

### Decision: 归一化收敛到单一 `CreateAgentSessionRuntimeFactory`
- **Context**:三种 export 形态需要被后续逻辑统一处理。
- **Alternatives Considered**:1) 保留三态、在 runner 分支处理;2) 统一为内部 factory。
- **Selected Approach**:loader 输出统一 factory(形态 a/b 经映射、形态 c 透传)。
- **Rationale**:runner 只面对单一类型;映射逻辑可独立单测。
- **Trade-offs**:形态 c 绕过映射,需文档说明"最大控制 = 自负其责"。
- **Follow-up**:单测三形态各自的归一化输出。

### Decision: runner 不自造协议,只调 `runRpcMode`
- **Context**:Req 6 协议一致性。
- **Selected Approach**:runner 组装 runtime 后直接 `await runRpcMode(runtime)`。
- **Rationale**:协议正确性由 SDK 单一来源保证;本 spec 用 protocol-contract schema 在 e2e 做防漂移。
- **Trade-offs**:无法在 runner 层定制帧(也不应定制)。

## Risks & Mitigations
- pi SDK 选项形状随版本变化 → 集成/e2e 测试暴露;映射集中在单一模块便于修订。
- 用户 `index.ts` 抛错或形态非法 → loader 统一抛带定位信息的错误(Req 2.5/2.6),runner 以非零码退出。
- headless 下信任默认丢弃 `.pi/` 资源造成"扩展没加载"困惑 → `resolveProjectTrust` 显式承接决策,文档与测试覆盖。

## References
- 根目录 `PLAN.md` §3.0.0 / §3.0.2 / §3.0.3 / §10.0.B / §10.0.C / §3.4 / §11.2
- `.kiro/specs/protocol-contract/design.md`(契约根、AgentEvent schema)
- `.kiro/steering/tech.md`、`structure.md`、`product.md`、`roadmap.md`
