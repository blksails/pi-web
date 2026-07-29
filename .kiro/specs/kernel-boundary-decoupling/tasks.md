# Implementation Plan — kernel-boundary-decoupling

> 顺序：守卫先建（此时**应报红 4 条边**，那是它有判别力的证明）→ 三条边按改动面从小到大解除
> → MemoryWorkspace 正式化 → 守卫转绿并取证。每步的回归面单调递增，便于定位。
>
> ★ 开工快照（main `2483b2e7` + commit `8a731c24` 实测）：
> fast 190 文件 / 1840 用例 · fast-mock 5 / 31 · it 83 / 657 · e2e 3 / 3（合计 281 / 2531）。

## 1. 名册与依赖方向守卫

- [x] 1.1 建立模块层归属名册与判定纯函数
  - 为 `src/` 下每个顶层模块目录与顶层单文件模块标注层：neutral / core / runner / adapters
  - 提供由模块路径反查层、以及判定「是否跨层反向」的纯函数
  - 维护**显式豁免名册**，每条豁免须写出理由（`capability → auth` 的纯类型边是首条）
  - 未知模块必须抛错而非静默归类 —— 新增模块时强制归类
  - **观察完成**：单测覆盖 —— 名册中每个模块返回正确层、`core → adapters` 判为反向、
    `adapters → core` 判为正向、未知模块抛错
  - _Requirements: 1.5, 4.1, 4.5_
  - _Boundary: module-roster_

- [x] 1.2 实现依赖方向守卫并自证判别力
  - 扫描 `src/` 下每个文件的**直接**导入（不做传递分析 —— 已被上游 spec 实测证伪，59% 误报）
  - 区分值导入与 `import type`，否则纯类型豁免会被误报
  - 失败消息须含：源模块、目标模块、导入所在文件与行号
  - 断言名册覆盖 `src/` 下每个模块，无未归类
  - **观察完成**：此刻在**未解耦**的代码上运行，守卫报红并列出 4 条边
    （`rpc-channel→sandbox-image`、`runner→auth`、`runner→ai-gateway`、`config→http`）；
    若此时为绿，说明它恒真，须当场排查
  - _Depends: 1.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: dependency-guard_

## 2. 边 1：共用纯逻辑归位

- [x] 2.1 把命名派生模块移到中立位置
  - 该模块是构建期（镜像烘焙）与运行期（模板解析）**共用**的纯命名逻辑，唯一外部依赖是哈希算法
  - 移到顶层中立位置，与既有的同形模块（源标识键派生）并列
  - 两侧消费方改为从中立位置导入；**不得**留下第二份实现
  - **观察完成**：守卫不再报这条边；构建期与运行期从同一模块导入（结构性保证命名一致）
  - _Depends: 1.2_
  - _Requirements: 1.1_
  - _Boundary: template-name_

## 3. 边 3：配置路由归位

- [x] 3.1 把 5 个配置路由文件移到路由目录
  - 这 5 个文件是**路由**而非配置域逻辑；路由目录下已住着 11 个同类文件
  - 移动后其对配置模块内部的依赖是**正确方向**（HTTP 层在配置层之上），且该方向本就存在
  - 一律 `git mv` 保留历史
  - **观察完成**：配置模块不再导入 HTTP 模块；`git status` 显示为重命名（R）
  - _Depends: 2.1_
  - _Requirements: 1.3_
  - _Boundary: 配置路由文件_

- [x] 3.2 调整两个 barrel 并逐字比对主入口符号集合
  - 从配置 barrel 移除这 5 个路由的 re-export，在 HTTP barrel 补上
  - 主 barrel 对两者都是 `export *`，故符号集合应当**逐字不变**
  - **观察完成**：改动前后各导出一次主入口符号清单，`diff` 为空 —— 这是 R2.1 的唯一硬证据，
    不能以「应该没问题」代替
  - _Depends: 3.1_
  - _Requirements: 1.3, 2.1_
  - _Boundary: config/http barrel_

## 4. 边 2：模型源注册契约与注入

- [x] 4.1 定义模型源注册契约并让两个具体实现符合它
  - 契约由 **runner 层定义**、adapters 层实现（依赖倒置：具体依赖抽象）
  - 两个具体实现**新增**符合契约的导出，既有导出一律保留（增量演进，不破坏其它消费方）
  - **观察完成**：两个实现的 `resolveSpecFromEnv` 在环境未配置时返回空值且不抛；
    单测覆盖两者
  - _Depends: 3.2_
  - _Requirements: 1.2, 1.4, 5.3_
  - _Boundary: ModelSourceRegistrar 契约与两个实现_

- [x] 4.2 让装配映射器改为消费注入的注册器列表
  - 移除对两个具体模块的直接 import
  - 现有对某个具体 provider 名的硬编码比较，改为查询注入列表中的 provider 名
  - 注入空列表时的行为须与「两个源都未配置环境」一致，**不得**变成启动失败
  - **观察完成**：该文件不再出现对 adapters 模块的 import；空列表用例通过
  - _Depends: 4.1_
  - _Requirements: 1.2, 1.4_
  - _Boundary: option-mapper_

- [x] 4.3 在 runner 引导入口装配并注入具体注册器
  - ★ 注入点必须在**引导入口**，不能只让映射器接参数而由 runner 主模块去 import 那两个模块
    —— 那样边只是从一个文件挪到另一个文件，跨层依赖依然成立
  - **观察完成**：守卫不再报这两条边；runner 子进程装配后共享 registry 中**确实出现两个 provider**
    （比对注册结果，不能只确认子进程起来了 —— 这类改动的失败形态正是「装配成功但模型不可用」）
  - _Depends: 4.2_
  - _Requirements: 1.2, 1.4_
  - _Boundary: runner 引导入口_

## 5. 内存 Workspace 正式化

- [x] 5.1 把内存 Workspace 提升为正式导出
  - 从测试 fixture 目录迁入源码的 testing 子目录，与既有一致性套件同址
  - 经既有 `testing` 子路径导出；既有测试改为从正式导出面引入
  - **观察完成**：内存实现通过既有 Workspace 一致性套件；快档中有用例在不写真实文件系统的
    前提下使用它；导出路径不依赖测试目录的物理位置（后续 spec 可平移）
  - _Depends: 1.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: workspace/testing_

## 6. 验证

- [x] 6.1 守卫转绿并确认名册覆盖
  - **观察完成**：守卫全绿；名册覆盖断言成立；与任务 1.2 的红形成对照，证明守卫非恒真
  - _Depends: 2.1, 3.2, 4.3_
  - _Requirements: 4.1, 4.4, 4.5_

- [x] 6.2 确认契约与打包约束未被破坏
  - 确认未触发宿主契约升版（无签名/语义变更、无可选改必填、无输入域收紧）
  - 确认从主入口导入不会连带加载 agent 运行时 SDK
  - **观察完成**：类型检查通过；主入口的加载面与改动前一致
  - _Depends: 6.1_
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6.3 与开工快照逐项比对并留证
  - 连续两次运行全量（快档 + it 档），与开工快照比对文件数、用例数、跳过数
  - 对任何差异逐条给出归因
  - **观察完成**：两次结果彼此一致，且不低于快照（fast 190/1840、fast-mock 5/31、it 83/657）；
    交付物含快档与 it 档的**实测运行输出（含耗时）**，而非仅「全绿」的结论
  - _Depends: 6.1, 6.2_
  - _Requirements: 2.2, 2.3, 2.4_


---

## Implementation Notes（任务 1.1–1.2）

### 守卫在建成当天就付了两次账

**① 它抓到了自己的漏报盲区。** 初版按**行**扫描 import，而本仓库大量导入写成多行
（`import {` 与 `} from "..."` 不同行）。结果：已知的 `rpc-channel→sandbox-image` 与
`runner→auth` 两条边**整条漏掉**，只报出单行写法的那些。
★ 若不是拿已知边交叉核对，我会照着不完整的清单「修完收工」。
**一个会漏报的守卫比没有守卫更坏** —— 它让人以为那个方向有人看着。改为整文件跨行扫描。

**② 它揪出名册把两个模块分错了层。** 初版把 `host-assembly` 与 `index` 归为 core，
于是报出 **11 条假边**（它们指向 5 个 adapters 模块）。查证：`host-assembly` 的文件头
自述「本模块 import 真实工厂（含 pi SDK 传递依赖）…**绝不**经主 barrel 导出」——
它和 `index`（主 barrel）都是**装配层**，按定义就该同时引用 core 与 adapters。
故新增 `assembly` 层（序 3，在所有层之上）。

★ **这条对 `core-package-extraction` 有直接后果**：`host-assembly` 与 `index`
**不应进 core 包**，它们留在兼容层包。design 阶段没预见到这一点。

### 实测的真实边只有 4 条，且与 brief 的判断有出入

| 边 | 性质 | 处置 |
|---|---|---|
| `rpc-channel(core) → sandbox-image(adapters)` | 纯逻辑模块（120 行，仅 `node:crypto`）misfiled 在 adapter 目录 | 归位（任务 2.1） |
| `model-catalog(core) → ai-gateway(adapters)` | **同型**：`ai-gateway/model-catalog.ts` 的 `mergeModelCatalog` 是纯函数 | 归位（brief/design 未列，新增） |
| `runner → auth(adapters)` | 真实跨层能力依赖 | 契约 + 注入（任务 4.x） |
| `runner → ai-gateway(adapters)` | 同上（main 新引入） | 契约 + 注入（任务 4.x） |

★ **重复出现的结构性问题**：adapter 目录里混着被 core 消费的纯逻辑模块。
这不是四条孤立的边，而是同一种失误的两个实例 —— 后续 spec 应留意还有没有第三个。

### R1.3（`config → http`）—— 已按已批准需求执行

守卫**不报**这条边 —— 因为 `config` 与 `http` 同属 core，层模型表达不了 core 内部的次序。
进一步说：**这条边不阻塞拆包**（两者都进 core 包）。它仍是真实的改进
（消除 `config ↔ http` 双向依赖），但性质是「core 内部整洁」，不是「拆包前置条件」。

**处置**：需求 R1.3 已批准，故照做 —— 5 个路由文件 `git mv` 到 `http/routes/`，导出从 config
barrel 挪到 http barrel。主入口符号集合 **313 → 313、diff 为空**，R2.1 拿到硬证据。

但要记下：守卫**不报**这条边（config 与 http 同属 core，层模型表达不了 core 内部次序），
且它**不阻塞拆包**（两者都进 core 包）。这次是按已批准需求做的整洁改进，
不是拆包前置条件。若将来要机械强制 core 内部次序，需给名册加子层序。


## 验收证据（任务 6.1–6.3）

### 全量连跑两次 —— 完全一致且全绿

| 档 | 快照（开工前） | RUN 1 | RUN 2 | 差异归因 |
|---|---|---|---|---|
| fast | 190 / 1840 | 189 passed + 3 skipped (192) / 1847 + 9 (1856) | 同左 | +2 文件 = 名册与守卫测试；+16 用例 = 12 + 4 |
| fast-mock | 5 / 31 | 5 / 31 | 同左 | 无变化 |
| it | 83 / 657 | 82 passed + 1 skipped (83) / 651 + 6 (657) | 同左 | **逐位相同** |
| e2e | 3 / 3 | 未在默认路径 | — | 无变化 |
| 合计 | 281 / 2531 | **283 / 2547** | 一致 | 零缺口 |

墙钟：2:56 与 2:43。

### 守卫由红转绿（判别力自证）

- 建成时（未解耦）：报红，列出 `rpc-channel→sandbox-image`、`runner→auth`、`runner→ai-gateway`
  三条值依赖边 + 一条欠债边。
- 解耦后：**39/39 全绿**。

### 主入口导出表面（R2.1 硬证据）

改动前 **313** 个符号 → 改动后 **313** 个，`diff` 输出为空。

### 契约与打包约束（R5）

`tsc --noEmit` **exit 0**；未改任何契约签名/语义；新增导出均为增量（两个 adapter 的
provider 名常量原样 re-export，既有消费方零改动）。

## Implementation Notes（任务 2.x–6.x）

### 最重要的一条：装配缝放错位置，被 it 档抓个正着

任务 4.3 初版把模型源的注册放在 `runner-bootstrap.mjs`（生产入口）。全量跑出 **1 个稳定失败**
（`egress-login-subprocess`：`expected [...] to include 'text-delta'`）—— **正是设计里预判的
「装配成功但模型不可用」**。

根因：`runner.ts` 是**被文档化的第二条入口**（其文件头就写着 `node --import jiti/register
.../runner.ts` 的用法，另有 2 个 it + 4 个 node e2e 这么起）。装配缝只放在 bootstrap，
直接入口就静默丢掉全部模型源。

修法：把组合移到两条入口的**汇合点** `main()`，且用**动态**导入 —— 静态 import 会让
`runner → host-assembly → adapters` 成为编译期依赖，切包后 runner 包直接拖上 adapters 包。

★ 同时**把守卫扩展为一并扫描 `import("...")`**：否则「把静态 import 改成动态」就成了绕过
守卫的后门，而依赖关系一点没变。这条运行期组合边在 `ALLOWED_EDGES` 里显式登记并写明理由，
**不是靠守卫看不见蒙混过去**。

### 其它

- **常量下沉**：`AI_GATEWAY_PROVIDER_NAME` / `EGRESS_PROVIDER_NAME` 移到中立模块。
  起因是我一度把 runner 的错误文案判据改成「查注册表」，被 it 档抓到 —— 那段文案本身就把
  「网关套件未启用、未注册该 provider」列为成因，用注册状态当判据会让最需要它的场景恰好拿不到它。
- **推翻了一条前序 spec 的刻意决定**：`host-contract-ports` 曾明确「内存 Workspace 刻意留在
  test 目录、不对外暴露」。本 spec 有意推翻，理由写在两处代码注释里（前提变了：fast 档要求不写
  真实 fs）。原决定要防的「参照实现二义」未被破坏 —— 出的是测试替身，只走 `testing` 子路径。
- **一致性套件自测直连模块**：它用的是**故意有缺陷的变体**（`createFlatMemoryWorkspace` 等），
  那些不该进公开导出面，故不经 barrel。
