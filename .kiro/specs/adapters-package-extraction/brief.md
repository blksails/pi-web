# Brief: adapters-package-extraction

> **本文于 2026-07-30 据实测修订**。初稿写于 `core-package-extraction` 与
> `runner-package-extraction` **动工之前**，其**中心论证已被推翻**（详见 §「初稿被推翻的部分」）。
> 修订依据是主对话逐条实测，每条附 `path:line` 或命令输出。

## Problem

`packages/server` 名义上是「兼容层」，实际上 **93% 的代码是外部接线**：名册判 `adapters` 层的
12 个模块共 **57 文件 / 7612 行**，而整个 `packages/server/src` 是 **67 文件 / 8178 行**。

也就是说：**server 本身就是 adapters，外面套了个约 570 行的装配壳**
（`index.ts` 主 barrel + `compat/` + `runner-bootstrap-path.ts` + `host-assembly/`）。

分层目前只由守卫（`packages/core/test/tiering/`）在**逻辑上**维持 —— 物理上它们同住一包。
本 spec 把这条线变成**物理事实**。

## ★ 初稿被推翻的部分（必读，否则会去验一件已经成立的事）

| 初稿断言 | 实测（2026-07-30） |
|---|---|
| 「它们留在**内核包**里，任何宿主都要把 e2b / pg / MCP SDK 拖进依赖树」 | 它们在 `packages/server`，**从不在 core** |
| 本 spec 让「core 的守卫判据成立」 | **已成立** —— core deps 仅 `logger / protocol / zod / tool-kit`，peer 为 optional 的 agent SDK；e2b / pg / MCP SDK / registry-client **全不在** |
| `config/mcp-probe.ts` 是「core 守卫判据的最后一个障碍，按目录搬会直接跳过它」 | **已解决** —— core 只留端口 `config/mcp-probe-port.ts`，实现已是顶层 `mcp-probe.ts`（名册判 adapters） |
| 与 `runner-package-extraction`「可并行」 | runner 提取**已完成**（17/17，GO） |
| 基线 main `6b638622`：267 文件 / 2420 用例，且两次运行不一致 | 现基线 **284 执行文件 / 2601 用例**，连跑两次**逐档一致** |
| 「未来 edge / 云端宿主可按需只装部分 adapter」 | **不成立于兼容层** —— 主 barrel 以 `export *` 静态转发 8 个 adapters 模块，符号在 313 基准内；**无法从可选依赖 `export *`** |
| 五类 adapter 各自对应一个既有 core 端口 | **`IdentityProvider` 端口在 core 中不存在**（core 里只有无关的 `SourceIdentityInput`）。`identity/`（537 行）无对应端口 |
| `ai-gateway` 765 行 / `auth` 1304 行 / `sandbox-image` 490 行 | 1106 / 1388 / 385 行 |
| 相邻 spec `ai-gateway-providers`「仍在老式根级 specs/ 目录」 | 已迁入 `.kiro/specs/`（老式布局已清零） |

## Current State（实测）

### 名册判 adapters 的 12 个模块

| 模块 | 文件 | 行数 | 绑定对象 | 在主 barrel |
|---|---|---|---|---|
| `extensions/` | 17 | 1632 | 包安装 / 注册表 | ✅ `index.ts:30` |
| `auth/` | 9 | 1388 | 桌面凭据 / 登录态 / egress | ✅ `:50` |
| `ai-gateway/` | 6 | 1106 | Cloudflare 等 AI 网关 | ✅ `:58` |
| `sandbox-transport/` | 5 | 1047 | **e2b SDK** | ✅ `:92` |
| `identity/` | 5 | 537 | 身份实现（**无 core 端口**） | ✅ `:86` |
| `llm-gateway/` | 3 | 466 | dev / 自部署 LLM 网关 | ✅ `:54` |
| `sandbox-image/` | 2 | 385 | e2b 镜像烘焙计划 | ❌ |
| `session-store-postgres/` | 3 | 304 | **pg** | ✅ `:93` |
| `tokens/` | 3 | 245 | 分面 scoped token 签发 | ✅ `:46` |
| `attachment-example-tool` | 1 | 207 | 示例工具（值引 agent SDK） | ❌ |
| `mcp-probe.ts` | 1 | 192 | **MCP SDK** | ❌（`index.ts:94` 有注释明说不进） |
| `model-sources/` | 2 | 103 | 取自 agent SDK 的取数闭包 | ❌ |
| **合计** | **57** | **7612** | | **8 / 12** |

### 三个重 npm 依赖的唯一落点（实测 grep）

- `e2b` → `sandbox-transport/{e2b-transport,sandbox-ws-transport}.ts`
- `pg` → `session-store-postgres/postgres-store.ts`
- `@modelcontextprotocol/sdk` → `mcp-probe.ts`（另有 `packages/tool-kit/src/mcp/` 两处，属 tool-kit 自身）
- `registry-client` → `packages/*/src` 内**零 import**（仅 `server/cli` 4 处，本 spec 范围外）

### core 的端口现状

| brief 假定的端口 | 实际 |
|---|---|
| `RpcTransport` | ✅ `packages/core/src/rpc-channel/transport.ts` |
| `SessionStore` | ✅ `packages/core/src/session-store/config.ts` |
| `BlobStore` | ✅ `packages/core/src/attachment/blob-store.ts` |
| `CapabilityProvider` | ✅ `packages/core/src/capability/types.ts` |
| `InjectedRoute` | ✅ `packages/core/src/http/handler.types.ts` |
| `IdentityProvider` | ★ **不存在** |

### 静态引用关系（决定契约能否收窄）

adapters 模块被两处静态引用：
- `index.ts` 主 barrel（8 条 `export *`）—— 符号在 313 基准内
- `host-assembly/{default-capabilities,session-store}.ts`（装配层引真实工厂，按定义合法）

**无任何按需动态 import** —— 即当前形态下 adapters 是无条件加载的。

## ★ 价值主张的重估（与 runner 提取的关键差别）

runner 提取的收益**当场可测**：沙箱镜像里的 runner 不再装 e2b SDK，已由依赖闭包与
`e2e:cli:reloc` 验证。

adapters 提取**不同**：现有消费方用的是兼容层，而兼容层的公开 API 含 adapters 符号，
故切包后它仍须非可选地依赖新包 —— **对现有消费方零依赖收益**。

收益只在两种情形兑现：
1. 未来宿主**绕开兼容层**，直接用 `core` + 选定 adapter 组装（runner 包已是这种形态的先例）；
2. **主入口导出面收窄**，让兼容层不再 `export *` adapters —— 依赖树真正缩小，
   但这是**破坏性契约变更**。

## ★ 两项已决策（2026-07-30，用户拍板）

1. **全口径**：搬全部 12 个模块（57 文件 / 7612 行）。兼容层缩到约 570 行的装配壳。
2. **允许缩减主入口导出面**：把 8 个 adapters 模块的符号从主 barrel 移除，消费方改从新包导入。
   ⚠ 这是**有意的破坏性变更**，代价已知并接受：
   - `@blksails/pi-web-server` 已发 npm **0.6.1** 且被跨仓消费 → 须走 **major 版本**；
   - 313 符号基准**将会变化**。★ 它必须是**有意重新生成并记录理由**的一次变更，
     **不得**表现为「改基准去迁就实现」—— 那是前两轮明确防住的作弊路径。
     新基准生成后即成为新契约，此后仍以「逐字不变」把关。
   - 跨仓消费方（pi-clouds / desktop / 已烘焙镜像）须**登记**为 Revalidation Trigger；
     跨仓改动本身不在本 spec 范围。

## Desired Outcome

- 存在 `@blksails/pi-web-adapters`：12 个模块 + 三个重 npm 依赖（`e2b` / `pg` / MCP SDK）
- `@blksails/pi-web-server` 缩为装配壳；其 `dependencies` **不再含** `e2b` / `pg` / MCP SDK
- 各 adapter 经 core 既有端口接入；`identity/` 的端口缺口须显式处理（见 Constraints）
- 守卫扩展到**第四个包**，且分层的物理归位由断言把关
- 通过面不低于 284 执行文件 / 2601 用例，连跑两次一致

## Approach

守卫先行（同 runner 那轮的教训），再按「每个 adapter 对应一个 core 端口」逐类搬迁：

1. 传输类 —— `sandbox-transport` → `RpcTransport`
2. 存储类 —— `session-store-postgres` → `SessionStore`
3. 网关类 —— `ai-gateway` / `llm-gateway` → `InjectedRoute`
4. 凭据身份类 —— `auth` / `tokens` → `CapabilityProvider`；`identity` **端口缺失，须先决**
5. 镜像与安装类 —— `sandbox-image` / `extensions`
6. 零散 —— `mcp-probe`（端口已在 core）/ `model-sources` / `attachment-example-tool`

## Scope

- **In**：新建 `@blksails/pi-web-adapters`；12 模块搬迁；主入口导出面收窄（含基准重生成与理由记录）；
  守卫扩到四包；兼容层与 `host-assembly` 接线；major 版本号。
- **Out**：adapter 的功能性改写（**只搬不改**）；`server/cli` 的 pi-clouds 接线剥离（后续波次）；
  宿主契约 v1 改动（已冻结）；**跨仓改动**（只登记）；81 个文档同步（另一轮，与 runner 那轮同一笔挂账）。
- **待定（需在 requirements 或 design 决）**：
  ★ `identity/` 无 core 端口 —— 是「按普通模块搬（不引入端口）」还是「补端口」？
  后者属逻辑变更，须单独标注、单独成任务。

## Boundary Candidates

- 新包骨架与依赖声明（e2b / pg / MCP SDK 归此）
- 守卫扩到第四个包（`PACKAGE_ROOTS` / 层→包映射 / 通配集合 / 依赖审计）
- 五类 adapter 各自的搬迁与端口接入
- 主入口导出面收窄 + 313 基准的有意重生成
- `identity/` 的端口缺口
- 兼容层与 `host-assembly` 接线

## Out of Boundary

- 不改任何 adapter 的功能行为
- 不改宿主契约 v1
- 不动 `server/cli` 的 registry-client 依赖
- 不做跨仓改动（只登记）

## Constraints

- ★ **主入口基准的重生成必须是有意声明**：diff 里要能看出「哪些符号被有意移除、为什么」，
  且移除后的基准继续以「逐字不变」把关。前两轮的教训是：**基准变了就是契约破了**，
  除非那正是本次的目标 —— 本轮它确实是目标，故须留下痕迹而非静默对齐。
- ★ **守卫必须先于搬迁扩到四包**。源码直连 + 跨包导入使「搬错包」在类型层完全可能通过；
  上一轮靠 `pendingContributions`（语义为「必须恰好为空」）解决了「守卫先装、包还空」的张力，
  本轮沿用同一机制。
- ★ **运行时路径字符串与重复写死的契约是本仓的惯性失效点**：上一轮 3.3 漏了一处 fixture 路径、
  4.2 漏了第二处 `AGENT_CMD` 断言，两者**类型检查都看不见**。本轮搬迁后须专门搜索。
- ★ **`e2b` / `pg` / MCP SDK 从兼容层依赖里消失，须以依赖闭包机械断言**，
  而非「grep 不到 import 就算」。
- 只搬不改：逻辑变更须单独标注、单独成任务。

## Upstream / Downstream

- **Upstream**：`core-package-extraction`（端口已就位）、`runner-package-extraction`（守卫已三包制、
  `pendingContributions` 与层→包映射机制已建立）、`kernel-boundary-decoupling`。
- **Downstream**：`server/cli` 的 pi-clouds 剥离；未来 edge / 云端宿主可组合 core + 选定 adapter；
  跨仓消费方须按 major 版本适配。

## Existing Spec Touchpoints

- **Extends**：无单一归属 —— 横跨多个既有 spec 的产物，给它们一个共同的包边界。
- **Adjacent**：`e2b-sandbox-transport`、`sandbox-baked-agent-image`、`sandbox-credentials-v2`、
  `session-store-adapters`、`attachment-backend-pluggable`、`ai-gateway-providers`、
  `desktop-account-login`、`desktop-cloud-login`、`extension-management`。
  搬动它们的模块时须与各自既有设计对齐。
