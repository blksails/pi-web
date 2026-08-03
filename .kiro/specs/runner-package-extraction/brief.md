# Brief: runner-package-extraction

> **本文于 2026-07-29 据实测修订**。初稿写于 `core-package-extraction` 动工**之前**，
> 其核心论证已被该 spec 的实施推翻（详见 §「初稿被推翻的部分」）。修订依据是三路并发勘察
> 与主对话独立核验，逐条附 `path:line`。

## Problem

runner 是 `packages/server` 里最重的模块（28 文件 / 3807 行），也是**唯一被主 barrel 显式排除**
的模块 —— `src/index.ts:3-8` 那段注释解释了原因：runner 加载时即静态导入 pi SDK 与 jiti，
一旦经 barrel 进入服务端 bundle 就会把整套 SDK 打进产物。

**它本质上已经是另一个包，只差一个 package.json**：跑在子进程里，由 cwd-无关的
`runner-bootstrap.mjs` 经 jiti 加载 `./src/runner/runner.ts`，App / Handler 从不直接导入它。
物理边界与运行边界本就重合。

真正的代价在**依赖树**：runner 与 adapters、装配层同住 `packages/server`，于是一个
**只想跑 runner 的宿主被迫装下整包依赖**。`packages/server` 的 dependencies 里，
runner 目录零引用的有四个：`e2b`、`pg`、`ws`、`@modelcontextprotocol/sdk`。

★ 最刺眼的一个：**e2b 沙箱镜像里的 runner 装着 `e2b` SDK** —— 沙箱内部的 runner
根本不需要 e2b 客户端来连接它自己。

## 初稿被推翻的部分（★ 必读，否则会去验一件已经成立的事）

初稿的论证是「runner 留在 core 会拖累 core，任何依赖 core 的宿主都要把 pi SDK 与 jiti
拖进依赖树」，Desired Outcome 之一是「core 不再有任何 pi SDK 值导入路径」。

**这个目标已由 `core-package-extraction` 提前达成**，本 spec 不应再把它当目标：

| 初稿断言 | 实测（2026-07-29） |
|---|---|
| runner 在 core 里，拖累 core | runner 在 `packages/server`，**从不在 core** |
| core 有 pi SDK 值导入路径 | core 的 pi SDK 值导入 **0 处**，只剩 1 处 `import type`（`session-store/mirror.ts:14`）；jiti **0 import** |
| — | core deps 只有 `logger` / `protocol` / `zod` / `tool-kit`；pi SDK 是 optional peer |
| `agent-definition.ts` 在 runner 且引 pi SDK | **已在 core**（`packages/core/src/agent-definition.ts`），全 `import type` |
| runner 依赖 `pi-ai` | **runner 目录零 import `pi-ai`** —— 它只在 `agent-loader.ts:350-362` 作 jiti alias 的**字符串常量**出现 |
| 28 文件 / 3822 行 | 28 文件 / **3807** 行 |
| 基线 main `6b638622`：267 文件 / 2420 用例 | **285 文件 / 2564 用例**（core 提取后，已连跑两次一致） |

## Current State（实测）

- `packages/server/src/runner/` **28 文件 / 3807 行**；唯一子目录 `frame-channel/`（7 文件 / 194 行）。
  最大四文件：`runner.ts` 546、`agent-loader.ts` 489、`option-mapper.ts` 427、`attachment-catalog-wiring.ts` 410。
- **pi SDK 值导入只有 3 个文件**：`runner.ts:15-21`、`option-mapper.ts:17-26`、`open-or-create-session.ts:8`；
  另 5 个文件是 `import type`。**jiti 值导入唯一一处**：`agent-loader.ts:24`（调用点 `:436`）。
- ★ **runner 里没有任何静态 `../` 相对导入**。core 提取的副产品：它对外依赖已全部是包级
  specifier（`@blksails/pi-web-core/…`、`@blksails/pi-web-protocol`、`@blksails/pi-web-logger`、
  `@blksails/pi-web-tool-kit`）。**这使搬迁难度远低于初稿预估**。
- **仅有 2 条 runner → server 上行边**，都是动态 import，已在
  `module-roster.ts:127-130` 登记为运行期组合豁免：
  - `runner.ts:340` → `../host-assembly/session-store.js`（会话镜像 store，转发 `session-store-postgres`，依赖 `pg`）
  - `runner.ts:508` → `../host-assembly/model-sources.js`（登记 egress + ai-gateway 两个模型源）
- **仅有 1 处反向依赖**：`host-assembly/model-sources.ts:32-35` 值导入
  `runner/model-source-registrar.js` 的 `registerModelSource` / `setSharedModelServicesFactory`。
  assembly(3) → runner(2) 正向合法，但搬包后变跨包。
- `runner/index.ts` 是既有公共面（38 行），**仅测试**经 `./runner/index.js` 导入；
  `packages/server/package.json` 的 6 条子路径导出**无一条与 runner 相关**。
- 测试：`test/runner/` **39 文件**（fast 27 / it 12）+ `test/integration/` 9 文件（8 个 `*-subprocess.it.test.ts`）；
  **14 个文件真实 spawn 子进程**。

## ★ 核心难点：`runnerBootstrapPath` 三难

三个约束**不能同时成立**，这是本 spec 必须正面解决的，不是搬文件能绕过的：

1. **它在 313 符号基准里**（`main-entry-symbols.txt:298`，`index.ts:31`）→ 必须继续从 server 主入口导出，
   否则破 `core-package-extraction` 立下的 R2.2。
2. **它必须与 `runner-bootstrap.mjs` 同包** —— 上个 spec **实测**过：该函数一度被搬进 core，
   算出的包根随之变成 `packages/core`，主路径指向不存在的文件，**而 cwd 回退在开发态恰好命中，
   测试全绿、真机照跑**，只会在换机/打包后现形。结论已写在 `runner-bootstrap-path.ts` 文件头。
3. **`runner-bootstrap.mjs` 该随 runner 走** —— 它 `:35` 硬编码
   `join(serverPkgDir, "src", "runner", "runner.ts")`；更根本的是它的**职责**就是把 jiti 解析根
   锚定在拥有 pi SDK 的包目录（`createJiti(here)`，见其文件头）。搬 runner 后那个包就是 runner 包。

**解法候选（留给 design 定夺，此处只记方向）**：bootstrap 随 runner 走；
`runnerBootstrapPath()` 留在 server，但把「向本包根推算」改成**向 runner 包解析**
（`require.resolve("@blksails/pi-web-runner/runner-bootstrap.mjs")`）。三个约束同时满足，
且不再依赖相对布局。

⚠ **但这个候选必须先过一关**（实测发现，见下节）：生产形态下真正生效的**不是**主路径，
而是 `:49` 那个硬编码字符串回退。换成 `require.resolve` 等于**改变了生产形态的解析机制**，
不是"更健壮的同一条路" —— 必须在 dist 树里实证 `dist/node_modules/@blksails/pi-web-runner`
链接确实由 `pack-dist` 建出且可解析。

### ★ 还有第二条「必须同包」耦合（初稿与首轮修订都漏了）

`runner/builtin-extensions.ts:12-15` 明写：runner 的模块解析根 = 包目录（`createJiti(here)`）。
runner 搬包后解析根变成新包，于是 **`@blksails/pi-web-tool-kit` 必须同为新包的运行时依赖**，
否则三个内置扩展（extension-tools / auto-title / mcp）在沙箱与 standalone 下**静默不可用**
—— `resolve()` 返回 undefined 即跳过，**不报错**。
★ 该失效模式**历史上已发生过一次**（见该文件头 `:5-11`）。

## ★ 五种运行形态的实测画像（决定验证策略）

| 形态 | bootstrap.mjs 实际位置 | 走哪条路径 | 谁放过去 |
|---|---|---|---|
| dev | `packages/server/runner-bootstrap.mjs`（源码树） | **主路径与 cwd 回退恒等命中** | 无人拷贝 |
| dist | `dist/packages/server/runner-bootstrap.mjs` | **cwd 回退** | `pack-dist.mjs:348-349`（按包遍历 + `existsSync`，不写死包名） |
| standalone | 同 dist 树 | **cwd 回退** | `bin/pi-web.mjs:533-537` 以 `cwd: dirname(serverJs)` spawn |
| desktop | `~/.pi/web/runtime/<ver>-<digest12>/dist/...` | **cwd 回退** | Tauri `unpack_runtime` 解 `payload/dist.tar.zst` |
| e2b（烘焙） | `/usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs` | **完全不调用 `runnerBootstrapPath()`** | 跨仓 `Dockerfile.pi:96` 的 `npm i -g`，路径经 `bake-plan.ts:179` 常量烘进 `AGENT_CMD` |

三条由此推出的硬结论：

1. ★ **dev 态两条路径恒等命中 → 主路径断裂在 dev 与单测里不可观测。**
   「搬包后 dev 跑通 + 测试全绿」**不构成任何证据** —— 这正是上个 spec 骗过一轮的同一机制。
2. ★ **生产形态（dist/standalone/desktop）真正生效的是 `:49` 的硬编码字符串**，
   而它**不做 `existsSync` 就返回**，断裂延后到 spawn 才 ENOENT，错误现场离根因很远。
   证据：esbuild 不内联 `import.meta.url`（`dist/server.mjs:20460` 里它是活的），
   求值为 `<abs>/dist/server.mjs` → `dirname×2` = dist 的**父目录** → 主路径必不存在。
3. ★ **`pnpm e2e:cli:reloc` 是唯一能抓到「bootstrap 随 runner 搬走后 dist 断裂」的测试**
   （`e2e/cli/cli-reloc.mjs:6-11` 藏起构建目录复现换机）。它必须进本 spec 的验收。

## Desired Outcome

- 存在 `@blksails/pi-web-runner`：runner 实现 + 引导脚本；依赖 `@earendil-works/pi-coding-agent`（peer）
  + `jiti` + core/protocol/logger/tool-kit。**不含** `e2b` / `pg` / `ws` / MCP SDK。
- `@blksails/pi-web-server` 主入口的 **313 个符号逐字不变**（含 `runnerBootstrapPath`）。
- 引导路径在 **dev / dist / standalone / desktop / e2b 沙箱**五种形态下均可解析，各有新鲜证据。
- 通过面不低于 285 文件 / 2564 用例，且连续两次运行一致。

## Approach

runner 的运行边界本就独立，难点不在调用链而在三处：

1. **引导路径解析**（见上）—— 本 spec 最高风险点。
2. **peer 依赖声明**：pi SDK 版本由宿主决定，runner 包不能钉死。
3. **`model-source-registrar` 的归属**：它是**契约 + 进程内可变注册表**，文件头（`:9-16`）
   写明「契约由 runner 层定义，具体实现住 adapters 并自注册」。随 runner 走，
   则 `host-assembly` 对它的值导入变成跨包 —— 方向仍合法（assembly → runner）。

## Scope

- **In**：新建 `@blksails/pi-web-runner`；runner 实现与引导脚本搬迁；`runnerBootstrapPath` 改为跨包解析；
  兼容层转发；**五种运行形态的路径解析验证**；测试搬迁。
- **Out**：runner 的功能性改写（**只搬不改**）；adapters 搬迁（并行 spec）；
  宿主装配层与 desktop 的**结构性**改动；pi SDK 版本变更。
- **待定（需决策）**：
  - **81 个文档文件**写死了 `packages/server/runner-bootstrap` 或 `packages/server/src/runner`
    （含 27 章产品手册）。搬包后不会断，但会变成错文档。体量足以独立成一轮。
  - ★ **跨仓改动**：e2b 烘焙态的路径在 `../pi-clouds/demo/cloud-e2e/Dockerfile.pi:96/106/110`
    （及 `.cn` 版），**pi-web 内任何测试都够不到**。且该路径来自**已发布的 npm 包** ——
    即使 pi-web 全绿，也要等基础镜像重烘焙才现形（同既有教训「代码合 main + npm 已发 ≠ 真机可用」）。
    本 spec 是否负责跨仓同步需拍板。

## Boundary Candidates

- 新包骨架与 peer 依赖声明
- runner 实现文件的物理移动（28 文件）
- 引导脚本与 `runnerBootstrapPath` 的解析基点
- `model-source-registrar` 的归属与跨包注册
- 兼容层转发面（313 符号不变）
- 测试搬迁（39 + 9 文件，14 个真实 spawn）

## Out of Boundary

- 不改帧通道协议（`runner-frame-channel` 的成果）
- 不改内置扩展自解析机制（`runner-self-resolved-builtins` 的成果）
- 不动 pi SDK 版本
- 不并入主 barrel：`runner/index.ts` 的符号**不在** 313 里，搬走不影响基准；
  但**不得"顺手补进"**主 barrel（同 `index.ts:94-96` 就 mcp-probe 记下的禁令）

## Constraints

- ★ **引导路径解析必须在五种形态下逐一取新鲜证据**，且**dev 与单测的绿不算证据**（见上表结论 1）。
  最低验收：`pnpm e2e:cli:reloc`（换机复现）+ dist 树实证 + 沙箱镜像重烘焙后的真机验证。
- ★ **`:49` 的回退不做 `existsSync`**。若沿用该形态，须考虑补上存在性检查 ——
  否则错误面依旧延后到 spawn。（属逻辑改动，须单独标注。）
- ★ **另有 5 处硬编码点会随搬迁失效**，逐一登记：
  `runner-bootstrap-path.ts:49`、`runner-bootstrap.mjs:34`、`sandbox-image/bake-plan.ts:179`
  （文件头自称「挪动即 Revalidation Trigger」）、`e2e/cli/cli-smoke.mjs:57`（产物完整性清单）、
  `packages/server/package.json:51` 的 `files`（决定 npm 包带不带它，是 e2b 全链的源头）。
- ★ **`lib/app/pi-handler.ts:453` 用 `dirname(runnerBootstrapPath())` 当 stub 子进程 cwd**，
  而**绝大多数 e2e 跑在 stub 模式下** —— bootstrap 换包会连带改这个 cwd。
- ★ **`RUNNER_` 前缀是命名陷阱**：`RUNNER_AI_GATEWAY_BASE_ENV` / `_KEY_ENV` / `_MODELS_ENV`
  （基准 `:85-87`）名字带 `RUNNER_`，但源在 `ai-gateway/session-model-source.ts:26`，属 **adapters**。
  按名字随包搬走 → 主入口少 3 符号，破 313。
- ★ **分档后缀必须保住**：fast 档把 `node:child_process` 别名到守卫模块（导入不报错、**调用才报错**）。
  14 个真实 spawn 的测试若在搬迁中丢了 `.it.test.ts` 后缀，会在调用点炸。
- **跨包测试 fixture**：`test/integration/agent-routes-subprocess.it.test.ts:29` 已引用
  `../../../core/test/session/fixtures.js`。搬迁会再增此类跨包相对路径。
- pi SDK 的真实 API 事实源是 `node_modules` 的 `.d.ts`，不是记忆或文档。
- 只搬不改：逻辑变更须单独标注、单独成任务（同 `core-package-extraction` 对欠债解除的处理）。

## Upstream / Downstream

- **Upstream**：`core-package-extraction`（已完成 13/13）；`kernel-boundary-decoupling`
  （`runner → auth` 越界边已由 `model-source-registrar` 解除）。
- **Downstream**：沙箱/云端宿主可只依赖 runner 包，不拖 `e2b` / `pg` / `ws` / MCP SDK；
  `adapters-package-extraction`（可并行）。

## Existing Spec Touchpoints

- **Extends**：`agent-runner`（runner 的原始 spec，本 spec 给它独立包边界）。
- **Adjacent**：`runner-frame-channel`、`runner-self-resolved-builtins`、`e2b-sandbox-transport`、
  `sandbox-baked-agent-image`、`shared-runtime-payload` —— 后三者都涉及 runner 在非本地形态下的
  部署与路径解析，搬包不得破坏它们。
