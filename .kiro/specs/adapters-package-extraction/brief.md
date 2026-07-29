# Brief: adapters-package-extraction

## Problem

`packages/server` 里约 5k 行属于**外部接线** —— 它们把内核绑到具体的云厂商、数据库、对象存储、
LLM 网关与凭据体系上:

| 模块 | 行数 | 绑定对象 |
|---|---|---|
| `auth/` | 1304 | 桌面凭据 / 登录态 / egress |
| `ai-gateway/` | 765 | Cloudflare AI Gateway 等主对话转发 |
| `identity/` | 537 | 身份端口 P5 的具体实现 |
| `sandbox-image/` | 490 | e2b 镜像烘焙计划 |
| `llm-gateway/` | 466 | dev / 自部署 LLM 网关 |
| `rpc-channel/e2b-transport.ts` + `sandbox-ws-transport.ts` | — | e2b SDK |
| `session-store/postgres-store.ts` | — | `pg` |
| `attachment/s3/` + `attachment/http/` | — | S3 / 远程附件 |
| `extensions/install*` + registry 接线 | — | 包安装 |

它们留在内核包里,意味着任何宿主都要把 `e2b` / `pg` / `@modelcontextprotocol/sdk` 拖进依赖树,
即使它一个都用不上。这也是 core 包「不得出现 e2b / pg / MCP SDK」那条判据的直接来源 ——
判据要成立,这些模块必须有地方去。

## Current State

- `packages/server` 的重外部依赖分布(实测):
  - `e2b` → `rpc-channel/e2b-transport.ts`、`rpc-channel/sandbox-ws-transport.ts`
  - `pg` → `session-store/postgres-store.ts`
  - `jiti` → `runner/agent-loader.ts`(归 runner 包,不在本 spec)
  - `@modelcontextprotocol/sdk` → `config/mcp-probe.ts`
  - `@earendil-works/pi-coding-agent` → 13 文件(9 个在 runner,另有
    `config/model-options.ts`、`auth/egress-model-source.ts`、`session-store/mirror.ts`、
    `vision-settings/vision-model-options.ts`)
- 越界边 `rpc-channel → sandbox-image` 由 `kernel-boundary-decoupling` 先行解除;
  `capability → auth` 是**纯类型**边(`import type`,编译期擦除),切包后跨包 `import type` 合法。
- `packages/server` 现有子路径导出中,`./model-options`、`./vision-model-options`、`./trust`
  三个都是为「引 pi SDK 值的取数闭包不进主 barrel」而设的**有意缺口**。
- `registry-client` 在 `packages/server` 内**零真实 import**(4 处全在 `server/cli`),
  所以 registry 接线的搬迁面比预想小。

## Desired Outcome

- 存在 `@blksails/pi-web-adapters`,收纳上述外部接线;`e2b` / `pg` / `@modelcontextprotocol/sdk`
  从 core 的依赖里彻底消失,core 的守卫判据成立。
- 各 adapter 经 core 的既有端口接入(`RpcTransport` / `SessionStore` / `BlobStore` /
  `CapabilityProvider` / `IdentityProvider` / `InjectedRoute`),不反向依赖 core 的内部实现。
- `@blksails/pi-web-server` 兼容层继续导出全部现有符号与 6 个子路径,消费方零改动。
- 通过面不低于基线(main `6b638622`:server unit 档 267 文件 / 2420 用例;★两次全量运行结果不一致(一次 4 文件红、一次全绿),现状本身不稳定)。

## Approach

在 core 抽出之后进行,与 `runner-package-extraction` **可并行**(两者模块集不相交)。

搬迁按"每个 adapter 对应一个 core 端口"逐个做,每个都能独立复核:

1. 传输类 —— e2b transport / sandbox-ws transport → `RpcTransport` 端口
2. 存储类 —— postgres store → `SessionStore`;s3 / http blob → `BlobStore`
3. 网关类 —— ai-gateway / llm-gateway → `InjectedRoute` 路由工厂
4. 凭据身份类 —— auth / identity → `CapabilityProvider` / `IdentityProvider`(P2 / P5)
5. 镜像与安装类 —— sandbox-image / extensions install

★ 注意 `config/mcp-probe.ts` 这一个:它引 `@modelcontextprotocol/sdk`,但住在 `config/` 下
(内核模块)。它是 core 守卫判据的**最后一个障碍**,且位置容易被漏掉 —— 按目录搬迁会直接跳过它。

## Scope

- **In**:新建 `@blksails/pi-web-adapters` 包;上述模块搬迁;各 adapter 与 core 端口的接入点;
  `config/mcp-probe.ts` 的归属处理;`pi-web-server` 兼容层转发;core 依赖守卫转绿。
- **Out**:adapter 的功能性改写(**只搬不改**);runner 搬迁(并行 spec);
  `server/cli` 的 pi-clouds 接线剥离(后续波次);宿主装配层与 desktop 的改动。

## Boundary Candidates

- 新包骨架与依赖声明(e2b / pg / MCP SDK 归此)
- 五类 adapter 各自的搬迁与端口接入
- `config/mcp-probe.ts` 的归属
- 三个「有意缺口」子路径导出(`./model-options` / `./vision-model-options` / `./trust`)的转发
- 兼容层转发与 core 守卫转绿

## Out of Boundary

- 不改任何 adapter 的功能行为
- 不改宿主契约 v1(已冻结)
- 不动 `server/cli` 的 registry-client 依赖

## Upstream / Downstream

- **Upstream**:`core-package-extraction`(端口须先有物理归宿);
  `kernel-boundary-decoupling`(`rpc-channel → sandbox-image` 先解)。
- **Downstream**:后续波次的 `server/cli` pi-clouds 剥离;未来 edge / 云端宿主可按需只装部分 adapter。

## Existing Spec Touchpoints

- **Extends**:无单一归属 —— 本 spec 横跨多个既有 spec 的产物,给它们一个共同的包边界。
- **Adjacent**:`e2b-sandbox-transport`、`sandbox-baked-agent-image`、`sandbox-credentials-v2`、
  `session-store-adapters`、`attachment-backend-pluggable`、`ai-gateway-providers`(注意:
  该 spec 仍在**老式根级 `specs/` 目录**下,未迁入 `.kiro/specs/`)、`desktop-account-login`、
  `desktop-cloud-login`、`extension-management`。搬动它们的模块时须与各自既有设计对齐。

## Constraints

- core 守卫判据是本 spec 的**验收终点**:`pi-web-core` 的 package.json 不得出现
  `hono` / `e2b` / `pg` / `@modelcontextprotocol/sdk` / `registry-client`,
  `@earendil-works/pi-*` 只能是 peer 且仅 `import type`。
- `attachment` 的切分线由宿主契约 §0.2 钉死:**描述符(JSON)进 Workspace,字节留 `BlobStore`**。
  搬迁不得改这条线。
- 兼容层的 exports 一个都不能丢(该包已发 npm 0.6.1 且被跨仓消费)。
- 只搬不改:逻辑变更须单独标注。
