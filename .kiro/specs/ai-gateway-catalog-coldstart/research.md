# Research Log — ai-gateway-catalog-coldstart

发现类型：**Extension**（既有系统扩展，light discovery）。以下每条都经代码/真机核实，
未核实的一律标注为假设。

## 1. 缺陷机理（已在 requirements.md 记录证据，此处只记机理）

推模式单点：`lib/app/ai-gateway-session-assembly.ts` 的 `computeAiGatewaySessionsSpawnEnv`
里 `if (modelIds.length === 0) continue;` —— 目录快照为空即跳过整个实例，spawn env 产出
`{}`；env 在 spawn 时固定，会话存续期间无补发路径。

## 2. 关键接缝核实

### 2.1 ★ `ModelRegistry` 支持事后追加，且会话读取是实时的（设计基石）

| 事实 | 证据 |
| --- | --- |
| `registerProvider(name, config)` 是实例方法，另有 `unregisterProvider` | `pi-coding-agent/dist/core/model-registry.d.ts:97,107` |
| `get_available_models` **每次调用**都读 `session.modelRegistry.getAvailable()` | `pi-coding-agent/dist/modes/rpc/rpc-mode.js:376-378` |

**含义**：会话存续期间对同一 `ModelRegistry` 实例追加 provider，下一次 `getAvailableModels`
即可见。**Requirement 1.2「无需重建会话」在 SDK 层面可满足**，无需 fork/patch pi SDK。
若该行为在未来 pi SDK 版本中改为构造期快照，本设计失效——已列入 Revalidation Triggers。

### 2.2 runner 侧输入本已齐备，与目录就绪无关

`PI_WEB_GATEWAYS`（部署侧实例声明）与各实例的 base/key env 经 `pi-handler` 的
`baseEnv = process.env` → `assemble-spawn.ts` 展开被 runner 子进程继承。`ps -E` 直读运行中
runner 进程实测可见 `BLKSAILS_GATEWAY_BASE_URL` 等。`session-model-source.ts` 的
`declaredGatewayInstanceIdsFromEnv`（spec multi-gateway-providers 任务 3.7 / Req 6.5）已经
把「声明集 ≠ 已解析集」建成事实源，本设计直接复用，不重新定义。

**唯一缺的只有「收敛后的模型 id 清单」。**

### 2.3 ★ 帧通道是双向的，但**runner 发起的关联往返尚无先例**

帧通道（`packages/runner/src/runner/frame-channel/`）是按 `frame.type` 解复用的两层协议，
stdin 侧只挂一个读取器（`frame-router.ts`），上行经 fd1 直写。现存帧：

| 帧 | 方向 | 形态 |
| --- | --- | --- |
| `ui_rpc` → `ui_rpc_response` | 宿主发起，runner 应答 | 关联往返（`pi-session.ts:957` / `:880`） |
| `agent_attachment_catalog` → `piweb_attachment_catalog_result` | 宿主发起，runner 应答 | 关联往返（`pi-session.ts:843` / `:788`） |
| `agent_routes` / `slash_completions` / `runner_ready` | runner → 宿主 | 单向声明 |
| `piweb_state` / `piweb_state_delete` | 宿主 → runner | 单向推送 |

**结论**：两个方向各有先例，但「runner 发起 + 宿主应答」这一组合是新的，需要新建关联
id 机制。这是本设计唯一的新增协议面。

### 2.4 会话就绪时机已有现成信号

`runner_ready` 帧已存在（spec `runner-ready-frame`），可作为 runner 侧「我已就绪、可以
发起请求」的锚点，无需新造就绪判据。

## 3. 方案对比

| | P · 就绪即推（宿主单向） | Q · 反向拉取（runner 发起往返） | A · runner 直接打网关 |
| --- | --- | --- | --- |
| 新增协议面 | 1 条下行帧，无关联 id | 1 对帧 + 关联 id | 0（但需下发两套白名单） |
| 收敛口径 | 单一（宿主算） | 单一（宿主算） | **两套，会漂移** |
| 时序归属 | **宿主要猜「何时推安全」** | **runner 在自己就绪时发起** | runner 自决 |
| 宿主需跟踪未补齐会话 | 是 | 否 | 否 |
| 目录未就绪时的等待落点 | 宿主侧定时/事件重推 | **落在该次应答内，天然不阻塞启动** | runner 自行重试 |
| e2b 沙箱可用 | 是 | 是 | **否（runner 未必可达网关）** |

**A 出局**：`session-model-source.ts` 已明文警告收敛口径两侧漂移的后果是「列表里看得到、
选中却说模型未找到」；且违反 Requirement 5.3（不得产生第二套收敛结果）。

**选 Q**，理由是时序归属：拉模式由**接收方**决定时机，宿主不必猜"什么时候推才安全"；
更关键的是，目录未就绪时的等待可以**落在这一次应答里**——宿主为回复该请求而等待目录首拉
完成，这与「启动期阻塞」无关，Requirement 3.1 仍然成立。P 则要求宿主维护「哪些会话还欠
模型」的状态并在目录就绪后重推，状态多一份、错过窗口的失败模式也多一种。

代价是新增关联 id 机制（2.3）。已接受。

## 4. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| pi SDK 未来把 `getAvailable()` 改为构造期快照 | 列入 Revalidation Triggers；实现处加注释指向 `rpc-mode.js:376` |
| 宿主为应答而等待目录，若上游永不返回则请求悬挂 | 应答路径设超时上限，超时按「目录未就绪」应答，runner 保持既有 fail-soft（Requirement 3.3 / 5.2） |
| 新帧未进 runner 侧校验白名单 | 既有教训（memory `runner-ready-frame-spec`：新增上行帧须进 `runner.it` 的 `validateFrame` 白名单），任务中显式列出 |
| 竞态测试假绿 | Requirement 6 已把「判据须能报红」写成验收；实现时先证伪再采信 |

## 5. 补验结果（原列为假设，均已核实）

### 5.1 宿主侧接缝齐备，且关联机制已存在

`pi-session.ts` 有统一的 `add(type, { schema, handle })` 入站注册接缝。更重要的是
**关联在途请求的机制已经有了**——`pendingClearQueue` / `pendingAgentRoutes` /
`pendingCatalog` 三者都用 `PendingRequests.settle(data.id, …)`，注释写明「未知/迟到 id 由
`PendingRequests.settle` 安全丢弃」。本设计需要的是同一机制的**镜像方向**（runner 侧持有
在途表），不必从零发明。

### 5.2 ★ 冷启时共享 registry 根本不会被创建（本次发现的硬约束）

`packages/runner/src/runner/option-mapper.ts`：

```
const resolved = listModelSources()
  .map((registrar) => ({ registrar, spec: registrar.resolveSpecFromEnv(process.env) }))
  .filter((r) => r.spec !== undefined);
...
if (resolved.length > 0) { /* 构造共享 ModelRegistry */ }
```

网关源的 `resolveSpecFromEnv` 在 `_MODELS` 缺失时返回 `undefined`。于是冷启会话若又没有
登录态 egress 源，`resolved.length === 0` → **`servicesOptions` 完全不被触碰，共享
`ModelRegistry` 从未被构造**。此时即便事后拿到模型清单也无处注册——`session.modelRegistry`
是 SDK 默认实例，不在我们手里。

**含义**：修复的着力点不在"事后补一次注册"，而在**把网关源的解析判据从「有模型清单」
改为「有实例声明 + 凭据」**。声明齐备即解析成功（模型集初始为空），registry 因而必被
构造，后续拉取到清单再补注册。这一条若漏掉，整个反向拉取方案在最关键的冷启路径上无效。

该判据变更同时是 Requirement 5.1 的风险点：必须确保「未声明任何实例」时仍然
`resolved.length === 0`、逐字节维持既有行为。
