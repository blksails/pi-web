# Requirements Document

## Project Description (Input)

**谁有问题**：任何只想跑 agent runner 的宿主 —— e2b 沙箱、pi-cloud 云端、未来的 edge。

**现状**：runner（28 文件 / 3807 行）与 adapters、装配层同住 `@blksails/pi-web-server`。
于是一个只想跑 runner 的宿主被迫装下整包依赖 —— 其中 `e2b` / `pg` / `ws` / MCP SDK
在 runner 目录里**零引用**。最刺眼的一个：e2b 沙箱镜像里的 runner 装着 `e2b` SDK，
而沙箱内部的 runner 根本不需要 e2b 客户端来连接它自己。

runner 本质上已经是另一个包，只差一个 `package.json`：它跑在子进程里，由 cwd-无关的引导脚本
经 jiti 加载，App / Handler 从不直接导入它 —— 物理边界与运行边界本就重合。

**要改成什么**：新建 `@blksails/pi-web-runner`，把 runner 实现与引导脚本搬进去；
`@blksails/pi-web-server` 保持对外契约不变。

> 完整背景、五种运行形态的实测画像、两条「必须同包」耦合与逐条 `path:line` 证据见同目录
> `brief.md`（已于 2026-07-29 据实测修订 —— 初稿的核心论证已被 `core-package-extraction` 推翻）。

---

## Introduction

本特性给 runner 一个真实的包边界。

它的价值同样不在代码更好看，而在**部署形态**：切开之后，沙箱镜像与云端宿主只装 runner
所需的东西，不再连带云沙箱 SDK 与数据库驱动。

★ 本特性的**最高风险不是搬文件，而是路径解析**。实测已确认：开发态下引导路径的主路径与回退路径
**恒等命中**，任何一条断了都观察不到；而生产形态（dist / standalone / desktop）真正生效的
恰恰是那条**不做存在性检查**的回退。历史上这类问题的失败形态全部是「本地绿、部署态崩」，
上一个 spec 刚刚以同一机制被骗过一轮。因此本特性对「通过」的判据比通常更严：
**开发态与单元测试的绿不构成证据**。

本特性**只搬不改**。若发现必须改的逻辑（例如给回退补存在性检查），须单独标注、单独成任务。

## Boundary Context

- **In scope**：新建 runner 包及其依赖声明；runner 实现与引导脚本的物理移动；
  引导路径解析改造；模型源注册契约的归属；兼容层对外契约的保持；测试搬迁；
  **部署形态下的路径解析验证**。
- **Out of scope**：
  - runner 的功能性改写、性能优化、命名整理；
  - adapters 搬迁（并行 spec `adapters-package-extraction`）；
  - 帧通道协议与内置扩展自解析**机制**本身的改动；
  - agent 运行时 SDK 的版本变更；
  - **文档同步** —— 81 个写死旧路径的文件（含 27 章产品手册中英双版）另开一轮；
  - **跨仓改动** —— 沙箱镜像的路径常量在 pi-clouds 仓，本特性只登记不改。
- **Adjacent expectations**：
  - 本特性**期待** `adapters-package-extraction` 以本轮建立的包边界为基础；
  - 本特性**不承诺**沙箱镜像立即受益 —— 镜像消费的是**已发布的 npm 包**，
    真正的切换点在发包与镜像重烘焙时，那在本特性范围之外；
  - 本特性**不承诺**桌面形态已被验证（见 R3 的显式豁免）。

---

## Requirements

### Requirement 1: runner 包成立且依赖面窄到可机械断言

**Objective:** 作为沙箱/云端宿主的实现者，我希望 runner 包的依赖面窄到可被机械断言，
以便"它没有连带装上云沙箱 SDK 与数据库驱动"是一个可验证的事实，而不是一句承诺。

#### Acceptance Criteria

1. The runner 包 shall 包含 runner 实现的全部模块与其引导脚本。
2. The runner 包的依赖声明 shall 不包含云沙箱 SDK、数据库驱动、WebSocket 实现与 MCP SDK。
3. Where runner 包需要 agent 运行时 SDK，the 依赖声明 shall 将其列为 peer，使宿主决定版本。
4. If runner 包的依赖声明出现被禁依赖，then the 包依赖守卫 shall 使测试失败并指出具体依赖名与所在字段。
5. The runner 包 shall 可在不预先构建任何产物的前提下被本仓其它包直接消费。

### Requirement 2: 兼容层对外契约逐字不变

**Objective:** 作为既有消费方（宿主装配层、CLI、桌面壳、跨仓镜像），我希望这次拆包对我完全不可见，
以便我不必跟随改动 —— 该包已发布上游，跨仓静默不匹配的代价极高。

#### Acceptance Criteria

1. When 从兼容层主入口导入，the 导出符号集合 shall 与改动前逐字相同。
2. The 兼容层包 shall 保留其全部子路径导出，一个都不减少。
3. If 某个符号的名称含 runner 字样但其实现不属于 runner，then the 搬迁 shall 不移动它
   —— 命名不是归属判据。
4. If 某个 runner 符号在改动前**不从主入口导出**，then the 兼容层 shall 保持该缺口，不得顺手补全。
5. The 兼容层包 shall 使既有消费方的导入路径与启动命令无需改动。

### Requirement 3: 引导路径在部署形态下可解析，且验证不依赖开发态

**Objective:** 作为部署与运维方，我希望引导路径的正确性有部署态证据，
以便避免"本地绿、换机崩"——这是本特性历史失败率最高的一类，且刚刚发生过一次。

#### Acceptance Criteria

1. The 引导路径解析 shall 在开发态、打包产物态与独立分发态下均返回真实存在的引导脚本。
2. When 引导脚本随 runner 迁移，the 兼容层导出的路径解析能力 shall 仍返回可用路径。
3. If 引导路径解析不到真实存在的脚本，then the 系统 shall 在解析时即失败并指出所查位置，
   而不是把失败延后到子进程启动。
4. When 产物被移动到构建时位置之外，the 引导路径解析 shall 仍然成立，
   且该场景 shall 由换机复现的端到端验证覆盖。
5. The 验收 shall 不把开发态运行与单元测试的通过作为引导路径正确性的证据。
6. Where 桌面形态与沙箱烘焙形态未在本轮验证，the 交付 shall 显式列出它们为已知未验并写明风险与触发条件。

### Requirement 4: 内置扩展在新的模块解析根下仍然可用

**Objective:** 作为使用内置扩展的用户，我希望搬包不会让扩展悄悄消失，
以便"扩展能用"不取决于有没有人恰好去手工验证。

#### Acceptance Criteria

1. While runner 在新包中运行，the 内置扩展 shall 全部可被解析并装载。
2. If 某个内置扩展解析不到，then the 系统 shall 产生可观测的失败信号，而不是静默跳过。
3. The 验收 shall 以内置扩展**实际装载成功**为判据，而非以"没有报错"为判据。

### Requirement 5: 边界守卫在多包后仍然有效

**Objective:** 作为后续提取 spec 的实施者，我希望守卫在本轮之后继续起作用，
以便边界不会在接下来的搬迁中悄悄腐化。

#### Acceptance Criteria

1. The 依赖方向守卫 shall 在拆包后仍能覆盖全部三个包中的每个模块。
2. The 分档守卫 shall 在拆包后仍能覆盖全部三个包中的每个测试文件。
3. If 某个守卫扫描不到任何文件，then the 守卫 shall 失败，而非静默通过。
4. When 新增跨包反向依赖，the 依赖方向守卫 shall 使测试失败并指出源与目标。
5. The 层归属与物理归位的一致性断言 shall 覆盖新包。

### Requirement 6: 通过面与运行形态不回退

**Objective:** 作为开发者，我希望拆包后测试与运行一切照旧，
以便这次改动是纯粹的结构收益，不夹带回归。

#### Acceptance Criteria

1. When 全量测试运行完成，the 测试面 shall 使通过的文件数与用例数不低于开工快照，
   且该结果在连续两次运行中一致。
2. The 类型检查 shall 通过，无新增错误。
3. While 测试真实启动子进程，the 测试 shall 保持在允许启动子进程的档位，
   不得因搬迁而落入禁止启动子进程的档位。
4. The 全仓解析配置 shall 使新包可被源码方式解析，仓库根的测试与类型检查均不因新包而失败。
5. When 宣称本特性完成，the 交付 shall 提供实测运行输出（含耗时与部署态证据），
   而非仅"全绿"的结论。
