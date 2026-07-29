# Implementation Plan — core-package-extraction

> 顺序理由：先下沉测试机制（任务 2）使搬迁全程守卫可用；**继承欠债的解除单独一轮且排在搬迁之前**
> （任务 3）—— 它是本 spec 唯一的逻辑改动，混进 368 个文件的搬迁 diff 就再也看不出来了。
>
> ★ 开工快照（commit `905e988f` 实测，连续两次一致）：
> fast 192 / 1856 · fast-mock 5 / 31 · it 83 / 657 · e2e 3 / 3，合计 **283 文件 / 2547 用例**；
> 兼容层主入口导出 **313** 个符号；`tsc --noEmit` exit 0。

## 1. 基线留底与 core 包骨架

- [x] 1.1 留底主入口符号清单与测试快照
  - 把兼容层主入口的导出符号清单**写入库**（不是临时文件）——它是 R2.2 的比对基准，
    改动它必须是有意动作、会出现在 diff 里
  - 连跑两次全量并留底，核对每次的 `passed + failed + skipped == 总数`
  - **观察完成**：符号清单文件入库且含 313 行；两次全量计数一致
  - _Requirements: 2.2, 5.1_

- [x] 1.2 建立 core 包骨架与全仓解析配置
  - 新包照既有包形态：`exports` 指向源码、`files` 只含 src、`publishConfig` 公开
  - 加入仓库根测试运行器的解析别名 —— ★ **子路径必须排在裸包名之前**，
    否则子路径被裸名吞掉，且报错与顺序无关、极难定位（仓内已有同类注释）
  - **观察完成**：`pnpm install` 后新包出现在 workspace 成员中；
    从本仓另一个包以源码方式 import 新包可解析，无需任何构建
  - _Requirements: 1.5, 5.3_
  - _Boundary: core 包骨架_

## 2. 测试机制下沉

- [x] 2.1 把分档机制与模块名册下沉到 core
  - 分档判据、运行期哨兵、子进程守卫、模块层名册迁入 core 的测试目录
  - 兼容层包的分档配置改为引用 core 的共享件（core 是更低的包，方向正确）
  - **观察完成**：两个包各自的快档均能运行且哨兵确实装上
    （人为制造一次子进程调用可使其转红——**不能只看跑绿**，上游已因此被骗两次）
  - _Depends: 1.2_
  - _Requirements: 4.1, 4.2_
  - _Boundary: 测试机制共享件_

- [x] 2.2 两个守卫改为扫描多个包根，且空扫即失败
  - 依赖方向守卫与分档守卫改为接收包根列表
  - **每个包根都必须至少贡献一个文件**，否则失败并指出是哪个包根扫到了 0 个
  - **观察完成**：把某个包根改成不存在的路径时守卫报红（判别力自证）；
    正常配置下两个守卫覆盖全部 283 个测试文件与全部模块
  - _Depends: 2.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: 两个守卫_

## 3. 解除继承欠债（唯一的逻辑改动，单独一轮）

- [x] 3.1 模型目录服务改为注入网关合并能力
  - 在其**既有**注入结构上新增可选的合并能力；移除对网关适配器的值导入
  - 两个纯类型随契约进 core；网关适配器改为从 core 引入并原样 re-export（导出面不变）
  - 未注入时行为须与「网关套件未启用」逐字节一致
  - 注入了网关目录却漏了合并能力时**快速失败**，不得静默降级
    —— 静默降级的表现是「网关模型从列表里消失」，极难归因
  - 装配点补传；受影响的测试调用同步
  - **观察完成**：欠债登记表不再列出该条且守卫仍绿；单独跑一次全量证明逻辑改动无害
  - _Depends: 2.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: 模型目录服务与其装配点_

## 4. 模块搬迁

- [x] 4.1 搬迁 neutral 与 core 的源码模块
  - 依权威名册搬 32 个模块（182 个文件），一律 `git mv` 保留历史
  - 修正跨模块相对路径；对仍在旧包的 runner/adapters 的引用改为跨包导入
  - **观察完成**：类型检查通过；`git status` 显示为重命名（R）
  - _Depends: 3.1_
  - _Requirements: 1.1_
  - _Boundary: core src 模块_

- [x] 4.2 搬迁对应的测试文件
  - 搬 186 个测试文件，修正相对路径深度
  - **观察完成**：两个包的测试文件数之和仍为 283（无遗失）；分档守卫覆盖全部
  - _Depends: 4.1_
  - _Requirements: 1.1, 4.2_
  - _Boundary: core test 文件_

## 5. 导出面与兼容层

- [x] 5.1 编写 core 主入口
  - 只聚合 core 模块；**不得**包含装配层、runner 实现与 adapters 的任何符号
  - **观察完成**：core 主入口可被加载且不连带拉起 agent 运行时 SDK
  - _Depends: 4.2_
  - _Requirements: 1.1, 1.3_
  - _Boundary: core 主入口_

- [x] 5.2 兼容层降为转发并逐字比对符号集合
  - 兼容层主入口转发 core + 保留本地装配/adapters 符号；5 个子路径改薄转发，
    装配层子路径不变
  - ★ 逐条核对**刻意不导出**的缺口，不得顺手补全 —— 那些是为挡依赖污染有意为之的
  - 把符号比对固化为**常驻测试**（归 it 档：它要加载真实模块）
  - **观察完成**：符号清单与 1.1 留底逐字相同（diff 为空）；
    人为增删一个符号可使该测试转红
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - _Boundary: 兼容层转发面_

- [x] 5.3 声明 core 的依赖并加包依赖守卫
  - core 的依赖声明只保留其真实需要者；agent 运行时 SDK 列 peer
  - 守卫查 `dependencies` 与 `devDependencies` 两个字段
    —— 只查前者会漏掉「被误列为 devDependency 的重依赖」
  - **观察完成**：守卫对人为加入的被禁依赖报红并指出依赖名与所在字段；
    真实声明下为绿
  - _Depends: 5.2_
  - _Requirements: 1.2, 1.3, 1.4_
  - _Boundary: core 包声明与依赖守卫_

## 6. 验证

- [x] 6.1 守卫全绿且覆盖完整
  - **观察完成**：依赖方向守卫、分档守卫、包依赖守卫、符号比对四者全绿；
    每个守卫的空扫断言成立（改坏包根即红）
  - _Depends: 5.3_
  - _Requirements: 1.4, 2.2, 4.1, 4.2, 4.3, 4.4_

- [x] 6.2 类型检查与快档时延
  - **观察完成**：两个包的类型检查均 exit 0；两包快档合计仍 < 10 秒（报实测耗时）
  - _Depends: 6.1_
  - _Requirements: 5.2, 5.5_

- [x] 6.3 与开工快照逐项比对并留证
  - 连续两次运行全量，与快照比对文件数、用例数、跳过数，任何差异逐条归因
  - **观察完成**：两次结果彼此一致且不低于快照（283 文件 / 2547 用例）；
    交付含快档与 it 档的**实测运行输出（含耗时）**，而非仅「全绿」的结论
  - _Depends: 6.2_
  - _Requirements: 5.1, 5.4_


---

## Implementation Notes（任务 1.x）

- **符号清单已入库**：`packages/server/test/compat/main-entry-symbols.txt`（313 行），
  由 `scripts/dump-main-entry-symbols.mjs` 生成。任务 5.2 会把比对固化为常驻测试。
- **新包解析需要显式声明依赖**：pnpm workspace 只为**已声明的**依赖建符号链接。
  骨架建好后从 `packages/server` import 新包会 `MODULE_NOT_FOUND`，直到把
  `@blksails/pi-web-core: workspace:*` 写进兼容层包的 dependencies。
  这一步本属任务 5.x，但验证 R1.5 就必须先做，故提前。
- **根测试 alias 的子路径顺序**：4 条子路径 alias 全部排在裸包名之前（仓内已有同类教训注释）。
- 快档实测 **5.6 s**，根测试解析未受影响。

## Implementation Notes（任务 2.x）

**搬迁面**：8 个文件 `git mv` 进 core（`test/setup/{fast-sentinel,child-process-guard}.ts` +
`test/tiering/{tier-rules,module-roster}.ts` 及其 4 个测试）；新增 `test/tiering/package-roots.ts`
（包根名册 + 空扫断言）、`vitest.config.ts`、`vitest.workspace.ts`、`scripts/run-tests.mjs`。

**判别力自证（★ 不能只看跑绿，本仓已被骗过两次）**——四条全部实测转红：

| 人为破坏 | 实际报出 |
|---|---|
| core 快档里 `spawnSync("echo")` | `[fast 档违规] child_process.spawnSync("echo")` |
| core 快档里 `fetch(...)` | `[fast 档违规] fetch("http://127.0.0.1:1/nope")` |
| **兼容层包**快档里 `spawnSync` | 同上 —— 证明跨包引用 core 的 setup 真的装上了 |
| `PACKAGE_ROOTS` 的 server 路径改错 | `以下包根扫到了 0 个测试文件/顶层模块，守卫实际上什么都没在守：· server —— …` |

额外收获：制造违规时**分档守卫同时报出了 `core/…` 与 `server/…` 两个探针文件**——
这是 R4.1/R4.2「守卫确实覆盖两个包根」最直接的证据，比断言计数更难自欺。

**四个实测坑**：

1. ★ **包内缺 `vitest.config.ts` 会静默继承仓库根配置**。core 起初只建了
   `vitest.workspace.ts`，9 个测试文件躺在 `test/tiering/` 却报 `No test files found`——
   vitest 向上找到了根配置（jsdom + 根 `test/setup.ts` + 根 include）。故 core 补了一份
   与 server 同形的 `vitest.config.ts`，文件头写明"看似多余但必须存在"。
2. ★ **`--passWithNoTests` 只给 fast-mock / it / e2e，fast 档故意不给**。core 现阶段还没有
   这三类测试，空档 exit 1 会让"还没有这类测试"与"测试全炸了"同码；但 fast 档装着两个守卫，
   它变空必须是一次响亮的失败。
3. **跨包 specifier 必须一并解析**（R4.4）。搬迁后 `../auth/x.js` 会写成
   `@blksails/pi-web-server/...`，只认相对路径的话，**一次搬迁就能让所有跨层边集体消失**、
   守卫从此永远绿。子路径→模块名由各包 `exports` 声明推导，不靠名字猜——
   `./model-options` 指的是 `config` 模块而非 `model-options` 模块。
4. **`index` 是唯一的同名冲突**：core 主入口（core 层）vs 兼容层装配 barrel（assembly 层）。
   由 `ROSTER_OVERRIDES` 按包根覆写；名册本身仍按**层**归类，不按包——
   模块在哪个包是层归属的结果，两份事实必然漂移。

**两张名册的路径加了包根前缀**（`server/test/...`）。任务 4.2 搬测试文件时须同步改前缀。

**实测数据**（此步之后）：

- 根 `pnpm test:fast`（两包）**7.0 s**，仍在 10 s 预算内（R5.5）
- 全量：core 4 文件/43 用例 · server fast 188/1817 · fast-mock 5/31 · it 83/657
  → 合计 **283 文件 / 2551 用例**（含 e2e 3/3）。文件数与快照持平；
  用例 +4 = 本步新增的 4 条守卫自证用例，逐条可归因。
- it 档串行耗时 153.4 s；两个包 `tsc --noEmit` 均 exit 0。

## Implementation Notes（任务 3.1 · 唯一的逻辑改动）

**做法**：三个纯类型（`GatewayModelEntry` / `ModelPrecedence` / 新增的 `MergeModelCatalog`）
下沉到 `src/model-catalog/types.ts`；`ai-gateway/model-catalog.ts` 从那里引入并**原样 re-export**，
故适配器导出面逐字不变，`lib/app/ai-gateway-session-assembly.ts` 等既有消费方零改动。
`mergeCatalog?: MergeModelCatalog` 加进**既有的** `ModelCatalogServiceDeps`，装配点
`lib/app/pi-handler.ts` 补传。

★ **类型下沉，实现留在适配器**。`mergeModelCatalog` 不是自足纯函数——它依赖网关的 provider
命名空间与「该模型能否用于会话」的判据。把实现一起搬进 core 只是把 adapters 的知识换个位置
继续违规，那正是欠债当初被登记而非顺手修掉的原因。

★ **漏注入必须当场抛错**。退回「未启用」形态在这里是**能跑通**的：网关模型只是从列表里消失，
没有任何报错。那种症状会被当成网关故障排查很久，真因却是装配点漏传了一个依赖。
测试里专门写下这一点——若改成静默降级，断言会变成 `toBe(SELF_CHAT)` 并**照样通过**。

新增 4 条注入契约用例，其中一条用 spy 核对**三个入参逐一传对**：漏传 `precedence`
会让 env 配的块排序静默失效，而输出看上去完全正常。

**验证**：

- 依赖方向守卫 0 违规，`KNOWN_DEBT` 清空（守卫的「只减不增/无陈旧条目」双向断言均绿）
- 主入口符号集合与 1.1 留底 **313 个逐字相同**（`diff` 为空）
- server 全量 exit 0：fast 188/1821 · fast-mock 5/31 · it 83/657（it 档 155.1 s）
- 两包 + 根 `tsc --noEmit` 均 exit 0
- 根 `pnpm test:app`：**3 个存量红**（`test/commands/publish-preview.test.ts`），
  已用 `git stash` 在 `6025bb51` 上复现同样的 3 个失败——与本改动无关，未修

**累计计数**：283 文件 / 2555 用例（快照 283 / 2547）。
用例 +8 全部可归因：+4 任务 2.x 的守卫自证，+4 本任务的注入契约。

## Implementation Notes（任务 4.1 / 4.2）

### ★ 实施中发现的 spec 级冲突：R1.2 与「adapters 归后续 spec」不可兼得

搬完才暴露：6 个文件把 `e2b` / `pg` / MCP SDK 拖进了 core —— 它们躺在名册判为 core 的模块里
（`rpc-channel` / `session-store` / `config` / `attachment-bridge`），而名册注释正写着
「具体实现属 adapters，由后续 spec 分离」。这与 **R1.2** 直接冲突，而 R1.2 是本 spec 的头号价值。

**先排除的便宜解法**：把重依赖声明成 optional peerDependencies。它对依赖树确实有效，
**但在本仓行不通** —— core 走**源码直连**导出，消费方 `tsc` 会编译到这些文件，缺类型即失败。
源码分发下 optional peer 不是可用选项。这条判据决定了必须摘出去（用户已确认此路径）。

**摘出结果**（4 个新 adapters 模块，均经兼容层主 barrel 原样导出，主入口符号面不变）：

| 新模块 | 内容 | 内核留下什么 |
|---|---|---|
| `sandbox-transport` | e2b-config / e2b-transport / sandbox-ws-transport / template-resolve | `RpcTransport` 端口 + `PiRpcSession` 核心（接缝就是端口） |
| `session-store-postgres` | postgres-store + 按 env 选型的工厂 | 接口、编解码、fs / sqlite 实现，**以及配置形状与 env 解析**（`config.ts`，零后端依赖） |
| `mcp-probe` | MCP 探测实现 | 端口 `config/mcp-probe-port.ts`（只写路由真正用到的三个方法） |
| `attachment-example-tool` | 示例工具（值导入 agent SDK） | —（零生产引用） |

**三处依赖倒置**（都是被 R1.2 逼出来的，非顺手改）：

1. `mcp-config-routes` —— 注入缝**早就在**（`opts.probeService ?? new McpProbeService()`），
   只是默认值把实现拖了进来。改为**必传**而非"缺省降级"：一个静默不探测的 MCP 端点，
   表现是"状态永远 unknown"，看不出是漏装配还是真探不到。
2. `session-list-routes` / `session-actions-routes` —— `storeConfig` 换成 `createEntryStore` 工厂。
   副产品：`session-list-store-retry` 那个用例**不再需要 `vi.mock`**（原先靠替换模块图才能
   让构造失败），直接注入受控工厂即可，少一层模块 mock 而判据不变。
3. `runner` → store 选型工厂是 adapters，与 runner **同层**。沿用仓内已有先例：
   经 `host-assembly/session-store.ts` 动态 import（`runner → host-assembly` 已登记为运行期组合）。

**同时消除了两条 typeOnly 豁免**（不是保留成跨包 import type，是让方向自然成立）：
`egress-model` → 归位 `capability`（契约侧），`agent-definition` → 上移为顶层 core 模块
（全 `import type`，pi SDK 仅类型）。豁免表从 3 条降到 1 条。

### ★ 一个被回退掩盖的真实断裂

`runnerBootstrapPath()` 从**自身位置**推算包根。搬进 core 后 `serverPkgDir` 算出 `packages/core`，
主路径指向不存在的 `packages/core/runner-bootstrap.mjs` —— 而 cwd 回退在开发态**恰好还能命中**，
于是测试全绿、真机照跑，只会在换机/打包后现形。已让它随 `runner-bootstrap.mjs` 留在兼容层包，
并在其文件头写明"必须与该文件同包"。同类修正：`builtin-agents/entry-path.ts` 的 cwd 回退常量。

### 跨包解析机制（先用**一个模块**验证，再批量搬）

- core 声明**通配子路径** `"./*.js": "./src/*.ts"`。理由：兼容层有 **51 个不同深路径目标**要引用，
  其中大多**刻意不在**主入口导出；逐条列具名子路径既维护不动，也会把"跨仓公开 API"与
  "同仓装配方的内部通路"混为一谈。通配不等于放弃封装 —— 挡依赖污染的是 `dependencies` 声明
  与依赖方向守卫，不是导出面的窄。
- 保留 `.js` 后缀使批量改写成为**纯前缀替换**（`../session/x.js` → `@blksails/pi-web-core/session/x.js`），
  94 处无需动扩展名。
- 根 `vitest.config.ts` 加前缀 alias `@blksails/pi-web-core/`，**排在具名子路径之后、裸包名之前**：
  排具名之前会把 `/model-options` 错映射到 `src/model-options`（真身在 `src/config/`）；
  排裸名之后则深路径被裸名前缀吞掉。
- 守卫同步识别通配（`resolveWildcard`）。★ 少了这条，拆包后所有深路径跨包引用都会被当成
  "外部依赖"跳过 —— **一次搬迁就让全部跨层边集体消失，守卫从此永远绿**。
  判别力已实测：把 `template-name` 临时改判 assembly，守卫立刻报出
  `sandbox-image(adapters) → template-name(assembly)` 并带 file:line。
- `packages/server/tsconfig.json` 的 `rootDir` 须放宽到 `..`：源码直连使 server 编译时会拉入
  `packages/core/src/**`，原 `rootDir: "."` 直接报 TS6059。

### 搬迁面（实测）

- **源码**：32 个模块搬入 core，673 处 specifier 改写；随后 6 个适配器文件回摘 server。
  最终 core/src **185** 文件、server/src **90** 文件。
- **测试**：196 个 `git mv` 进 core，92 处跨包 specifier 改写；随后 7 个"测的是兼容层"的文件回迁。
  最终 core/test **184** 个 `.test.ts`、server/test **99** 个，**合计 283 —— 与开工快照持平**。
- 跨包**测试 helper**（`http/helpers`、`session/fixtures`、`session-store/contract`）走相对路径：
  测试目录不在任何包的 `exports` 里，也不该在。

### 验证

- 两包 `tsc --noEmit` 均 **exit 0**；仓库根 `tsc --noEmit` exit 0
- **主入口符号 313 个逐字未变**（与任务 1.1 留底 `diff` 为空）
- 依赖方向守卫 0 违规；`ALLOWED_EDGES` 3 → 1 条，`KNOWN_DEBT` 为空
- core 快档 121 文件 / 1135 用例 + fast-mock 3 / 9 全绿

## Implementation Notes（任务 5.x / 6.x）

**5.1 core 主入口**：把兼容层主 barrel 原有的 25 条 core 导出**逐条**搬成 core 的 `src/index.ts`，
顺序与写法（含刻意的具名导出）一并保留。刻意不在此的三类：两个取数闭包（值导入 agent SDK）
与 `workspace/testing`（测试套件，进主入口会随之进运行期产物）——各有独立子路径。

**5.2 兼容层收敛为一条转发**：25 条 `export *` 收敛成 `export * from "@blksails/pi-web-core"`，
清单只此一份、不会两处漂移；4 个子路径（`./trust` `./testing` 两条走 `src/compat/` 薄转发，
两个 model-options 子路径直指 `src/model-sources/`）。符号比对已固化为**常驻测试**
（`test/compat/main-entry-symbols.it.test.ts`，归 it 档：它要 jiti 加载真实主入口）。
该测试额外断言**基准文件非空且无重复** —— 一个被清空的基准会让主断言恒真，
那是与真正通过长得一模一样的空扫式失效。

**5.3 又摘出一个模块（R1.3 的源码侧判据）**：`config/model-options.ts` 与
`vision-settings/vision-model-options.ts` **值**导入 `AuthStorage.create` / `ModelRegistry.create`，
与 R1.3「源码中仅以类型方式引用」冲突。判据与 e2b/pg 那轮**同源**——源码直连分发下，
把 SDK 声明成 optional peer 挡不住消费方的 `tsc`。二者摘去兼容层包的 `model-sources` 模块；
它们本就刻意不进主 barrel，只经两个子路径暴露，对外形态逐字不变。

**包依赖守卫**（6 条断言，含三条判别力自证）：
- 声明层查 `dependencies` **与** `devDependencies` 两个字段 —— 只查前者会漏掉
  「被误列为 devDependency 的重依赖」；`peerDependencies` 不查（agent SDK 正该在那里）
- 源码侧扫 core/src 的 agent SDK **值**导入（跨行正则；逐行扫会整条漏掉多行 import）
- 判别力实测：逐个注入 7 个被禁依赖 → 逐条报出「依赖名 @ 字段」；
  在 `host-contract-version.ts` 插一行值导入 → 立刻报红并指名文件

### ★ 内核包依赖树的终态（本 spec 的头号价值，现已机械可校验）

```
dependencies:      @blksails/pi-web-logger, @blksails/pi-web-protocol, zod, @blksails/pi-web-tool-kit
devDependencies:   @types/node, typescript, vitest
peerDependencies:  @earendil-works/pi-coding-agent（optional，源码中仅 1 处 import type）
```

**不出现**：`hono` / `e2b` / `pg` / `@modelcontextprotocol/sdk` / 包注册表客户端 / `ws`。
只要会话引擎的宿主，不再被迫安装云沙箱 SDK 与数据库驱动。

### 6.x 验证留证（实测输出，非「全绿」结论）

连续两次全量运行，逐档计数一致：

| | 文件 | 用例 | 耗时 |
|---|---|---|---|
| core fast | 122（2 skip） | 1141（3 skip） | 2.1 s |
| core fast-mock | 3 | 9 | 1.6 s |
| core it | 48 | 474 | 17.1 s |
| server fast | 71（1 skip） | 729（6 skip） | 3.0 s |
| server fast-mock | 2 | 22 | 0.5 s |
| server it | 36（1 skip） | 185（6 skip） | 130.2 s |
| e2e（不进默认路径） | 3 | 3 | — |
| **合计** | **285** | **2563** | |

每档均核对 `passed + skipped == 总数`。与开工快照（283 / 2547）的差额**逐条可归因**：
文件 +2 = 包依赖守卫 + 符号比对测试；用例 +16 = 4（任务 2.x 守卫自证）+ 4（任务 3.1 注入契约）
+ 6（包依赖守卫）+ 2（符号比对）。

- 四个守卫全绿：依赖方向、分档、包依赖、符号比对；每个的空扫/判别力断言均已实测转红
- 两包 `tsc --noEmit` exit 0；仓库根 `tsc --noEmit` exit 0
- 根 `pnpm test:fast`（两包）**7.5 s**，在 10 s 预算内（R5.5）
- 根 `pnpm test:app` 仅剩 3 个**存量红**（`publish-preview`，已用 `git stash` 在 `6025bb51`
  上复现同样 3 个失败），与本 spec 无关

---

## Validation Notes（kiro validate-impl，2026-07-29）

五路并发验证（构建冒烟 / 需求覆盖 / 设计一致性 / 跨任务集成 / 边界审计）+ 主对话独立核验。
**验证过程本身产出了 4 处修正** —— 记在这里是因为它们都属于「测试全绿也看不出来」的那一类。

### 需求覆盖矩阵（23/23，逐条机械证据）

派出的第五路（需求覆盖）**始终未交付报告**（连续 5 次只报 idle）。其职责面由主对话独立核验补齐；
下表是逐条证据，不是「已覆盖」的断言 —— 声称与证据不匹配正是本 spec 一路在防的东西。

| 条 | 判定 | 机械证据 |
|---|---|---|
| 1.1 | MET | 名册判 neutral/core 的 **32** 个模块全在 core 包；新增守卫 `module-roster.test.ts` 双向断言（搬走 `trust` / 改判 `auth` 均报红） |
| 1.2 | MET | `package-deps.test.ts` 查 `dependencies` **与** `devDependencies`；注入 7 个被禁依赖逐条报「名 @ 字段」 |
| 1.3 | MET | agent SDK 仅 `peerDependencies`；源码侧扫值导入 —— core/src 只剩 1 处 `import type`（`session-store/mirror.ts:14`）；插一行值导入立刻报红指名文件 |
| 1.4 | MET | 同上，判别力自证已实测 |
| 1.5 | MET | `createRequire(server/package.json).resolve` 三态全 OK：裸名→`core/src/index.ts`、深路径→`core/src/session/index.ts`、具名子路径→`core/src/trust/index.ts`，**无任何预构建** |
| 2.1 | MET | `server/package.json` exports **6** 个：`.` `./trust` `./model-options` `./vision-model-options` `./testing` `./host-assembly`，逐个 `test -f` 目标存在 |
| 2.2 | MET | `dump-main-entry-symbols.mjs` 与入库基准 `diff` 为空（**313**）；已固化为常驻测试 |
| 2.3 | MET | `index` 与 `host-assembly` 均在 `packages/server/src/` |
| 2.4 | MET | 313 未增；基线文件自 `b557a102` 入库后未被改动（`git diff b557a102..HEAD -- test/compat/` 只有新增测试） |
| 2.5 | MET | 消费方（`lib/app`）仅装配点补传 4 行，无导入路径改动 |
| 3.1 | MET | `model-catalog/service.ts` 零 `ai-gateway` 值导入（依赖方向守卫 0 违规） |
| 3.2 | MET | `mergeCatalog` 进 **既有** `ModelCatalogServiceDeps`；装配点 `pi-handler.ts:541` |
| 3.3 | MET | 未注入时 `chatOptions()` 返回 `listSelfChat()` **同一引用**（`toBe` 断言，引用级透传） |
| 3.4 | MET | `KNOWN_DEBT.length === 0`（实测）；守卫另有「陈旧条目」反向断言 |
| 4.1 | MET | 守卫扫两包根；实测 **116** 条跨包 specifier 中 **115** 条靠通配解析、unresolved 0 |
| 4.2 | MET | 分档守卫覆盖两包全部 285 个测试文件 |
| 4.3 | MET | `assertEveryRootContributed`；把 server 包根改成不存在路径 → 两守卫均报「该包根扫到 0 个」 |
| 4.4 | MET | 把 `template-name` 改判 assembly → 报出 `sandbox-image(adapters) → template-name(assembly)` 带 `file:line` |
| 5.1 | MET | 连续两次全量逐档计数完全一致；285 文件 / 2564 用例 ≥ 快照 283 / 2547，差额逐条可归因 |
| 5.2 | MET | 两包 + 仓库根 `tsc --noEmit` 均 exit 0 |
| 5.3 | MET | 根 `vitest.config.ts` 数组 alias + 正则 `.js`→`.ts`；根 `test:app` 105/1021 全绿 |
| 5.4 | MET | 本文件与提交信息均给实测输出（含耗时），非「全绿」结论 |
| 5.5 | MET | 根 `pnpm test:fast`（两包）**7.5 s** < 10 s |

### 修正 1 · 一条会主动误导后人的注释

`host-assembly/model-sources.ts` 的文件头写着「必须由 `runner-bootstrap.mjs` 导入」。
实测 `runner-bootstrap.mjs` **根本没有 import 它** —— 真正的装配缝在 `runner.ts` 的 `main()` 里
（`composeModelSources()` 动态 import）。

危险在于这不是无害的过时：kernel-boundary-decoupling 当初正是因为「缝只放 bootstrap 会让**直接跑
runner.ts** 这条入口静默丢掉模型源」才改成现在这样（被 egress 登录闭环用例实测抓到）。
后人照注释把缝挪回 bootstrap 就会复活那个缺陷，而**测试面未必立刻转红**。
已改写并写明「⚠ 改动此处前先读这一段」。

### 修正 2 · 补上 R1.1 缺失的机械判据（新增守卫）

原先**没有任何守卫**断言「名册判 neutral/core 的模块，物理上就在内核包里」。
后续两个提取 spec 要搬 runner 与 adapters，把一个 core 模块带错包在类型层完全可能通过
——源码直连 + 跨包导入使它照样编译、照样跑测试，只是内核悄悄少一块，要到消费方装包才暴露。

新断言的两端来自**两个独立事实源**（名册 = 人写的层归属声明；磁盘 = 实际在哪个包），
故不是重言式。双向判别力已实测：
- 把 `trust` 搬去 server → 报 `trust(core) 不在 core 包`
- 把 `auth` 改判 core → 报 `auth(core) 不在 core 包`

### 修正 3 · design.md 文本滞后于实施（4 处回写）

实施偏离本身已经过用户批准并记在 Implementation Notes，但 design.md 正文仍写着旧数字/旧清单，
而**下游两个 spec 会读它**。已回写并标注「实施后回写」：子路径归属、adapters 7→12、
文件计数、core/server 目录清单。

### 修正 4 · 清理 20 个搬迁残留空目录

### 信息性结论 · 打包器 alias 表里没有 core，**这不是漏了**

`scripts/build-server.mjs` 与 `vite.config.ts` 对 11 个 `@blksails/*` 包有显式 alias，唯独没有 core。
那张表的键是**精确包名/子路径**，而兼容层对内核有 **115 条**不同深路径导入 —— 精确键表达不了。
内核改用 exports 通配由解析器原生展开。三条链路实测均通：
esbuild exit 0 且**产物内 `pi-web-core` 字面量残留为 0**（全部内联）、vite exit 0、
Node `require.resolve` 认这条通配。理由已写进 ALIAS 表注释，防止后人「补全」。

### 运行期存活（此前从未验过 —— 只跑过测试与类型检查）

`pnpm build:server` exit 0（2.9 MB）→ `pnpm build:client` exit 0 → `pack-dist` 自动把新包纳入
（`dist/node_modules/@blksails/pi-web-core` 链接已建，无需白名单）→ 真实起服务：
`pi-web on http://127.0.0.1:3199`，`GET /` 200、`GET /api/sessions` 200（走的是 core 的 session 栈）。

★ 打包器与 `tsc` / `vitest` 是**三套不同的解析器**。通配子路径在前两者下成立，不能从第三者推断。

### 一处此前陈述的更正

那 3 个 `publish-preview` 失败是**偶发**，不是稳定存量红。清掉两条失效 alias 后补跑：
两次全量 + 单文件孤立跑 5 次，全绿。先前两次报红都出现在**全量并发**下，
符合本仓已知的并发饿死特征。当时「已在 6025bb51 上复现」是事实，但据此下的「稳定存量」结论是错的。

### ★ 一个「全绿」掩盖的未执行测试（存量，非本 spec）

app 段汇总行写着 `104 passed | 1 skipped (106)` —— **104+1=105 ≠ 106**；
用例 `1019 passed | 2 skipped` 对 **1031** 总数，**10 个用例根本没跑**。
差集法定位到 `test/chat-app-logs-wiring.test.tsx`，日志里是
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
—— worker 崩了，而 vitest 把它算成「0 failed」。

归属 **UPSTREAM**：孤立跑同样崩；该文件最后改动是 `5a4488b2`(desktop pane 集成)，
`git diff 99d122a3..HEAD` 对它无输出，本次改动未触及。

★ 记在这里是因为**只看「全绿」会漏掉它**。每次报告测试结果都要核对
`passed + skipped == 总数` —— 本仓已经因此被骗过。

### 已知但**不在本 spec 修**的两条（移交下游）

- `runner` 的两处动态 import 装配缝是 **fail-soft**：漏装配时只写一行 stderr / 一条 warn，
  session 镜像与自定义模型源会**静默消失**。缝本身是 kernel-boundary-decoupling 建立的，
  当前两个目标文件都在、缝是通的。移交 `runner-package-extraction`：拆包后 host-assembly
  成为可选模块，那时 fail-soft 的代价会变大。
- `createMcpConfigRoutes` 只靠 TS 必填、无运行期断言。当前生产装配点是 TS，不可达。
