# Design Document — ai-gateway-catalog-coldstart

## Overview

**Purpose**：消除「会话能否用网关模型」对「会话创建那一刻目录是否已就绪」的时序依赖。

**Users**：启用 ai-gateway 套件的部署方与其终端用户；dev 与生产同受影响。

**Impact**：把会话侧网关模型的取得方式由**装配期推送**（宿主算好塞进 spawn env）改为
**会话侧拉取**（runner 就绪后向宿主索取，宿主按需等待目录首拉后应答）。推送路径保留为
快路径：目录已就绪时行为与今日一致，不产生额外往返。

### Goals

- 冷启窗口内创建的会话最终也能选用网关模型，且**无需重建会话**（Req 1.1/1.2）
- 启动与首个请求不等待上游目录（Req 3.1）
- 会话内清单与部署级目录口径一致、收敛规则唯一（Req 2.1/5.3）
- 四种「看不到网关模型」的成因可判别（Req 4.1）
- 竞态有可主动构造、缺陷复现即报红的判据（Req 6）

### Non-Goals

- 目录拉取**失败** / 上游不可达时的补偿（fail-soft 原样保留）
- 统一部署级目录与会话内 registry 两条取数链
- 图像目录 / egress / 自定义 provider 的同类时序问题

## Boundary Commitments

### This Spec Owns

- 会话侧网关模型源的**解析判据**：由「有模型清单」改为「有实例声明 + 凭据」
- 新增一对帧：runner 发起的网关模型请求 + 宿主应答（本仓首个 runner 发起的关联往返）
- 宿主应答路径内的目录就绪等待与其超时上限
- 上述路径的诊断输出（四种成因判别）

### Out of Boundary

- `GatewayModelCatalog` 的收敛规则（归属白名单 / 模型精选白名单）——原样复用
- 部署级目录端点 `/api/config/models` 的取数与形状
- 部署侧实例声明的来源（`PI_WEB_GATEWAYS` 及存量合成，由 `multi-gateway-providers` 拥有）
- pi SDK 的 `ModelRegistry` 语义

### Allowed Dependencies

- `declaredGatewayInstanceIdsFromEnv`（`multi-gateway-providers` 任务 3.7 已建立的声明事实源）
- 既有帧通道 `packages/runner/src/runner/frame-channel/`（两层协议，按 `frame.type` 解复用）
- 既有 `PendingRequests` 关联语义（宿主侧已有，runner 侧镜像实现）
- `runner_ready` 帧作为 runner 侧发起时机的锚点

**约束**：不得在 runner 侧引入第二套收敛规则；不得让 runner 直接访问上游网关目录。

### Revalidation Triggers

- ★ **pi SDK 若把 `session.modelRegistry.getAvailable()` 由实时读取改为构造期快照** ——
  本设计的「无需重建会话」基石失效（现状证据：`rpc-mode.js:376-378`）
- `ModelRegistry.registerProvider` 的重复注册语义变化
- 帧通道协议层（`frame.type` 解复用、fd1 上行约定）变化
- 部署侧实例声明 env 契约变化
- ★ 本 spec **修订** `ai-gateway-session-models/design.md:232` 冻结的取舍
  「目录为空（拉取从未成功）→ 装配层产出空 env，不注册」。落地后须回该文档加指回本 spec
  的注记，否则后来者读到那张表仍会以为空目录不注册是现行约定。

## Architecture

### 既有架构与必须尊重的边界

```
宿主进程                                    runner 子进程
────────                                    ─────────────
GatewayModelCatalog.get()                   listModelSources()
  stale-while-revalidate                      .resolveSpecFromEnv(process.env)
  首拉未成功 → 空集                            ↓ resolved.length > 0 才构造
       ↓                                     共享 ModelRegistry
computeAiGatewaySessionsSpawnEnv               .registerProvider(...)
  modelIds.length===0 → continue                    ↓
       ↓                                     session.modelRegistry.getAvailable()
  spawn env (BASE/KEY/MODELS)  ───────────→    ← get_available_models 每次实时读
```

**两处不可回避的事实**（均经代码核实，见 `research.md` §2.1、§5.2）：

1. `getAvailable()` 是实时读 → 事后注册可见，无需重建会话。
2. `resolved.length > 0` 才构造共享 registry → **冷启时 registry 压根不存在**，
   「事后补注册」若不先解决这一条就无处落脚。

### 方案选型

三案对比见 `research.md` §3。选 **Q · 反向拉取**，关键理由：

- **时序归属**：拉模式由接收方决定时机，宿主不必猜「何时推才安全」。
- **等待落点**：目录未就绪时的等待落在**这一次应答内**，而非启动期 —— Requirement 3.1
  因此成立。这是拉相对于推的实质优势，不只是风格差异。
- 排除「runner 直接打网关」：会产生第二套收敛口径（违反 Req 5.3），且 e2b 下 runner 未必
  可达网关；`session-model-source.ts` 已明文警告口径漂移的后果是「列表里看得到、选中却说
  模型未找到」。

### 数据流（修复后）

```
                      ┌── 快路径:目录已就绪 ──┐
装配期 ──► 目录快照非空 ──► spawn env 带 MODELS ──► runner 直接注册 ──► 完
   │
   └── 慢路径:目录未就绪
        spawn env 只带 声明 + BASE/KEY(不带 MODELS)
              │
        runner 构造共享 registry,注册 provider(模型集暂空)
              │
        runner_ready 之后 ──► [agent_gateway_models] ──► 宿主
                                                          │
                                        等待目录首拉(带超时上限)
                                                          │
              runner ◄── [piweb_gateway_models_result] ◄──┘
                │
        registerProvider 覆盖为收敛后清单
                │
        下一次 get_available_models 即可见(实时读)
```

## Components and Interfaces

### C1 · 会话侧网关源解析判据变更（修复的着力点）

`packages/adapters/src/ai-gateway/session-model-source.ts`

- `resolveAiGatewaySessionSpecsFromEnv`：某实例在 `BASE` + `KEY` 齐备而 `MODELS`
  缺失/为空时，**仍产出 spec**，其模型集为空并带 `pendingCatalog: true` 标记。
- 保持既有语义：`BASE` 或 `KEY` 缺失 → 该实例不产出（凭据缺失是另一种成因，不可混淆）。
- 未声明任何实例 → 仍返回空数组，`resolved.length === 0`，逐字节维持 Req 5.1。

```ts
export interface AiGatewaySessionSpec {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly string[];
  /** true = 模型集尚未取得,须经拉取补齐;false = 装配期已带全(快路径)。 */
  readonly pendingCatalog: boolean;
}
```

### C2 · 装配层：声明与清单解耦

`lib/app/ai-gateway-session-assembly.ts`

- 移除 `if (modelIds.length === 0) continue;` 的一票否决。
- 凭据齐备即产出该实例的 `SESSIONS` + `BASE` + `KEY`；`MODELS` 仅在快照非空时附带。
- 凭据缺失仍跳过（与 C1 对称）。

### C3 · 新增帧对（本仓首个 runner 发起的关联往返）

| 帧 | 方向 | 载荷 |
| --- | --- | --- |
| `agent_gateway_models` | runner → 宿主 | `{ id, instanceIds: string[] }` |
| `piweb_gateway_models_result` | 宿主 → runner | `{ id, instances: Array<{ instanceId, models: string[] }>, reason?: "ready" \| "timeout" \| "unavailable" }` |

- runner 侧持有在途表（镜像宿主既有 `PendingRequests` 语义：未知/迟到 id 安全丢弃）。
- 帧命名沿用既有前缀约定：runner 发起用 `agent_*`，宿主下行用 `piweb_*`。
- ⚠ 新增上行帧须同时进 runner 侧 `validateFrame` 白名单（既有教训，见
  `runner-ready-frame` spec）。

### C4 · 宿主应答：按需等待目录，超时即如实作答

`packages/core/src/session/pi-session.ts` 注册 `agent_gateway_models` 处理器：

- 目录已就绪 → 立即以收敛后快照应答（`reason: "ready"`）。
- 未就绪 → **await 该实例目录的首次刷新**，带超时上限；超时以空集 + `reason: "timeout"`
  应答，runner 保持 fail-soft（Req 3.3 / 5.2）。
- 该等待发生在**会话请求的应答路径内**，与启动期无关 —— Req 3.1 不受影响。
- 收敛规则完全复用 `GatewayModelCatalog`，不新增第二套（Req 5.3）。

### C5 · runner 侧补注册

`packages/runner/src/runner/` 模型源注册处：

- `pendingCatalog: true` 的实例：先以空模型集 `registerProvider`（保证共享 registry 被
  构造），`runner_ready` 之后发起 C3 请求，拿到清单后再次 `registerProvider` 覆盖。
- 覆盖语义须先验证 `registerProvider` 同名重复调用的行为；若非覆盖，则 `unregisterProvider`
  后重注册（SDK 两个方法都在，见 `model-registry.d.ts:97,107`）。

### C6 · 诊断

四种成因各自可判别（Req 4.1），且不含凭据（Req 4.2）：

| 成因 | 判据 | 记录点 |
| --- | --- | --- |
| 实例未声明 | 不在 `declaredGatewayInstanceIdsFromEnv` | 装配层 |
| 凭据缺失 | 声明了但 `BASE`/`KEY` 缺 | 装配层 |
| 目录尚未就绪 | `pendingCatalog: true` 且应答 `reason: "timeout"` | 宿主应答处 + runner |
| 收敛后为空 | 应答 `reason: "ready"` 但 `models.length === 0` | 宿主应答处 |

补齐事件另记一条（Req 4.3）：实例标识 + 模型条数。

## File Structure Plan

| 文件 | 动作 | 责任 |
| --- | --- | --- |
| `packages/adapters/src/ai-gateway/session-model-source.ts` | 修改 | C1 解析判据 + `pendingCatalog` 字段 |
| `lib/app/ai-gateway-session-assembly.ts` | 修改 | C2 解除一票否决 |
| `packages/protocol/src/...`（网关模型帧 schema） | 新建 | C3 两个帧的 schema 与类型 |
| `packages/core/src/session/pi-session.ts` | 修改 | C4 注册入站处理器 + 应答 |
| `packages/runner/src/runner/gateway-models-wiring.ts` | 新建 | C3 runner 侧在途表 + C5 发起与补注册 |
| `packages/runner/src/runner/option-mapper.ts` | 修改 | C5 空模型集也构造 registry |
| `.kiro/specs/ai-gateway-session-models/design.md` | 修改 | 回加指向本 spec 的取舍修订注记 |

## Testing Strategy

判据由验收条目导出，逐条对应；**每条竞态判据必须先证明能报红再采信**（Req 6.2）。

| 判据 | 覆盖 | 报红方式 |
| --- | --- | --- |
| 解析判据单测：`BASE`+`KEY` 齐备而 `MODELS` 空 → 产出 spec 且 `pendingCatalog: true` | 1.1 / C1 | 还原旧判据即红 |
| 解析判据单测：未声明实例 → 空数组 | 5.1 | —— |
| 装配层单测：目录空快照仍产出 `SESSIONS`/`BASE`/`KEY` | 1.1 / C2 | 还原 `continue` 即红 |
| 装配层单测：凭据缺失仍跳过 | 4.1 | —— |
| 帧对单测：往返 schema、未知/迟到 id 安全丢弃 | C3 | —— |
| 宿主应答单测：目录未就绪 → 等待后以 `ready` 应答 | 1.1 / C4 | —— |
| 宿主应答单测：目录始终不可达 → `timeout` 应答且会话仍可用 | 3.3 / 5.2 / 6.3 | —— |
| **集成:构造「目录未就绪」窗口** → 会话先起，目录后到，`getAvailableModels` 最终含网关模型且**未重建会话** | 1.2 / 6.1 / 6.2 | 还原任一处旧行为即红 |
| 集成：同一运行期内先后两个会话最终集合一致 | 1.4 | —— |
| 集成：会话内清单与 `/api/config/models` 在网关 provider 上一致 | 2.1 | —— |
| 启动不阻塞：上游目录慢/不可达时首个请求耗时不受影响 | 3.1 / 3.2 | 改为启动期 await 即红 |
| 诊断：四种成因各产出可区分记录，且不含凭据 | 4.1 / 4.2 | —— |

真机验证（不可省，本缺陷两次都是真机才暴露）：重启 dev → **不预热**立即建会话 →
`GET /api/sessions/:id/models` 应含 cloudflare；并与 `/api/config/models` 比对一致。

## Requirements Traceability

| 需求 | 承载组件 |
| --- | --- |
| 1.1 / 1.3 | C1 + C2 |
| 1.2 | C5（依赖 `getAvailable()` 实时读，见 Revalidation Triggers） |
| 1.4 | C4 收敛口径唯一 |
| 2.1 / 2.3 | C4 复用 `GatewayModelCatalog` |
| 2.2 | C6 |
| 3.1 / 3.2 | C4 等待落在应答路径内 |
| 3.3 | C4 超时应答 + fail-soft |
| 4.1–4.3 | C6 |
| 5.1 | C1 未声明仍返回空数组 |
| 5.2 | C4 `timeout`/`unavailable` 不改失败语义 |
| 5.3 | C4 不新增收敛规则；排除「runner 直连网关」方案 |
| 6.1–6.3 | Testing Strategy 全表 |
