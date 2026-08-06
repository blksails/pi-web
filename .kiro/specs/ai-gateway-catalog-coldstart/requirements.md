# Requirements Document

## Project Description (Input)

### 谁遇到问题

使用 pi-web 且启用了 ai-gateway 套件的部署方与终端用户。dev 与生产同样受影响。

### 现状（已在真机取证，非推断）

会话内的模型清单靠**推模式**下发：装配层 `lib/app/ai-gateway-session-assembly.ts` 的
`computeAiGatewaySessionsSpawnEnv` 读 `GatewayModelCatalog.get()` 的**同步快照**，把
收敛后的模型 id 清单经 spawn env（`PI_WEB_AI_GATEWAY_SESSIONS` +
`PI_WEB_AI_GATEWAY_SESSION_<ID>_BASE/_KEY/_MODELS`）交给 runner 子进程，runner 据此
在 `ModelRegistry` 上 `registerProvider`。

`GatewayModelCatalog.get()` 是 stale-while-revalidate：**从未成功拉取过时快照恒为空集**
（`packages/adapters/src/ai-gateway/model-catalog.ts` 自述 Req 4.4）。而装配层对每个
候选实例有一句 `if (modelIds.length === 0) continue;` —— 快照为空即**整个实例被跳过**，
产出 `{env: {}}`。

于是：**服务端重启后、目录首次拉取完成之前创建的会话，其 runner 里根本没有网关
provider**。env 在 spawn 时就固定，会话存续期间不会补发，刷新页面无效，只能新建会话。

同一时刻**部署级目录端点 `/api/config/models` 却显示一切正常**——它读的是另一条链，
稍后目录热了就有数据。两条链取数不同源，症状表现为「设置页/目录里有，聊天模型下拉里
没有」，极具迷惑性。

实测证据（2026-08-05，本机 dev）：

| 事件 | 时间戳 |
| --- | --- |
| 会话 `d92ceee7` 创建 | `1785912824764` |
| runner 子进程 spawn | `1785912824787` |
| 网关目录**首次**拉取完成 | `1785912826543` |

会话比目录早 1.76 秒。对照结果：

| 会话 | 创建时机 | 会话内模型数 | cloudflare |
| --- | --- | --- | --- |
| `d92ceee7` | 目录未就绪 | 63 | **0** |
| `22281c2c` | 目录已就绪 | 508 | **445** |

`ps -E` 直读两个 runner 进程的实际环境变量证实：前者 `PI_WEB_AI_GATEWAY_SESSION*`
命中 **0 条**，后者齐备（探针有效性已自检：能读到 141 条 env、已知变量均在，故为真阴性）。

该竞态在同一天被**两次**独立触发：一次是用户使用中发现，一次是本次调查复验时
自己撞上（handler 惰性构建 → 目录拉取只在首个 API 请求后启动，而首个请求恰是创建会话，
两者同时开始）。

补充：本行为在 `ai-gateway-session-models/design.md:232` 被写为设计内取舍
（「目录为空（拉取从未成功）→ 装配层产出空 env，不注册」），并非实现疏漏；本 spec 是对
该取舍的**修订**，须在设计中显式记账，而非当作 bug 静默改掉。

### 要改成什么

服务端重启后**任意时刻**创建的会话，其会话内模型清单都应包含已配置的网关 provider；
不再出现「部署级目录有、会话内没有」的分歧。

**已定的两条边界（用户决策，2026-08-05）**：

1. **范围只治 ai-gateway 冷启**。即「目录首次拉取未完成 → 会话 spawn env 缺网关实例」
   这一条。目录**拉取失败 / 上游不可达**的 fail-soft 语义维持现状，不在本 spec 范围内；
   「统一部署级目录与会话内 ModelRegistry 两条取数链」的根治方案同样不在本轮。
2. **不接受阻塞启动**。服务端启动与首个请求不得因等待上游目录而变慢，因此
   「装配期 `await catalog.refresh()`」这类阻塞方案被排除。

**候选方向（用户提出，留待 design 阶段权衡定选型）**：把推模式改为**反向拉取**——
会话先起，模型源在 runner 侧就绪时再取清单，从而把时序解耦。已核实的接缝：

- runner 侧输入本已齐备：`PI_WEB_GATEWAYS`（部署侧实例声明）经 `pi-handler` 的
  `baseEnv = process.env` 被子进程继承，**与目录就绪与否无关**——`session-model-source.ts`
  中「声明集 ≠ 已解析集」（任务 3.7 / Req 6.5）已建立此事实源；base / key 同样在继承的
  env 中（`ps -E` 实测可见）。唯一缺的就是收敛后的模型清单。
- 拉法 A：runner 直接打网关 `/v1/models` 自行收敛。代价是两个白名单需另行下发，且
  **收敛口径会在两侧漂移**——`session-model-source.ts` 已警告漂移后果是「列表里看得到、
  选中却说模型未找到」；e2b 沙箱下 runner 亦未必可达网关。
- 拉法 B：runner 经**既有父子帧通道**向宿主索取收敛后的清单。单一收敛口径不漂移；
  帧通道在 e2b 下同样存在（见 `runner-frame-channel-refactor`）。代价是需新增一对帧。

### 不在范围内

- 目录拉取失败 / 上游不可达时的补偿路径（fail-soft 现状保留）
- 统一 `/api/config/models` 与 `/api/sessions/:id/models` 两条取数链
- 图像（AIGC）侧目录、egress / 自定义 provider 等其他模型源的同类时序问题
- `PI_WEB_GATEWAY_<ID>_MODELS` 白名单本身的语义

## Introduction

pi-web 的会话内可选模型清单与部署级模型目录是两条独立取数链。当部署启用了 ai-gateway
套件时，会话内清单目前依赖「会话创建那一刻网关模型目录是否已就绪」——目录尚未完成首次
拉取时，该会话整个生命周期内都不含网关模型，而部署级目录端点稍后即显示正常。用户看到的
是「设置里有、聊天下拉里没有」，且刷新页面无效、只能新建会话。

本特性消除该时序依赖：无论会话在何时创建，其可选模型清单最终都应包含已配置且凭据齐备的
网关模型；同时不得以拖慢服务端启动或首个请求为代价。

## Boundary Context

- **In scope**: 「网关模型目录首次拉取尚未完成」这一时序窗口内创建的会话，其可选模型
  清单的最终完整性；该窗口内会话创建本身的可用性；成因可诊断性；可主动构造该窗口的回归判据。
- **Out of scope**:
  - 目录拉取**失败**或上游不可达时的补偿路径——既有 fail-soft 语义原样保留，本特性不改变它。
  - 统一部署级模型目录与会话内模型清单这两条取数链（根治方案）。
  - 图像（AIGC）目录、登录态 egress、自定义 provider 等其他模型源的同类时序问题。
  - `PI_WEB_GATEWAY_<ID>_MODELS` 与归属白名单本身的收敛语义。
- **Adjacent expectations**:
  - 本特性依赖「部署侧网关实例声明在会话进程中可见且与目录就绪无关」这一既有事实
    （由 spec `multi-gateway-providers` 建立）；本特性不重新定义实例声明的来源。
  - 本特性修订 spec `ai-gateway-session-models` 已冻结的一条取舍——「目录为空即不注册
    网关模型源」。该修订须显式记账，不得作为缺陷静默改掉。
  - 会话内模型清单的**收敛口径**（归属白名单 + 模型精选白名单）由部署级目录既有规则决定，
    本特性不引入第二套收敛规则。

## Requirements

### Requirement 1: 会话模型清单不受目录就绪时序影响

**Objective:** As a 使用 pi-web 的终端用户, I want 无论何时开始新会话都能选到网关模型,
so that 我不必知道服务端何时重启过、也不必靠反复新建会话来碰运气。

#### Acceptance Criteria

1. When 用户在服务端启动之后、网关模型目录首次拉取完成之前创建会话, the pi-web 会话服务
   shall 使该会话的可选模型清单最终包含全部已配置且凭据齐备的网关实例及其模型。
2. When 网关模型目录在某会话创建之后才首次拉取成功, the pi-web 会话服务 shall 使该会话
   无需重建、无需用户重新载入界面即可选用网关模型。
3. While 网关模型目录尚未完成首次拉取, the pi-web 会话服务 shall 允许会话正常创建并进入
   就绪态，不因等待目录而延后该会话可用。
4. When 用户在同一次服务端运行期内先后创建多个会话, the pi-web 会话服务 shall 使各会话
   最终可选的网关模型集合一致，不因创建先后而不同。

### Requirement 2: 两条清单口径一致且差异可判别

**Objective:** As a 部署方运维人员, I want 会话内清单与部署级目录在网关模型上口径一致,
so that 我能用其中任一处的读数判断配置是否生效，而不必怀疑是哪条链出了问题。

#### Acceptance Criteria

1. While 网关模型目录已完成首次拉取且实例凭据齐备, the pi-web 会话服务 shall 使会话内
   可选模型清单在网关 provider 标识及其模型集合上与部署级模型目录一致。
2. When 会话内清单所含网关模型集合与部署级目录不一致, the pi-web 会话服务 shall 记录
   足以判别成因的诊断信息，而不是静默呈现不一致的两份读数。
3. The pi-web 会话服务 shall 使会话内网关模型的 provider 标识与部署级目录使用同一套标识，
   不产生仅在其中一处出现的别名。

### Requirement 3: 不以阻塞启动为代价

**Objective:** As a 部署方运维人员, I want 服务端启动与首个请求不因上游目录而变慢,
so that 上游网关的可达性与时延不会成为本服务可用性的前置条件。

#### Acceptance Criteria

1. The pi-web 服务端 shall 在启动阶段与处理首个请求时不等待上游网关模型目录返回。
2. When 上游网关目录响应缓慢或超时, the pi-web 服务端 shall 保持会话创建、非网关模型的
   选用与既有各端点的可用性不受影响。
3. If 上游网关模型目录始终不可达, the pi-web 会话服务 shall 使会话仍可创建并可使用本地
   配置的模型。

### Requirement 4: 网关模型缺失时成因可诊断

**Objective:** As a 部署方运维人员, I want 在会话里看不到网关模型时能立刻判断原因,
so that 我不必逐个排除「没配」「凭据错」「收敛成空」「还没拉到」这四种长得一样的表象。

#### Acceptance Criteria

1. When 某个已声明的网关实例未出现在某会话的可选模型清单中, the pi-web 会话服务 shall
   记录可区分「目录尚未就绪」「凭据缺失」「收敛后模型集为空」「实例未声明」这四种成因的
   诊断信息。
2. The pi-web 会话服务 shall 在上述诊断信息中不记录任何凭据内容。
3. When 网关模型在会话创建之后才补齐, the pi-web 会话服务 shall 记录该补齐事件及所涉实例
   标识与模型条数。

### Requirement 5: 零侵入与既有行为保持

**Objective:** As a 未启用网关的部署方, I want 本特性不改变我这边的任何行为,
so that 升级不引入我用不到的风险。

#### Acceptance Criteria

1. Where 未声明任何网关实例, the pi-web 会话服务 shall 保持会话创建流程与可选模型清单
   与本特性实施前一致。
2. If 网关模型目录拉取失败或上游不可达, the pi-web 会话服务 shall 维持既有 fail-soft
   行为，本特性不改变失败情形下的语义。
3. The pi-web 会话服务 shall 保持既有的网关模型收敛口径（归属白名单与模型精选白名单）
   不变，不因本特性产生第二套收敛结果。

### Requirement 6: 回归判据须能在缺陷存在时报红

**Objective:** As a 维护者, I want 这条竞态有一个能主动构造、且缺陷复现即失败的判据,
so that 它不会在未来某次改动中悄悄回归——竞态测试若不能构造窗口，绿了也说明不了问题。

#### Acceptance Criteria

1. The pi-web 测试面 shall 提供可主动构造「网关模型目录尚未就绪」窗口的回归判据，
   不依赖真实时序巧合。
2. When 在该判据下重新引入本缺陷（会话在目录就绪前创建即永久缺失网关模型）, the pi-web
   测试面 shall 失败。
3. The pi-web 测试面 shall 覆盖「目录在会话创建后才就绪」与「目录始终不可达」两种情形，
   并对两者给出不同的期望结果。
