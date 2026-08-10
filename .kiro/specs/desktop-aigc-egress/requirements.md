# Requirements Document

## Project Description (Input)

桌面端 AIGC 图像走 blksails ai-gateway：把云端图像出口能力接进桌面登录态。

### 谁有问题

- **桌面版使用者（已登录 pi-cloud 账号）**：对话能用云端模型，但 AIGC 图像工具（文生图 / 图像编辑）与 Canvas 里看不到、也用不了经 blksails ai-gateway 提供的图像模型；对话侧也只能看到云端下发的那几条固定模型，看不到自己那把 key 实际能用的完整目录。想用就只能自己去 `/settings` 手填网关地址与 API key——而那把 `sk-gw-*` 明文落到了本地 `providers.json`，正是桌面登录版当初否掉的架构 A。
- **部署方 / 运维**：桌面包无法把图像能力随账号下发，图像面的接入方式与对话面完全不同源，两套配置各配一遍。

### 现状（2026-08-07 已核实）

**对话面：已通，且是装完即用的默认**

```
桌面登录 → HMAC 桌面凭据 → pi-clouds POST /api/desktop/capabilities
        → egress 授予(baseUrl + models) → runner registerProvider("pi-cloud")
        → pi-clouds /api/desktop/egress/v1 换 sk-gw → blksails ai-gateway
```

云端地址随包固化于 `lib/app/cloud-defaults.ts:38`（`https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1`），只对桌面壳生效（`DESKTOP_MARKER_ENV` 判据），优先级 `env > <agentDir>/cloud.json > 固化值`。

**图像面与目录面不通，两处根因**

1. `packages/core/src/capability/types.ts` 的 `CapabilitySnapshot` 只有 `tenant` / `egress` / `sources` / `publish` 四项，**没有图像出口授予**。`egress` 授予里 `EgressModel.input` 的 `"image"` 是视觉**输入**，不是生图**出口**。
2. AIGC 走网关的图像路由是装配期按 env 条件并入的额外路由组（`RegisterImageToolOptions.extraRoutes` / `AI_GATEWAY_IMAGE_ROUTES`，见 `packages/tool-kit/src/aigc/model-config.ts:40` 与 `packages/tool-kit/src/aigc/extension.ts`），判别项是 `BLKSAILS_GATEWAY_BASE_URL`。桌面壳没有设该 env 的入口，于是这组路由整个不并入；server 侧 `/api/ai-gateway/*` 与网关模型目录聚合同样不挂载（`lib/app/pi-handler.ts:680` `resolveAiGatewayConfig(process.env)`）。

### 已核实的有利条件（决定方案形状）

- **pi-clouds 侧预计无需新端点**：`apps/cloud/app/api/desktop/egress/[...path]/route.ts` 是 catch-all 透传代理，路径无限制，导出 `GET` 与 `POST`，认证走 `requireCurrentUser` 的桌面凭据分支，上游拼 `${gatewayRawBaseUrl()}/<path>`。故 `/v1/images/generations`、`/v1/images/edits`、`/v1/models` 今天即可经同一条**已上线**链路转发并换 sk-gw。
- **目录语义天然正确**：ai-gateway 的 `GET /v1/models` 是**按 key 可见性 + 产品目录**返回（`ai-gateway` 仓 `cmd/gateway/main.go:355`），而 pi-web 的聚合器打的正是 `${baseUrl}/v1/models`（`packages/adapters/src/ai-gateway/model-catalog.ts:251`）。经代理后用户看到的正好是自己那把 sk-gw 能见的目录。
- **加字段不升契约版本**：宿主契约同版本内允许加可选成员（`docs/pi-web-host-contract-v1.md` §1；`packages/core/src/host-contract-version.ts` 注释），加可选授予项不改 `HOST_CONTRACT_VERSION`、不破跨仓兼容。
- **tool-kit 可能零改动**：AIGC 图像路由的 baseUrl / apiKey 是**占位符字符串**（`packages/tool-kit/src/aigc/providers/ai-gateway.ts:47-49`），在 runner 进程内经 var-resolver 展开。若装配层在桌面登录态按授予注入对应 runner spawn env（与已有 `PI_WEB_CLOUD_EGRESS_BASE` / `PI_WEB_DESKTOP_CREDENTIAL` 同套路），tool-kit 侧可不改。
  ⚠ 该注入路径是否可行、以及是否与 e2b / 沙箱既有注入（`computeAiGatewaySessionEnv`）冲突，**须在 design 阶段勘定**，不得当作既定事实。
  ⚠ 另注意目录聚合发生在 **server 主进程**、图像路由展开在 **runner 子进程**，两处取得出口地址与凭据的路径不同，design 须一并处理。

### 用户已拍板的三项决策（2026-08-07）

1. **用户手填的配置优先于云端授予**——与 `cloud-defaults.ts` 已确立的 `env > 用户配置 > 固化默认` 次序一致。
2. **范围包含 chat 模型目录聚合**——不止图像面；桌面登录用户应能看到网关的完整 chat 目录，而非只有云端下发的固定几条。
3. **出口失效时明确报错并提示重新登录**——不静默、不自动回退到其他 provider。

### 边界

- **不**引入把 sk-gw 明文落到本地 `providers.json` 的路径（架构 A 已被否决）；用户经 `/settings` providers 域手填网关的既有能力**保持不变**，作为高级用户逃生门。
- 视频 / 音频模态不在本次交付范围（`multi-gateway-providers` 已把维度留出）。
- 若 design 阶段确认 pi-clouds 侧确需改动，作为**外部契约**在本 spec 中定义，实现按仓分立兄弟 spec。

### 相关既有 spec（上游事实来源）

`desktop-cloud-login`（架构 B 主线）、`desktop-account-login`（随包固化云端地址、capabilities 客户端）、`multi-gateway-providers`（统一目录 / provider 身份 / providers 配置域，33 任务已全部实现）、`ai-gateway-providers`（网关套件、图像路由组、目录聚合）、`host-contract-ports`（capability 端口与契约版本）。

---

## Introduction

本特性把 blksails ai-gateway 的**图像出口**与**模型目录**接进 pi-web 桌面版的登录态，使桌面用户登录账号后无需任何本地配置即可使用网关提供的图像模型与完整 chat 模型目录，且网关数据面凭据（`sk-gw-*`）始终不出云端。

桌面对话面已经通过「桌面凭据 → 云端代理换 sk-gw → 网关」这条链路工作。本特性沿用同一条链路与同一套安全前提（架构 B），把它从「只有对话、只有云端下发的固定模型清单」扩展到「图像生成/编辑 + 按 key 可见性的完整模型目录」，并收口一处会让使用者认错供应商的展示缺陷。

## Boundary Context

- **In scope**：桌面登录态下图像生成与图像编辑经云端出口可用；网关 chat 模型目录在桌面登录态可见并进入模型选择；两套模型清单（云端下发的固定清单与网关目录）的合并与优先级；provider 展示归属正确；用户手填配置与云端授予的优先级；出口失效的可观察行为；非桌面宿主与未登录态的行为不变。
- **Out of scope**：视频 / 音频模态的工具与出口；把网关数据面凭据下发到本地的任何形态；pi-clouds 内部实现（代理、换钥、配额与计费判定）；ai-gateway 自身的模型目录内容与配额策略。
- **Adjacent expectations**：本特性依赖云端出口对任意 OpenAI 兼容路径（至少含图像生成、图像编辑、模型目录三类）的转发与凭据换取，并依赖其在凭据无效时返回可区分的鉴权失败。本特性**不拥有**这些行为；若云端出口不具备，须由 pi-clouds 侧兄弟 spec 补齐，本 spec 只定义对它的期望。

## Requirements

### Requirement 1: 桌面登录态自动获得云端网关接入

**Objective:** As a 桌面版使用者，I want 登录账号后网关的图像与模型目录能力自动可用，so that 我不必手工填写任何网关地址或密钥就能开始用。

#### Acceptance Criteria

1. When 使用者在桌面版完成登录且云端签发了网关接入授予, the 桌面版 shall 使网关提供的图像模型与 chat 模型目录在当次登录后无需重启应用即可用于新建会话。
2. Where 云端未签发网关接入授予, the 桌面版 shall 保持与本特性引入前完全一致的行为，不显示任何网关来源的模型，也不产生错误提示。
3. While 使用者处于未登录状态, the 桌面版 shall 不发起任何面向云端出口的图像或目录请求。
4. The 桌面版 shall 在非桌面宿主形态（npm CLI、开发模式、浏览器访问）下不因本特性改变任何既有行为。
5. If 云端授予加载整体失败（网络故障、凭据被拒、响应不可解析）, then the 桌面版 shall 拒绝进入已登录态并明确告知失败，而不是以「能力未启用」的形态静默放行。

### Requirement 2: 图像生成与编辑经云端出口可用

**Objective:** As a 桌面版使用者，I want 在 AIGC 图像工具与 Canvas 中直接使用网关提供的图像模型，so that 我的生图请求由账号统一承担计费而无需自备密钥。

#### Acceptance Criteria

1. When 使用者在已登录桌面版发起文生图请求且选用网关来源的图像模型, the AIGC 图像工具 shall 经云端出口完成请求并返回生成结果。
2. When 使用者发起图像编辑请求且选用网关来源的图像模型, the AIGC 图像工具 shall 经云端出口完成请求并返回编辑结果。
3. When 使用者在 Canvas 中使用网关来源的图像模型, the Canvas shall 与在对话中使用该模型得到一致的可用性与结果呈现。
4. The 桌面版 shall 在整个图像请求过程中只向云端出口出示桌面凭据本身（凭据保密的完整义务见 Requirement 8）。
5. Where 使用者在设置中禁用了某个图像模型, the AIGC 图像工具 shall 对网关来源的该模型同样生效禁用，与本地来源模型的禁用行为一致。

### Requirement 3: 网关 chat 模型目录在桌面登录态可见

**Objective:** As a 桌面版使用者，I want 看到我的账号实际能用的完整模型目录，so that 我不必只在云端预设的固定几条模型里做选择。

#### Acceptance Criteria

1. When 使用者在已登录桌面版打开模型选择, the 模型目录 shall 列出网关按该账号凭据可见的 chat 模型。
2. When 网关目录与云端下发的固定模型清单出现同一模型, the 模型目录 shall 只呈现一条，不产生重复条目。
3. If 网关目录暂时拉取不到（网络故障或上游异常）, then the 模型目录 shall 继续呈现云端下发的固定模型清单与本地可用模型，并使使用者可据此判断目录不完整，而不是整体报错或清空列表。
4. While 网关目录尚未首次拉取完成, the 模型目录 shall 保持可用并在拉取完成后自行补全，不要求使用者手动刷新。
5. The 模型目录 shall 使使用者能分辨每条模型来自网关还是来自本地配置。

### Requirement 4: 模型清单与实际可用性一致

**Objective:** As a 桌面版使用者，I want 界面上能选的模型就是真能跑的模型，so that 我不会选中一个模型后才发现调用失败。

#### Acceptance Criteria

1. The 模型目录 shall 使可选中的每一条模型在当前登录态下都实际可发起调用。
2. If 某条模型在当前登录态下不可发起调用, then the 模型目录 shall 将其呈现为不可选中并说明原因，而不是允许选中后在调用时才失败。
3. When 使用者的登录态发生变化（登入或登出）, the 模型目录 shall 相应更新可用模型，无需重启应用。
4. The 桌面版 shall 使设置页呈现的 provider 与模型清单，同会话中模型选择器呈现的清单保持一致。

### Requirement 5: provider 身份与展示归属正确

**Objective:** As a 桌面版使用者，I want 界面标注的模型供应商就是实际承接请求的那一个，so that 我不会按错误的供应商经验去理解计费、能力与故障。

#### Acceptance Criteria

1. The 模型目录 shall 使每条网关来源模型标注的供应商归属与实际承接该请求的网关一致。
2. When 部署方将网关指向不同的上游（自建网关或第三方兼容网关）, the 模型目录 shall 相应反映实际归属，而不是固定显示某一个写死的名称。
3. The 桌面版 shall 使同一个供应商标识在对话与图像两处含义一致，不出现同名指向不同供应商的情况。
4. Where 网关目录条目携带上游厂商信息, the 模型目录 shall 将其作为可展示的补充元数据呈现，而不将其当作供应商身份本身。

### Requirement 6: 用户手填配置优先于云端授予

**Objective:** As a 高级使用者，I want 我在设置里填的网关配置不被云端下发的默认值覆盖，so that 我改了保存就一定生效。

#### Acceptance Criteria

1. When 使用者在设置中配置了指向网关的自定义 provider 且云端同时下发了网关接入授予, the 桌面版 shall 以使用者的配置为准。
2. The 桌面版 shall 保持既有的「显式环境配置 > 使用者配置 > 随包固化默认值」优先级次序不变。
3. If 使用者的配置与云端授予冲突而被优先采用, then the 桌面版 shall 使这一取舍对使用者可见，而不是静默生效。
4. The 桌面版 shall 保持使用者经设置手填网关的既有能力可用，本特性不移除该入口。

### Requirement 7: 出口失效的可观察行为

**Objective:** As a 桌面版使用者，I want 云端出口失效时立刻知道原因和该怎么办，so that 我不会对着一个说不清的失败反复重试。

#### Acceptance Criteria

1. If 云端出口因桌面凭据过期或无效而拒绝请求, then the 桌面版 shall 明确告知使用者需要重新登录。
2. If 云端出口因配额或上游异常而拒绝请求, then the 桌面版 shall 明确呈现失败原因，并使其与需要重新登录的情形可区分。
3. The 桌面版 shall 在图像请求失败时不自动改用其他供应商的模型完成该请求。
4. When 出口失效发生在会话进行中, the 桌面版 shall 使该失败在当前会话内可见，而不是仅记录于日志。
5. The 桌面版 shall 使失败提示中不包含任何网关数据面密钥或桌面凭据内容。

### Requirement 8: 凭据保密

**Objective:** As a 部署方，I want 网关数据面密钥永不到达终端用户机器，so that 一台机器被入侵不等于密钥泄露。

#### Acceptance Criteria

1. The 桌面版 shall 不在任何本地文件中存储网关数据面密钥。
2. The 桌面版 shall 使本地持有的凭据仅限于桌面登录凭据本身，且其存储方式与既有登录态一致。
3. The 桌面版 shall 不将桌面凭据或网关数据面密钥写入日志、错误信息、界面呈现或任何面向使用者的响应内容。
4. When 使用者登出, the 桌面版 shall 使网关来源的图像与目录能力随之不可用。

### Requirement 9: 对云端出口的期望（外部契约）

**Objective:** As a pi-web 桌面宿主，I want 云端出口对本特性所需的请求类型有明确且稳定的行为，so that 两侧可以各自独立实现与验证。

#### Acceptance Criteria

1. The 云端出口 shall 接受以桌面凭据认证的图像生成、图像编辑与模型目录三类请求，并转发至网关后回传结果。
2. If 桌面凭据无效或过期, then the 云端出口 shall 返回可与其他失败区分的鉴权失败，且不发起任何上游请求。
3. The 云端出口 shall 不在响应头或响应体中泄露网关数据面密钥。
4. Where 本特性所需行为在云端出口尚不具备, the 桌面版 shall 使受影响的能力呈现为不可用并说明原因，而不以放宽凭据保密约束的方式在本地绕开。
