# Requirements Document

## Project Description (Input)

**谁有问题**：即将执行 core / runner / adapters 三包拆分的实施者与复核者。

**现状**：`packages/server` 内部模块依赖大体单向收敛，但有三条边是反向或越层的。它们在同一个包里
不构成编译错误，一旦按 core / runner / adapters 切包就会立刻变成循环依赖或反向依赖：

| 越界边 | 切包后的后果 |
|---|---|
| `rpc-channel/ → sandbox-image/` | 传输抽象（core）反向依赖 e2b 镜像烘焙（adapters） |
| `runner/ → auth/` | runner 包依赖 adapters 的 egress 凭据模型 |
| `config/ → http/` | 配置域与路由 co-locate，内核带上端点 |

若把「解耦」和「移动文件」混在一次 diff 里做，复核者面对的是几百个文件位置变化 ——
**一个搬错位置的文件和一条被悄悄改掉的依赖，在 diff 里长得一模一样**。

另有一处不是越界边、但是切包的前置缺口：`MemoryWorkspace` 目前只是
`packages/server/test/workspace/fixtures/memory-workspace.ts` 里的 test fixture。fast 测试档的判据
之一是「无真实 fs」，而 Workspace 是内核的读写底座 —— 没有正式导出的内存实现，fast 档无从测试
任何碰 Workspace 的代码。

**要改成什么**：**原地**解除三条越界边（不移动任何文件到新包），把 `MemoryWorkspace` 提升为正式
导出，并建立一条**依赖方向守卫**，断言未来三包的划分边界不被反向依赖穿透。守卫转绿即是
「可以开始搬文件了」的判据。`packages/server` 的对外 exports 表面与运行期行为**完全不变**。

> 完整背景、实测依赖扫描结果、边界与约束见同目录 `brief.md`。
> 上游 `test-tiering-fast-lane` 已完成，提供 fast 档（暖跑 ~6.8s）作为本 spec 的回归闸门。

---

## Introduction

本特性只做一件事：**把依赖方向改对，一个文件都不搬**。

它存在的唯一理由是让后续三个提取 spec 的 diff 可被复核。拆包时的致命失败形态不是「搬错了」，
而是「搬的同时顺手改了依赖，而复核者在几百个文件位置变化里看不出来」。把解耦单独做一轮，
其 diff 小、可逐条论证；等文件真正搬动时，任何依赖方向的变化都应当是零。

本特性的完成判据不是「跑绿」，而是一条**依赖方向守卫**由红转绿 —— 红的那一刻证明它有判别力，
绿的那一刻宣告「可以开始搬了」。

## Boundary Context

- **In scope**：三条越界边的原地解耦；`MemoryWorkspace` 提升为正式导出；依赖方向守卫。
- **Out of scope**：
  - 任何文件移动到新包（归后续三个提取 spec）；
  - `capability → auth` 那条**纯类型**边（`import type`，编译期擦除，切包后跨包合法）；
  - 模块的功能性改写、性能优化、命名整理；
  - 宿主契约 v1 本身的任何修改。
- **Adjacent expectations**：
  - 三条越界边分别落在 `rpc-channel`、`agent-runner`、`e2b-sandbox-transport`、
    `sandbox-baked-agent-image`、`sandbox-credentials-v2` 等既有 spec 的地盘上，
    本特性**只改依赖方向，不改它们已定的接缝语义**；
  - 本特性**不承诺**守卫能覆盖拆包的全部正确性 —— 它只保证「依赖方向不反向」这一维度。

---

## Requirements

### Requirement 1: 依赖方向单向收敛

**Objective:** 作为拆包实施者，我希望三条越界边在文件移动之前就已解除，
以便后续搬迁只是纯粹的位置变化，不夹带依赖方向的改动。

#### Acceptance Criteria

1. The 服务端包 shall 使传输抽象模块不再依赖镜像烘焙模块。
2. The 服务端包 shall 使 runner 模块不再值依赖凭据模块。
3. The 服务端包 shall 使配置域模块不再依赖 HTTP 路由模块。
4. Where 一个模块需要位于其下游的能力，the 服务端包 shall 经**注入**或**纯类型依赖**获得，而非直接值导入。
5. The 服务端包 shall 保持 `capability → auth` 的纯类型依赖不变（该边在编译期擦除，切包后合法）。

### Requirement 2: 零行为变更与对外表面不变

**Objective:** 作为复核者，我希望这一轮改动在运行期完全不可观测，
以便任何行为差异都可以被直接判定为缺陷，而不必逐条辨析是否「预期内的副作用」。

#### Acceptance Criteria

1. The 服务端包 shall 保持其对外 exports 表面（主入口与全部子路径导出）逐条不变。
2. The 服务端包 shall 不改变任何模块的运行期行为。
3. When 全量测试运行完成，the 服务端包 shall 使通过的文件数与用例数不低于本 spec 开工前的快照，且该结果在**连续两次运行**中一致。
4. When 本特性完成，the 交付物 shall 包含快档与 it 档的实测运行输出（含耗时），而非仅「全绿」的结论。

### Requirement 3: 内存 Workspace 成为正式导出

**Objective:** 作为 fast 档测试的编写者，我希望有一个受支持的内存 Workspace 实现，
以便在不触碰真实文件系统的前提下测试碰 Workspace 的内核逻辑。

#### Acceptance Criteria

1. The 服务端包 shall 经受支持的导出面提供 Workspace 的内存实现。
2. Where fast 档测试需要 Workspace，the 测试 shall 能在不写真实文件系统的前提下使用该实现。
3. The 内存实现 shall 通过既有的 Workspace 一致性套件。
4. When 内存实现被移动到新包时，the 导出路径 shall 可被后续 spec 平移，不依赖测试目录的物理位置。

### Requirement 4: 依赖方向守卫

**Objective:** 作为拆包实施者，我希望「依赖方向正确」由机械手段判定，
以便「可以开始搬文件了」是一个可验证的状态，而不是一次人工评估。

#### Acceptance Criteria

1. The 依赖方向守卫 shall 依据 core / runner / adapters 三分名册，断言不存在跨层反向依赖。
2. If 某模块出现跨层反向依赖，then the 守卫 shall 失败并报出源模块、目标模块与导入所在位置。
3. The 守卫 shall 随快档自动执行，无需开发者额外触发。
4. When 在三条越界边尚未解除的代码上运行，the 守卫 shall 报红 —— 该红是其判别力的证明；若此时为绿，须当场排查是否恒真。
5. The 守卫 shall 覆盖三分名册中的每一个模块，不留未归类模块。

### Requirement 5: 不触发契约升版与 bundle 污染

**Objective:** 作为跨仓消费方，我希望这一轮解耦不动已冻结的契约、也不破坏既有的打包安全约束，
以便两端实现无需跟随改动。

#### Acceptance Criteria

1. The 服务端包 shall 不触发宿主契约 v2 —— 不改方法签名与语义、不把可选成员改为必填、不收紧既有输入域。
2. The 服务端包 shall 保持从其主入口导入时不会连带加载 agent 运行时 SDK。
3. If 解耦需要新增导出，then the 新增 shall 是增量的（新增可选成员或新端口），不破坏既有消费方。
