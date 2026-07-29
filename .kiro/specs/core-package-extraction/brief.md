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

## Current State

- 宿主契约 v1 已冻结(`docs/pi-web-host-contract-v1.md`,P1–P5 端口),host-contract 系列
  四个 spec 全部 `phase=implemented`。**抽象就位,物理包边界仍未切开。**
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
- 全量测试通过面不低于基线(main `6b638622`:server unit 档 267 文件 / 2420 用例;★两次全量运行结果不一致(一次 4 文件红、一次全绿),现状本身不稳定)。

## Approach

先切 core,把 runner 与 adapters **暂留在 `packages/server`**,由后续两个 spec 分别搬出。

core 收纳:`session/` · `rpc-channel/`(仅抽象,e2b 实现留后)· `http/`(框架无关 handler)·
`workspace/` · `capability/` · `config-domain/` · `host-manifest/` · `host-contract-version.ts` ·
`session-store/`(接口与内存实现)· `attachment/` L0–L1 接口 · `completion/` · `commands/` ·
`agent-source/` · `host-assembly/` · runner **契约**(实现归 `runner-package-extraction`)。

兼容层做法:`packages/server/src/index.ts` 与 6 个子路径入口改为纯转发。★ 转发必须逐条核对 ——
barrel 里有多处「此符号刻意**不**从主入口导出」的决定(如 `runner/index.js`、
`egress-model-source`、`vision-model-options` 取数),那些是为挡 bundle 污染有意为之的**缺口**,
转发时若"顺手补全"会把历史上吃过的坑重新打开。

## Scope

- **In**:新建 `@blksails/pi-web-core` 包(package.json / tsconfig / vitest 配置 / exports);
  内核模块的文件移动;`pi-web-server` 改为兼容 re-export 层;包依赖守卫测试;
  `tsconfig.base.json` 与根 `vitest.config.ts` 的 alias 同步。
- **Out**:runner 实现搬迁(归 `runner-package-extraction`);adapters 搬迁(归
  `adapters-package-extraction`);宿主装配层(`lib/app`)、`server/cli`、desktop、UI 包的任何改动;
  模块的功能性改写(**只搬不改**)。

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
- 只搬不改:任何 diff 里出现的逻辑变更都须单独标注并给出理由。
