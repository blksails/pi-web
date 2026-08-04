# Brief: kernel-boundary-decoupling

## Problem

`packages/server` 内部的模块依赖**大体**单向收敛,但有三条边是反向或越层的。它们在同一个包里
不构成编译错误,一旦按 core / runner / adapters 切包就会立刻变成**循环依赖或反向依赖**:

| 越界边 | 切包后的后果 |
|---|---|
| `rpc-channel/ → sandbox-image/` | 传输抽象(core)反向依赖 e2b 烘焙计划(adapters) |
| `runner/ → auth/` | runner 包依赖 adapters 的 egress 凭据模型 |
| `config/ → http/` | 配置域与路由 co-locate,内核带上端点 |

若把「解耦」和「移动文件」混在一次 diff 里做,复核者面对的是几百个文件位置变化 —— 一个搬错
位置的文件和一条被悄悄改掉的依赖**在 diff 里长得一模一样**。这正是大规模重构翻车的典型形态。

另有一处不是越界边、但是切包的**前置缺口**:`MemoryWorkspace` 目前只是
`packages/server/test/workspace/fixtures/memory-workspace.ts` 里的 test fixture。fast 测试档的判据
之一是「无真实 fs」,而 Workspace 是内核的读写底座 —— 没有正式导出的内存实现,fast 档根本无从
测试任何碰 Workspace 的代码。

## Current State

- 依赖方向扫描(`packages/server/src` 各模块的 `../<mod>/` 引用):
  - `session → agent-source, attachment, logging, plugin, rpc-channel`(正常)
  - `rpc-channel → sandbox-image` ⚠
  - `runner → attachment, attachment-bridge, auth ⚠, config, plugin, rpc-channel, sandbox, session-store, state`
  - `http → agent-source, attachment, attachment-bridge, commands, completion, config, plugin, rpc-channel, session`(正常,http 在最外层)
  - `config → config, http ⚠, plugin, workspace`
  - `capability → auth`(**仅类型**,`import type`,编译期擦除,可接受)
- `docs/pi-web-host-contract-v1.md` v1 已冻结,P1–P5 端口就位;
  host-contract `ports` / `capability-composition` / `config-on-workspace` / `stores-on-workspace`
  四个 spec 全部 `phase=implemented`、任务全勾。抽象已有,**物理边界未切**。
- `packages/server/src/index.ts` 的 barrel 注释已逐模块论证「有无 pi SDK 值导入」——
  这套论证是本 spec 的现成事实源,但它论的是 **bundle 安全**,不是**包边界**,两者不等价。
- `src/workspace/testing/` 已有框架无关的一致性套件(`ConformanceTarget` / `SuiteRunner`),
  经 `@blksails/pi-web-server/testing` 子路径导出;`MemoryWorkspace` 却留在 test 目录下。

## Desired Outcome

- 三条越界边全部解除,`packages/server/src` 内部依赖方向对「core / runner / adapters」三分**已经成立**
  —— 即:届时只需移动文件,不需再改任何 import 方向。
- `MemoryWorkspace` 成为正式导出(经 `testing` 子路径),fast 档可依赖它测试 Workspace 相关内核逻辑。
- 存在一条**依赖方向守卫测试**,断言未来三个包的划分边界不被反向依赖穿透。
- **零文件移动到新包**,`packages/server` 的 exports 表面与外部行为完全不变。

## Approach

原地解耦,分三步,每步独立可复核:

1. **`rpc-channel → sandbox-image`**:把 sandbox-image 需要的传输侧信息反转为**注入**或下沉到
   共享的纯类型模块 —— 传输抽象不应知道镜像烘焙的存在。
2. **`runner → auth`**:egress 模型源改为由装配层注入(barrel 注释已记载
   `egress-model-source` 引 pi SDK 值、刻意不进主 barrel,说明该边本就被当作特殊情况处理)。
3. **`config → http`**:配置域注册与其 HTTP 路由分离,路由工厂上移到 http 层。

再加两件:

4. `MemoryWorkspace` 从 test fixture 提升为 `src/workspace/testing/` 的正式导出。
5. **依赖方向守卫测试**:按预定的 core / runner / adapters 模块名册,断言不存在反向 import。
   这条守卫在文件搬迁前就该绿 —— 它是「可以开始搬了」的判据。

## Scope

- **In**:三条越界边的原地解耦;`MemoryWorkspace` 提升为正式导出;依赖方向守卫测试。
- **Out**:任何文件移动到新包(归后续三个提取 spec);`capability → auth` 那条**纯类型**边
  (编译期擦除,切包后 `import type` 跨包合法,不必处理);模块的功能性改写。

## Boundary Candidates

- 传输抽象与镜像烘焙的接缝(`rpc-channel` / `sandbox-image`)
- runner 装配的凭据注入点(`runner` / `auth`)
- 配置域注册与其 HTTP 投影的接缝(`config` / `http`)
- 内核 test double 的正式化(`workspace/testing`)
- 依赖方向守卫(领域无关,后续三个 spec 复用)

## Out of Boundary

- 不改宿主契约 v1 本身 —— 它已冻结,改签名即触发 v2
- 不动 `packages/server` 的公开 exports(6 个子路径)
- 不处理 `capability → auth` 的纯类型边

## Upstream / Downstream

- **Upstream**:`test-tiering-fast-lane`(需要 fast 闸门验证解耦不破坏行为);
  host-contract 系列四个已实现 spec(端口抽象的既有成果)。
- **Downstream**:`core-package-extraction` / `runner-package-extraction` /
  `adapters-package-extraction` —— 三者都以本 spec 的守卫转绿为开工前提。

## Existing Spec Touchpoints

- **Extends**:`host-contract-ports`(`MemoryWorkspace` 与一致性套件是它的产物,本 spec 把
  test fixture 提升为正式导出,属该 spec 边界的自然延伸)。
- **Adjacent**:`rpc-channel`、`agent-runner`、`e2b-sandbox-transport`、
  `sandbox-baked-agent-image`、`sandbox-credentials-v2` —— 三条越界边分别落在这些 spec 的地盘上,
  改动须与它们的既有设计对齐,避免把已定的接缝改坏。

## Constraints

- 宿主契约 v1 已冻结:**仅允许增量演进**(加可选成员、加新端口);改方法签名/语义、
  可选改必填、收紧输入域都是破坏性变更,须升 v2。本 spec 不得触发 v2。
- 解耦不得改变任何运行期行为 —— 验收以 fast + it 全绿且不低于基线为准
  (main `6b638622`:server unit 档 267 文件 / 2420 用例;★两次全量运行结果不一致,现状本身不稳定)。
- `src/index.ts` barrel 的「无 pi SDK 值导入」论证是 bundle 安全约束,解耦时**不得破坏**它 ——
  该约束的失效形态是把整套 pi SDK 打进路由 bundle,历史上吃过。
