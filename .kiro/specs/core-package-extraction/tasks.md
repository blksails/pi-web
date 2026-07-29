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

- [ ] 5.1 编写 core 主入口
  - 只聚合 core 模块；**不得**包含装配层、runner 实现与 adapters 的任何符号
  - **观察完成**：core 主入口可被加载且不连带拉起 agent 运行时 SDK
  - _Depends: 4.2_
  - _Requirements: 1.1, 1.3_
  - _Boundary: core 主入口_

- [ ] 5.2 兼容层降为转发并逐字比对符号集合
  - 兼容层主入口转发 core + 保留本地装配/adapters 符号；5 个子路径改薄转发，
    装配层子路径不变
  - ★ 逐条核对**刻意不导出**的缺口，不得顺手补全 —— 那些是为挡依赖污染有意为之的
  - 把符号比对固化为**常驻测试**（归 it 档：它要加载真实模块）
  - **观察完成**：符号清单与 1.1 留底逐字相同（diff 为空）；
    人为增删一个符号可使该测试转红
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - _Boundary: 兼容层转发面_

- [ ] 5.3 声明 core 的依赖并加包依赖守卫
  - core 的依赖声明只保留其真实需要者；agent 运行时 SDK 列 peer
  - 守卫查 `dependencies` 与 `devDependencies` 两个字段
    —— 只查前者会漏掉「被误列为 devDependency 的重依赖」
  - **观察完成**：守卫对人为加入的被禁依赖报红并指出依赖名与所在字段；
    真实声明下为绿
  - _Depends: 5.2_
  - _Requirements: 1.2, 1.3, 1.4_
  - _Boundary: core 包声明与依赖守卫_

## 6. 验证

- [ ] 6.1 守卫全绿且覆盖完整
  - **观察完成**：依赖方向守卫、分档守卫、包依赖守卫、符号比对四者全绿；
    每个守卫的空扫断言成立（改坏包根即红）
  - _Depends: 5.3_
  - _Requirements: 1.4, 2.2, 4.1, 4.2, 4.3, 4.4_

- [ ] 6.2 类型检查与快档时延
  - **观察完成**：两个包的类型检查均 exit 0；两包快档合计仍 < 10 秒（报实测耗时）
  - _Depends: 6.1_
  - _Requirements: 5.2, 5.5_

- [ ] 6.3 与开工快照逐项比对并留证
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
