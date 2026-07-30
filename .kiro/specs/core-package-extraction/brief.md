# Brief: core-package-extraction

## Problem

`packages/server` 是一个 ≈33k 行 / 35 个模块目录的单体包,里面混装着三类性质完全不同的东西:

- **headless 内核** —— 会话引擎、传输抽象、框架无关 HTTP handler、Workspace / Capability /
  ConfigDomain 等宿主契约端口;
- **外部接线** —— e2b、postgres、s3、ai-gateway、llm-gateway、凭据、镜像烘焙、registry 安装(≈5k 行);
- **runner 子进程实现** —— 静态导入完整 pi SDK + jiti(3822 行)。

三者搅在一个包里的直接代价:任何想复用内核的宿主(pi-clouds 云端、desktop、未来的 edge)都得
把 e2b、pg、`@modelcontextprotocol/sdk`、pi SDK 一并拖进去。`src/index.ts` 的 barrel 里那一长串
「本模块无 pi SDK 值导入,可安全 re-export」的逐条论证,正是这个问题的症状 —— 包边界不存在,
只能靠注释和纪律维持。

> ★ **本 brief 已于 2026-07-29 据上游两个 spec 的实测结果修订**（见文末「修订记录」）。
> 修订前的版本把 `host-assembly` 列进了 core 收纳清单，那是**错的**。

## Current State

- 宿主契约 v1 已冻结(`docs/pi-web-host-contract-v1.md`,P1–P5 端口),host-contract 系列
  四个 spec 全部 `phase=implemented`。**抽象就位,物理包边界仍未切开。**
- ★ **上游两个 spec 已完成,交付了本 spec 的两件关键前置**:
  - `test-tiering-fast-lane`(`8a731c24`):fast 档闸门,暖跑 ~6.8s,可作每次搬迁的默认回归。
  - `kernel-boundary-decoupling`(`905e988f`):4 条跨层反向边已解除;
    **`packages/server/test/tiering/module-roster.ts` 现在是 core/runner/adapters 三分的
    权威事实源**,并有依赖方向守卫随快档强制。本 brief 下方的模块清单直接取自它,
    不再手写(手写清单与守卫漂移过一次,代价是把 `host-assembly` 分错了层)。
- `packages/server` 的外部依赖:`e2b` / `pg` / `ws` / `jiti` / `@modelcontextprotocol/sdk` /
  `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` / `zod` + 三个同仓包。
- 实测边界比预期干净:
  - `hono` 全仓**只在 `server/index.ts` 一处** —— `src/http` 已是框架无关的
    `Request/Response` handler + `InjectedRoute` 契约;
  - `registry-client` 只有 4 处真实 import,全在 `server/cli`(`packages/server` 内零渗透);
  - UI 包(`ui` / `react` / `primitives` / `canvas-*`)对 `pi-web-server` **零依赖**。
- 包内跨包 import 计数:`protocol` 128 / `logger` 29 / `agent-kit` 13 / `tool-kit` 7。
- `packages/server` 现有 6 个 exports 子路径:`.` / `./trust` / `./model-options` /
  `./vision-model-options` / `./testing` / `./host-assembly`。
- 该包已发 npm(`@blksails/pi-web-server` 0.6.1),消费方包括 `lib/app`(1161 行 pi-handler)、
  40 个 `examples/`、`e2e/`、`server/cli` 与跨仓。

## Desired Outcome

- 存在 `@blksails/pi-web-core`,内含 headless 内核,其 `package.json` **不出现**
  `hono` / `e2b` / `pg` / `@modelcontextprotocol/sdk` / `registry-client`;
  `@earendil-works/pi-*` 只能是 peer 且仅 `import type`。这条判据机械可校验,由守卫测试强制。
- `@blksails/pi-web-server` 保留为**兼容 re-export 层**:包名与 6 个子路径导出**一个都不少**,
  外部消费方(`lib/app` / `examples` / `e2e` / `server/cli` / 跨仓)**零改动**。
- 全量测试通过面不低于**新快照**:`905e988f` 实测 fast 192 / 1856 · fast-mock 5 / 31 ·
  it 83 / 657 · e2e 3 / 3,合计 **283 文件 / 2547 用例**,且**连续两次运行结果一致**。
  (旧 brief 引用的 main `6b638622` 基线已作废 —— 那份基线本身不稳定,而现在的快照是稳定绿的。)
- **依赖方向守卫持续绿**:搬包过程中它必须一直可运行,并在搬完后仍然绿 ——
  守卫的名册按模块名索引,搬包会改变模块的物理位置,故守卫本身需要跟着适配(见 Scope)。

## Approach

先切 core,把 runner 与 adapters **暂留在 `packages/server`**,由后续两个 spec 分别搬出。

**模块归属以 `module-roster.ts` 为准**(守卫强制,不得与之漂移)。当前名册:

| 层 | 模块 | 归宿 |
|---|---|---|
| neutral(4) | `source-key` `host-contract-version` `template-name` `model-provider-names` | **进 core 包**(纯逻辑,零业务依赖) |
| core(28) | `agent-source` `agent-source-list` `attachment` `attachment-bridge` `builtin-agents` `capability` `commands` `completion` `config` `config-domain` `host-manifest` `http` `logging` `model-catalog` `plugin` `rpc-channel` `sandbox` `session` `session-actions` `session-list` `session-store` `state` `trust` `workspace` `aigc-settings` `vision-settings` `parent-watchdog` `runner-bootstrap-path` | **进 core 包** |
| runner(1) | `runner` | 留 `packages/server`,由 `runner-package-extraction` 搬出 |
| adapters(7) | `ai-gateway` `auth` `identity` `llm-gateway` `sandbox-image` `extensions` `tokens` | 留 `packages/server`,由 `adapters-package-extraction` 搬出 |
| **assembly(2)** | **`index`(主 barrel)、`host-assembly`(默认能力面清单)** | ★ **不进 core 包** —— 见下 |

★ **`host-assembly` 与 `index` 不进 core**。修订前的清单把 `host-assembly` 列进了 core,
那是错的。依赖方向守卫建成当天就揪出来:这两个模块指向 5 个 adapters 模块,若按 core 归类
会报出 11 条「假边」。查证后确认它们是**装配层** —— `host-assembly` 的文件头自述
「本模块 import 真实工厂(含 pi SDK 传递依赖)…**绝不**经主 barrel 导出」,它和主 barrel 一样,
按定义就该同时引用 core 与 adapters。**它们的归宿是兼容层包 `pi-web-server` 本身。**

**runner 契约** 留在 core(`runner/model-source-registrar.ts` 已是纯契约形态);
runner 实现归 `runner-package-extraction`。

兼容层做法:`packages/server/src/index.ts` 与 6 个子路径入口改为纯转发。★ 转发必须逐条核对 ——
barrel 里有多处「此符号刻意**不**从主入口导出」的决定(如 `runner/index.js`、
`egress-model-source`、`vision-model-options` 取数),那些是为挡 bundle 污染有意为之的**缺口**,
转发时若"顺手补全"会把历史上吃过的坑重新打开。

## Scope

- **In**:新建 `@blksails/pi-web-core` 包(package.json / tsconfig / vitest 配置 / exports);
  neutral + core 共 32 个模块的文件移动;`pi-web-server` 降为兼容 re-export 层
  (**保留 assembly 层的 `index` 与 `host-assembly`**);解除继承的 `model-catalog → ai-gateway` 欠债;
  包依赖守卫测试;**依赖方向守卫与分档守卫跨包适配**;
  `tsconfig.base.json` 与根 `vitest.config.ts` 的 alias 同步。
- **Out**:runner 实现搬迁(归 `runner-package-extraction`);adapters 搬迁(归
  `adapters-package-extraction`);宿主装配层(`lib/app`)、`server/cli`、desktop、UI 包的任何改动;
  模块的功能性改写(**只搬不改**)。

## 继承的已知欠债

`kernel-boundary-decoupling` 留下一条 `KNOWN_DEBT`,**owner 指向本 spec**:

- **`model-catalog → ai-gateway`**:`model-catalog/service.ts` 值导入
  `ai-gateway/model-catalog.js` 的 `mergeModelCatalog`。该函数**不是自足纯函数** ——
  它依赖 ai-gateway 的 provider 命名空间与会话可用性判据,故不能简单上移到 core。
  正解是改为经既有的 `ModelCatalogServiceDeps` 注入(注入结构本就存在),
  但那要改 `lib/app` 装配点与 15 处测试调用,超出了上游 spec 的已批准需求范围。
  ★ **本 spec 必须处理它**:否则 core 包会值依赖 adapters,守卫的包级判据无法成立。

## Boundary Candidates

- 新包的骨架与构建配置(package.json / exports / tsconfig / vitest)
- 内核模块的物理移动
- `pi-web-server` 兼容层的转发表面(6 个子路径,逐条核对)
- 包依赖守卫(禁 hono / e2b / pg / MCP SDK / registry-client)
- 全仓 alias 与 paths 同步(`tsconfig.base.json`、根 `vitest.config.ts`)

## Out of Boundary

- 不改任何模块的功能行为
- 不动 `packages/server` 对外可见的 exports 表面
- 不触发宿主契约 v2(契约 v1 已冻结)

## Upstream / Downstream

- **Upstream**:`kernel-boundary-decoupling`(三条越界边须先解,守卫须先绿);
  `test-tiering-fast-lane`(fast 闸门)。
- **Downstream**:`runner-package-extraction` 与 `adapters-package-extraction`(两者都从 core 之上切出,
  可并行);更远期的 `lib/app` 装配层重排与 `server/cli` 的 pi-clouds 剥离。

## Existing Spec Touchpoints

- **Extends**:`host-contract-ports` 系列(P1–P5 端口的物理归宿就是本 spec 建的 core 包)。
- **Adjacent**:`http-api`(框架无关 handler 是它的产物)、`session-engine`、`rpc-channel`、
  `agent-source-resolver`、`attachment-store` —— 它们的模块被搬动但行为不变;
  复核时注意区分「移动」与「改写」。

## Constraints

- `@blksails/pi-web-server` 已发 npm 0.6.1 且被跨仓消费:兼容层的 exports **一个都不能丢**,
  否则跨仓静默不匹配 —— 那正是宿主契约文档反复强调要消灭的失败形态。
- barrel 的「无 pi SDK 值导入」论证不得被破坏:失效形态是把整套 pi SDK 打进路由 bundle。
- 根 `vitest.config.ts` 用显式 alias 解析 `@blksails/pi-web-*` 到源码 `.ts`(**不读 tsconfig paths**),
  新包必须同步加 alias,否则根 `test/` 的 104 个文件会静默解析失败。
- 只搬不改:任何 diff 里出现的逻辑变更都须单独标注并给出理由。**唯一例外**是继承的
  `model-catalog → ai-gateway` 欠债 —— 那一处是有意的逻辑改动(改注入),须单独成任务、单独复核。
- ★ **两个守卫都要跟着搬**:`test/tiering/` 下的分档守卫与依赖方向守卫按**模块名**索引
  `src/` 下的目录。搬包后 core 的模块不在本包里了,守卫要么跟着搬、要么改为跨包扫描。
  **不能让它们静默失效** —— 一个扫不到东西的守卫会一直是绿的,和真的没有违规长得一样
  (上游 spec 已经在哨兵上吃过这个亏两次)。

---

## 修订记录

**2026-07-29**(据 `test-tiering-fast-lane` 与 `kernel-boundary-decoupling` 的实测结果):

1. **`host-assembly` 从 core 收纳清单移除** —— 它与 `index` 是**装配层**,归宿是兼容层包。
   原清单是在只看模块名、没看依赖方向时写的;依赖方向守卫建成当天即揪出(11 条假边)。
2. **模块清单改为直接引用 `module-roster.ts`**,不再手写 —— 手写与守卫漂移过一次。
3. **基线更新**为 `905e988f` 的稳定快照(283 / 2547,连续两次一致),旧的不稳定基线作废。
4. **新增「继承的已知欠债」段**:`model-catalog → ai-gateway` 的 owner 是本 spec。
5. **Scope 补入两个守卫的跨包适配** —— 这是原 brief 完全没有预见的工作量。
6. neutral 层新增两个模块(`template-name`、`model-provider-names`),由上游 spec 归位而来。
