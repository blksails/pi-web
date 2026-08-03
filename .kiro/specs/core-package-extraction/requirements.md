# Requirements Document

## Project Description (Input)

**谁有问题**：任何想复用 pi-web headless 内核的宿主 —— pi-clouds 云端、desktop、未来的 edge。

**现状**：`packages/server` 是一个 ≈33k 行 / 42 个模块的单体包，混装三类性质完全不同的东西：
headless 内核、外部接线（e2b / postgres / s3 / 网关 / 凭据 / 镜像烘焙 / 包注册表）、
runner 子进程实现（静态导入完整 pi SDK + jiti）。三者搅在一起的直接代价：
**只想用会话引擎的宿主，也得把 e2b、pg、MCP SDK、pi SDK 一并拖进依赖树**。
`src/index.ts` 里那一长串「本模块无 pi SDK 值导入，可安全 re-export」的逐条论证，
正是这个问题的症状 —— 包边界不存在，只能靠注释和纪律维持。

上游两个 spec 已把地基铺好：`test-tiering-fast-lane` 给了 6.8 s 的快档闸门；
`kernel-boundary-decoupling` 解除了 4 条跨层反向边，并留下
`module-roster.ts` 作为 core / runner / adapters 三分的**权威事实源** + 依赖方向守卫。

**要改成什么**：新建 `@blksails/pi-web-core`，把 neutral + core 共 32 个模块搬进去；
`@blksails/pi-web-server` 降为**兼容 re-export 层**（保留装配层的主 barrel 与默认能力面清单），
外部消费方零改动。core 包的依赖判据机械可校验：**不出现** `hono` / `e2b` / `pg` /
MCP SDK / 包注册表客户端，agent 运行时 SDK 只能是 peer 且仅类型导入。

> 完整背景、权威模块清单、继承的已知欠债与约束见同目录 `brief.md`（已于 2026-07-29 据实测修订）。

---

## Introduction

本特性把「契约上已经分层、物理上还是一坨」的状态，落成真实的包边界。

它的价值不在代码更好看，而在**依赖树**：切开之后，一个只要会话引擎的宿主不再被迫安装
云沙箱 SDK 与数据库驱动。这是 pi-clouds、desktop 两端复用内核的前提。

本特性**只搬不改**。唯一的例外是继承自上游的一条已知欠债（模型目录服务对网关适配器的值依赖），
它必须在本轮解除，否则 core 包的依赖判据无法成立 —— 那一处是有意的逻辑改动，
须单独成任务、单独复核，不得混进搬迁的 diff 里。

## Boundary Context

- **In scope**：新建 core 包及其构建配置；32 个模块的物理移动；兼容层降级；
  继承欠债的解除；两个既有守卫（分档、依赖方向）的跨包适配；全仓解析配置同步。
- **Out of scope**：
  - runner 实现与 adapters 的搬迁（各归后续两个 spec）；
  - 宿主装配层（`lib/app`）、`server/cli`、desktop、UI 包的**结构性**改动
    —— 但解除继承欠债时对装配点的必要改动除外；
  - 任何模块的功能性改写、性能优化、命名整理；
  - 宿主契约 v1 的修改。
- **Adjacent expectations**：
  - 本特性**期待**后续两个提取 spec 以本轮建立的包边界与守卫为基础；
  - 本特性**不承诺**内核包已"干净到可独立发布" —— runner 与 adapters 仍在旧包里，
    core 对它们的依赖已由守卫证明为零，但完整的三包形态要等后两个 spec。

---

## Requirements

### Requirement 1: 内核包成立且依赖判据可机械校验

**Objective:** 作为想复用内核的宿主实现者，我希望内核包的依赖面窄到可被机械断言，
以便"它没有偷偷拖进云厂商 SDK"是一个可验证的事实，而不是一句承诺。

#### Acceptance Criteria

1. The 内核包 shall 包含权威名册中标注为 neutral 与 core 的全部模块。
2. The 内核包的依赖声明 shall 不包含 HTTP 框架、云沙箱 SDK、数据库驱动、MCP SDK 与包注册表客户端。
3. Where 内核包需要 agent 运行时 SDK，the 依赖声明 shall 将其列为 peer，且源码中仅以类型方式引用。
4. If 内核包的依赖声明出现被禁依赖，then the 包依赖守卫 shall 使测试失败并指出具体依赖名。
5. The 内核包 shall 可在不预先构建任何产物的前提下被本仓其它包直接消费。

### Requirement 2: 兼容层导出表面逐字不变

**Objective:** 作为既有消费方（宿主装配层、示例、e2e、跨仓），我希望这次拆包对我完全不可见，
以便我不必跟随改动 —— 该包已发布上游，跨仓静默不匹配的代价极高。

#### Acceptance Criteria

1. The 兼容层包 shall 保留其包名与全部子路径导出，一个都不减少。
2. When 从兼容层主入口导入，the 导出符号集合 shall 与改动前逐字相同。
3. The 兼容层包 shall 保留装配层模块（主入口聚合模块与默认能力面清单），不将其移入内核包。
4. If 某个符号在改动前**刻意不从主入口导出**，then the 兼容层 shall 保持该缺口，不得顺手补全 —— 那些缺口是为挡依赖污染有意为之的。
5. The 兼容层包 shall 不改变任何既有消费方的导入路径。

### Requirement 3: 继承欠债解除

**Objective:** 作为内核包的守卫，我希望内核不再值依赖任何适配器，
以便 R1.2 的依赖判据在源码层与包声明层同时成立。

#### Acceptance Criteria

1. The 模型目录服务 shall 不再值导入网关适配器的任何符号。
2. Where 模型目录服务需要网关的合并能力，the 服务 shall 经其既有的注入结构获得。
3. When 未注入网关能力，the 模型目录服务 shall 保持与"网关套件未启用"完全一致的行为。
4. The 欠债登记表 shall 在该欠债解除后不再列出它。

### Requirement 4: 两个守卫跨包后仍然有效

**Objective:** 作为后续两个提取 spec 的实施者，我希望守卫在拆包后继续起作用，
以便边界不会在接下来的两次搬迁中悄悄腐化。

#### Acceptance Criteria

1. The 依赖方向守卫 shall 在拆包后仍能覆盖内核包与兼容层包中的每个模块。
2. The 分档守卫 shall 在拆包后仍能覆盖两个包中的每个测试文件。
3. If 某个守卫在拆包后扫描不到任何文件，then the 守卫 shall 失败，而非静默通过。
4. When 新增跨包反向依赖，the 依赖方向守卫 shall 使测试失败并指出源与目标。

### Requirement 5: 通过面与解析配置不回退

**Objective:** 作为开发者，我希望拆包后测试与类型解析一切照旧，
以便这次改动是纯粹的结构收益，不夹带回归。

#### Acceptance Criteria

1. When 全量测试运行完成，the 测试面 shall 使通过的文件数与用例数不低于开工快照，且该结果在连续两次运行中一致。
2. The 类型检查 shall 通过，无新增错误。
3. The 全仓解析配置 shall 使新包可被源码方式解析，仓库根的测试与类型检查均不因新包而失败。
4. When 宣称本特性完成，the 交付 shall 提供快档与 it 档的实测运行输出（含耗时），而非仅"全绿"的结论。
5. The 快档 shall 在拆包后仍在 10 秒内完成。
