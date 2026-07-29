# Brief: runner-package-extraction

## Problem

runner 是 `packages/server` 里最重的模块(28 文件 / 3822 行),也是**唯一被 barrel 显式排除**的
模块。`src/index.ts` 开头那段注释写得很清楚:runner 在加载时即静态导入完整 pi SDK
(`@earendil-works/pi-coding-agent` / `pi-ai`)与 jiti,一旦经 barrel 进入服务端 bundle,就会触发
"Critical dependency" 告警并把整套 SDK 打进路由。

也就是说:**runner 的重量级已经重到必须靠注释和纪律隔离** —— 它本质上就是另一个包,只是没有
包边界。它跑在 runner 子进程里,由 cwd-无关的 `runner-bootstrap.mjs` 经 jiti 直接加载
`./runner/runner.ts`,App / Handler 从不直接导入它。物理边界和运行边界是重合的,只差一个 package.json。

留在 core 里的代价:任何依赖 core 的宿主都要把 pi SDK 与 jiti 拖进依赖树,即使它只想用会话引擎。

## Current State

- `packages/server/src/runner/` 28 文件 / 3822 行,含 `frame-channel/` 子目录。
- 引 pi SDK 的文件(全包 13 个中 runner 占 9 个):`open-or-create-session.ts` /
  `attachment-wiring.ts` / `agent-definition.ts` / `option-mapper.ts` / `runner.ts` /
  `project-trust.ts` / `agent-loader.ts` / `clear-queue-wiring.ts`,`agent-loader.ts` 另引 jiti。
- runner 的模块依赖:`attachment` / `attachment-bridge` / `auth` ⚠ / `config` / `plugin` /
  `rpc-channel` / `sandbox` / `session-store` / `state`。其中 `→ auth` 那条越界边由
  `kernel-boundary-decoupling` 先行解除(egress 模型源改注入)。
- 引导入口:`packages/server/runner-bootstrap.mjs` + `src/runner-bootstrap-path.ts`
  (后者经主 barrel 导出 `runnerBootstrapPath`)。
- runner 相关测试 38 个文件(server 包内最多的模块),其中多个真实 spawn 子进程,
  由 `test-tiering-fast-lane` 归入 it 档。
- 相关既有成果:`runner-frame-channel`(四入站桥收敛单一父子 IPC 帧通道)、
  `runner-self-resolved-builtins`(内置扩展改 runner 自解析,消除主进程/runner 同文件系统前提)。
  后者尤其重要 —— 它已经把 runner 的自足性推进了一大步。

## Desired Outcome

- 存在 `@blksails/pi-web-runner`,含 runner 子进程实现 + 引导脚本;pi SDK 与 jiti 是它的依赖
  (pi SDK 列 peer),**core 不再有任何 pi SDK 值导入路径**。
- core 只保留 runner **契约**(类型层),宿主经契约装配、经引导脚本 spawn,不直接 import 实现。
- `@blksails/pi-web-server` 兼容层继续导出 `runnerBootstrapPath` 与
  `@blksails/pi-web-server/...` 下既有的 runner 相关子路径,消费方零改动。
- it 档 runner 测试全绿,通过面不低于基线。

## Approach

在 core 抽出之后进行。runner 的运行边界本就独立(子进程 + 引导脚本 + jiti 动态加载),
所以搬迁的难点不在调用链,而在两处:

1. **引导路径解析**。`runnerBootstrapPath` 现在从 `packages/server` 的包内相对位置推算;
   搬包后解析基点变了。★ 这条路径同时要在 dev / dist / standalone / desktop / e2b 沙箱
   五种形态下成立 —— 历史上「nft 拍平 pnpm 链接致传递依赖不可解析」「dist 改压缩载荷后
   `await import(变量)` 经 vite ssrTransform 崩」都是在这类路径解析上翻的车。
2. **peer 依赖声明**。pi SDK 版本由宿主决定,runner 包不能钉死版本。

## Scope

- **In**:新建 `@blksails/pi-web-runner` 包;runner 实现与引导脚本搬迁;core 侧保留契约类型;
  `pi-web-server` 兼容层转发;引导路径在五种运行形态下的解析验证。
- **Out**:runner 的功能性改写(**只搬不改**);adapters 搬迁(并行 spec);
  宿主装配层与 desktop 的改动。

## Boundary Candidates

- 新包骨架与 peer 依赖声明
- runner 实现文件的物理移动
- 引导脚本与 `runnerBootstrapPath` 的解析基点
- core 侧 runner 契约的类型面
- 兼容层转发

## Out of Boundary

- 不改 runner 的帧通道协议(`runner-frame-channel` 的成果)
- 不改内置扩展自解析机制(`runner-self-resolved-builtins` 的成果)
- 不动 pi SDK 版本

## Upstream / Downstream

- **Upstream**:`core-package-extraction`(core 必须先立);
  `kernel-boundary-decoupling`(`runner → auth` 越界边先解)。
- **Downstream**:未来的沙箱/云端宿主可只依赖 runner 包而不拖 core 的 HTTP 层。

## Existing Spec Touchpoints

- **Extends**:`agent-runner`(runner 的原始 spec,本 spec 给它一个独立的包边界)。
- **Adjacent**:`runner-frame-channel`、`runner-self-resolved-builtins`、
  `e2b-sandbox-transport`、`sandbox-baked-agent-image`、`shared-runtime-payload` ——
  后三者都涉及 runner 在非本地形态下的部署与路径解析,搬包不得破坏它们。

## Constraints

- ★ **引导路径解析是本 spec 的最高风险点**。必须在 dev / dist / standalone / desktop /
  e2b 沙箱五种形态下逐一取新鲜证据,不能只跑本地 dev 就宣称通过 —— 这类路径问题的历史失败
  全部是「本地绿、部署态崩」。
- pi SDK 的真实 API 事实源是 `node_modules` 的 `.d.ts`,不是记忆或文档。
- 只搬不改:逻辑变更须单独标注。
- 通过面不低于基线(main `6b638622`:267 文件 / 2420 用例;★基线本身不稳定,见 test-tiering-fast-lane)。
