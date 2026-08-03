# Brief: test-tiering-fast-lane

## Problem

`packages/server` 的测试面**分档是按目录做的,而重量不按目录分布**。`run-tests.mjs` 把
`test/integration/**`(9 个文件)拆出去独占串行,注释里详细记了「子进程互相饿死 → 会话就绪
超过 30s 探针 → 随机某个集成文件变红」的根因。但同一形态的重量级测试**还有 25 个散落在
"unit" project 里** —— 它们真实 spawn 子进程,名字甚至已经挂着 `.integration` / `.e2e` /
`.local` 后缀,却跑在 unit 档。

后果有两层:

1. **反馈环被拖垮**。unit 档 267 文件 / 2420 用例跑 **86–116s**;其中
   `runner/canvas-surface.integration.test.ts` 单文件孤立跑就要 **40.8s**,占了近一半。
   开发者改一行纯逻辑代码,也要等一分半才知道有没有踩坏东西。
2. **后缀不可信**。挂 `.integration` 后缀的文件跑在 unit 档,意味着**看名字判断不了它在哪档跑**。
   新加的重测试会继续漂进 fast 档,而没有任何机制拦得住。

即将到来的内核提取波次要连做三次跨包大搬迁,每次都要全量回归。这样的闸门会让迭代成本高到
「不如少跑几次」—— 那正是搬迁事故的温床。

## Current State

- `packages/server/vitest.workspace.ts` 定义 `unit` / `integration` 两个 project,
  `include` 按目录切(`test/integration/**` vs 其余)。
- `packages/server/scripts/run-tests.mjs` 先并行跑 unit,再用 CLI `--no-file-parallelism`
  串行跑 integration。★ 注释明确记载:vitest 2.1.9 **忽略 project 级 `fileParallelism`**,
  串行只能靠 CLI 标志保证。
- 静态扫描 276 个 server 测试文件:**84 重 / 192 纯**(判据 `spawn` / `mkdtemp` / pi SDK)。
- 25 个真实 spawn 子进程的文件在 unit 档(初筛 29 个,4 个经逐条核实为误报 ——
  `ai-gateway/config.test.ts`、`ai-gateway/key-resolver.test.ts`、`runner/option-mapper-mcp.test.ts`
  是注释里出现 "spawn" 字样;`rpc-channel/sandbox-ws-transport.test.ts` 是
  `vi.fn()` 命名为 `spawned` 的 mock)。
- 另有 14 个文件带 `.e2e.test.ts` / `.local*.test.ts` 后缀,同样在 unit 档。
- 根 `package.json` 的 `test` 是 `pnpm -r --workspace-concurrency=1 run test`(全串行跑
  13 个子包),**没有快档入口**。
- 全仓测试文件:packages 388 + 根 `test/` 104 + `e2e/` 110 个文件。
- 现有可复用资产:`packages/server/test/workspace/fixtures/memory-workspace.ts`(内存 Workspace)
  与 `src/workspace/testing/`(框架无关一致性套件)。

## Desired Outcome

- 存在 `pnpm test:fast`,只跑 fast 档,**目标 < 10s**,且开发者可信赖它作为改纯逻辑代码时的默认闸门。
- 分档判据**机械可校验**且由守卫测试强制,新加的重测试无法悄悄漂进 fast 档。
- 文件名后缀与实际所在档**一致**,看名字就知道在哪档跑。
- e2e 档不在默认测试路径上,由手动或 CI 显式触发。
- 全量测试的通过面**不低于基线**:main `6b638622` 上 server unit 档 267 文件 / 2420 用例。
  ★ 该基线**本身不稳定** —— 同一提交连跑两次,一次 4 文件 / 5 用例红、一次全绿;
  integration 相亦有 1 文件因会话就绪超时而红。故「不低于基线」须以**稳定绿**为准。

## Approach

三档,按**依赖判据**而非目录划分:

| 档 | 判据 | 命名 | 目标 |
|---|---|---|---|
| fast | 无子进程、无 pi SDK、无网络、无真实 fs(Workspace 走 memory 实现) | `*.test.ts` | < 10s |
| it | spawn 子进程 / 真实 fs / 真实 agent | `*.it.test.ts` | 独占串行 |
| e2e | playwright / 沙箱 / 真实云 | `e2e/` 目录 + `.e2e` / `.local` 后缀 | 手动或 CI |

配套三件:

1. **守卫测试**:扫 fast 档文件的 import 图,命中 `node:child_process` / `@earendil-works/pi-*` /
   `e2b` / `pg` / `registry-client` 即红。没有这条,分档会在几周内重新腐化 —— 现状就是证据。
2. **25 个错档文件重命名归位**到 it 档,`vitest.workspace.ts` 的 project `include` 改按**后缀**匹配。
3. **`pnpm test:fast` 入口** + e2e 从默认路径摘除。

★ 验收注意:`run-tests.mjs` 的注释里有一条经实测得出的教训 —— **「跑绿了」不足以验证并发/串行
类修复,必须比对耗时证据**。本 spec 的验收同样适用:fast 档必须报出实测耗时,不能只报绿。

## Scope

- **In**:`packages/server` 的测试分档改造(vitest workspace 配置、`run-tests.mjs`、25 个文件重命名);
  守卫测试;根 `package.json` 的 `test:fast` 入口;e2e 从默认测试路径摘除。
- **Out**:其余 12 个子包与根 `test/` 的分档改造(本 spec 只在 `packages/server` 建立范式与守卫,
  推广留后续);测试**内容**的任何改写(只搬不改);e2e 用例本身的增删。

## Boundary Candidates

- 分档判据与守卫(领域无关,可推广到其余子包)
- `packages/server` 的 project 配置与运行脚本
- 25 个错档文件的重命名(纯机械,可独立复核)
- 根 package.json 的测试入口编排

## Out of Boundary

- 不改任何测试断言或产品代码
- 不修 `packages/server` 现存的任何红 —— ★ 基线**不是全绿**(见 Desired Outcome),故不能用「有红就是本次引入」这条简化判据;须与留底的基线输出逐项比对
- 不动 `playwright.config.ts` 的浏览器 e2e 编排

## Upstream / Downstream

- **Upstream**:无。本 spec 是本波次的起点。
- **Downstream**:`kernel-boundary-decoupling` 及其后的三个提取 spec 全部依赖本 spec 提供的
  fast 闸门 —— 没有它,后续每轮搬迁都要等一分半以上。

## Existing Spec Touchpoints

- **Extends**:无(测试分档此前未立过 spec)。
- **Adjacent**:`agent-runner`、`session-engine`、`rpc-channel` —— 它们的测试文件会被重命名,
  但**行为不变**;复核时注意不要把重命名误读为这些 spec 的回归。

## Constraints

- vitest 2.1.9:**project 级 `fileParallelism` 被忽略**,串行必须靠 CLI `--no-file-parallelism`
  (已有实测证据:`--project integration` 是 24.2s 并发,加 CLI 标志才 63.7s 真串行)。
- `pnpm` 把 `test -- <args>` 追加到整条脚本串尾 —— 现有
  `pnpm --filter @blksails/pi-web-server test -- --run <pattern>` 的开发者过滤用法必须继续可用。
- 重命名会改动 25 个文件路径,须用 `git mv` 保留历史。
