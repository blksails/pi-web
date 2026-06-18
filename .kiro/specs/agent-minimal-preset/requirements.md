# Requirements Document

## Introduction

`@pi-web/agent-kit` 当前要求 agent 作者逐字段手写"关闭"配置:工具用 `noTools`、skills 用 `skills` 覆盖钩子返回空集,而**系统扩展无法真正关闭**——`extensions` 字段在运行时只会"追加"扩展路径/工厂,空数组 `extensions: []` 并不会阻止 disk 发现的系统/项目/用户扩展(`.pi/extensions/*` 等)被加载。`examples/hello-agent` 演示了部分关闭(`noTools: "builtin"` + 空 skills),但仍非彻底的最小基线,且作者每次都要重复抄写这些样板。

本特性为 agent 作者提供一个**可复用的"最小化默认预设"**:一行即可让 agent 以"无工具、无 skills、无系统扩展"的最小基线启动;同时补齐"真正关闭系统扩展"的能力,并提供 `allowExtensions` 白名单,让作者在全关基线上按名放行个别系统扩展。预设必须可被 `defineAgent` 复用且字段可覆盖,作为比 `hello-agent` 更彻底的 baseline。

## Boundary Context

- **In scope**:
  - 在 `@pi-web/agent-kit` 公共表面新增一个可复用的最小化预设(对象或工厂),并从包入口导出。
  - 在 `@pi-web/agent-kit` 的 `AgentDefinition` 公共表面新增"真正关闭系统扩展"的能力及 `allowExtensions` 白名单字段。
  - 在 `@pi-web/server` 的运行时映射(option-mapper)与其镜像 `AgentDefinition` 中,落实上述扩展关闭/白名单语义,使运行时真实生效。
  - 预设的可组合/可覆盖行为(作者可叠加 model / systemPrompt / customTools 等而不丢失关闭语义)。
  - 示例(在 `examples/` 体现最小基线用法)与对应单元/集成测试。
- **Out of scope**:
  - 修改 `@earendil-works/pi-coding-agent` SDK 本身。
  - 关闭 prompt 模板、theme、context 文件等其它资源类别(仅在与扩展关闭强相关时才涉及)。
  - 前端 UI / RPC 协议 / 渲染层改动。
  - skills 的关闭机制重构(沿用现有 `skills` 覆盖钩子即可)。
- **Adjacent expectations**:
  - 依赖 `@earendil-works/pi-coding-agent` 已提供的资源加载关闭/覆盖能力(`noExtensions` / `extensionsOverride` / `skillsOverride`)。
  - 依赖 `@pi-web/server` 运行时按映射后的 `resourceLoaderOptions` 加载资源;agent-kit 自身为类型/数据声明,不直接执行加载。

## Requirements

### Requirement 1: 一行启用的最小化预设

**Objective:** 作为 agent 作者,我想用一行配置让 agent 以"无工具、无 skills、无系统扩展"的最小基线启动,以便快速获得一个干净、可预测、自包含的 agent 而无需重复抄写关闭样板。

#### Acceptance Criteria
1. The `@pi-web/agent-kit` package shall 从包入口导出一个可复用的最小化预设(预设对象或返回预设的工厂)。
2. When 作者将该预设作为 `defineAgent` 的输入(或与之合并), the resulting `AgentDefinition` shall 声明关闭全部内置与扩展工具(等价于 `noTools: "all"`)。
3. When 作者应用该预设, the resulting `AgentDefinition` shall 声明关闭全部 disk 发现的 skills(解析得到的 skills 集合为空)。
4. When 作者应用该预设, the resulting `AgentDefinition` shall 声明关闭全部系统扩展(解析得到的扩展集合为空,除白名单放行项外)。
5. The 最小化预设 shall 保持 `@pi-web/agent-kit` 的零强制运行时依赖特性(纯类型/数据,不引入对 SDK 运行时的强制依赖边)。

### Requirement 2: 真正关闭系统扩展

**Objective:** 作为 agent 作者,我想让"关闭系统扩展"在运行时真实生效,以便 agent 不会意外加载 `.pi/extensions/*`、用户级或全局的系统扩展。

#### Acceptance Criteria
1. The `@pi-web/agent-kit` 的 `AgentDefinition` 公共表面 shall 提供一个用于关闭系统扩展的声明字段(独立于仅"追加"语义的 `extensions` 字段)。
2. When `AgentDefinition` 声明关闭系统扩展, the Agent 运行时映射(option-mapper) shall 将其映射为 SDK 资源加载层的扩展关闭语义(`noExtensions` 或 `extensionsOverride` 返回空集)。
3. While 关闭系统扩展生效, the Agent 运行时 shall 不加载任何 disk 发现的系统/项目/用户扩展。
4. Where 作者同时通过 `extensions` 字段追加了显式的扩展路径或工厂, the Agent 运行时 shall 仍加载这些被显式追加的扩展(关闭语义只针对 disk 发现的系统扩展,不影响作者显式追加项)。
5. The `@pi-web/server` 的镜像 `AgentDefinition` 类型 shall 与 `@pi-web/agent-kit` 的公共表面保持结构一致,使经 `defineAgent(...)` 编写的定义可被运行时无缝消费。

### Requirement 3: allowExtensions 白名单放行

**Objective:** 作为 agent 作者,我想在"系统扩展全关"的基线上按名放行个别系统扩展,以便只启用我明确信任/需要的扩展而其余保持关闭。

#### Acceptance Criteria
1. The `@pi-web/agent-kit` 的 `AgentDefinition` 公共表面 shall 提供 `allowExtensions` 白名单字段,用于按名声明应保持启用的系统扩展。
2. While 系统扩展关闭生效, when `allowExtensions` 含有某个系统扩展的名称, the Agent 运行时 shall 保留该被命名的系统扩展处于启用状态。
3. While 系统扩展关闭生效, the Agent 运行时 shall 关闭所有未被 `allowExtensions` 列出的 disk 发现系统扩展。
4. If `allowExtensions` 为空或未提供, then the Agent 运行时 shall 关闭全部 disk 发现的系统扩展(等价于无放行项)。
5. If `allowExtensions` 中的名称未匹配任何已发现的系统扩展, then the Agent 运行时 shall 安全忽略该名称且不因此中断会话启动。

### Requirement 4: 可组合与可覆盖

**Objective:** 作为 agent 作者,我想在套用最小化预设的同时叠加自己的配置(模型、系统提示词、自定义工具等),以便在干净基线上构建真实 agent 而不丢失关闭语义。

#### Acceptance Criteria
1. When 作者在应用预设的同时提供 `model` / `systemPrompt` / `thinkingLevel` 等字段, the resulting `AgentDefinition` shall 保留这些作者提供的字段值。
2. When 作者在应用预设的同时提供 `customTools`, the resulting `AgentDefinition` shall 保留这些自定义工具(关闭语义只针对内置与 disk 发现的扩展工具,不影响作者显式声明的自定义工具)。
3. The 最小化预设的关闭语义(工具/skills/系统扩展) shall 以显式且可读的方式表达,使作者能够清楚看出哪些能力被关闭。
4. Where 作者需要在预设基础上重新开启某项能力, the 预设组合方式 shall 允许通过字段覆盖或 `allowExtensions` 完成,而无需复制预设内部实现。

### Requirement 5: 兼容与回归

**Objective:** 作为维护者,我想确保新增预设与扩展关闭能力不破坏既有用法,以便现有示例与下游消费保持正常。

#### Acceptance Criteria
1. The `@pi-web/agent-kit` 的 `defineAgent` shall 保持恒等(identity)与无运行时副作用的特性不变。
2. While 作者未使用最小化预设或扩展关闭字段, the Agent 运行时 shall 维持既有的资源发现与加载默认行为不变。
3. The 既有示例 `examples/hello-agent` 与既有测试 shall 在本特性引入后继续通过,无需修改其语义。
4. The 本特性 shall 附带可运行的单元/集成测试,以新鲜运行证据证明预设关闭工具、关闭 skills、关闭系统扩展以及 `allowExtensions` 白名单放行均按预期生效。
