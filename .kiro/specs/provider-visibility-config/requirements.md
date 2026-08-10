# Requirements Document

## Project Description (Input)

### 谁有问题

使用 pi-web 设置页挑选模型的**使用者**，以及需要控制清单里出现哪些 provider / 模型的**部署方**。

### 现状（2026-08-07 真机勘察）

设置页 `Provider` 面板由两块拼成，中间隔着一道无法跨越的墙：

- 顶部「全部 Provider」是 `packages/ui/src/config/provider-registry-summary.tsx`
  （`multi-gateway-providers` 任务 5.4 / Req 7.1 的产物），**纯只读**。取数自统一目录
  `GET /api/config/models`（按 `output=text` 与 `output=image` 各取一次再合并）。它把
  provider 分三档标注来源：`custom`（本面板新增）/ 云端下发（Req 8 预留、当前不会出现）/
  **内置注册**（其余一切：`self`、网关实例、`cloudflare` 等）。真机上这一档有
  openrouter(262 模型)、apiservices(3)、dashscope(18)、dashscope-token-plan(17)、
  qiniu(27)、newapi(2)、sufy(2)、token-plan(2)。
- 下方「自定义 Provider」是 `providers` 配置域的 `objectList`
  （`packages/protocol/src/config/domains/providers.ts`），字段已含
  `enabled`（缺省 true）/ `models` / `baseUrl` / `apiKey` / `displayName` / 模态。但它
  **只承载使用者自己新增的条目**，与上面那份只读清单不是一回事。
- 唯一的"关掉 provider"手段是部署方环境变量 `PI_WEB_HIDE_PROVIDERS`
  （`packages/core/src/model-catalog/service.ts`，Req 5.1–5.4），语义是**彻底禁用**：
  chat 与 image 两个命名空间一起消失，工具 schema 里也真的没有了。

于是缺口精确地是：**内置注册这一档在界面上没有任何配置面**。它是否出现、带哪些模型，
完全取决于部署方的环境变量。使用者面对一个 262 条模型的 openrouter 无法收敛，
也无法临时让某个 provider 从自己的清单里消失。

### 要改成什么

让「全部 Provider」清单从只读变为可配置，且**不改变 provider 的载入途径**：

1. 清单里的每个 provider（含内置注册档）都能在设置界面开/关，配置持久化，
   不再只能靠环境变量间接影响。
2. 清单完整列出所有已注册 provider，保留来源标识与模型数。
3. 每个 provider 可设置 models 展示清单，决定哪些模型出现在模型目录与选择器中。

### 已决策项（2026-08-07，用户确认）

- **停用语义 = 仅从清单隐藏**：关掉一个 provider 只影响**展示面**，已有会话与工具仍可
  继续使用它。
  ⚠ 用户在知悉冲突的前提下作此选择：`multi-gateway-providers` Req 5 已立下
  「隐藏名单 = 彻底禁用」，本 spec 引入的开关是**另一种语义**，两者将在产品中并存。
  故本文 Requirement 3 专门约束二者的可分辨性。
- **范围 = 只给已注册的 provider 加开关**：env 仍是 provider「载入」的唯一途径。
- **models 展示清单 = 黑名单式**：默认全展示，可勾掉不想要的。

### 基线（勿重复实现）

`multi-gateway-providers` 已实现并落地：统一模型目录端点、自定义 provider 配置域、
隐藏名单=彻底禁用、模态维度与筛选、多网关实例。本 spec 在其之上做增量。

## Introduction

本特性把设置页 Provider 面板顶部那份只读的 provider 清单变成可配置面：使用者可以逐个
开关 provider 在清单中的可见性，并为每个 provider 勾掉不想看到的模型。所有配置只作用于
**展示面**——模型目录列表与各处模型选择器——不改变 provider 的载入途径，也不影响已有会话
与工具的可用性。未做任何配置时，产品行为与升级前逐字节一致。

## Boundary Context

- **In scope**：provider 在清单中的可见性开关；每个 provider 的模型展示清单（黑名单式）；
  配置的持久化与跨会话生效；展示面之间的一致性；两种"关掉"语义的可分辨呈现。
- **Out of scope**：在界面上新增 provider 的载入途径（网关实例仍只能由部署方经环境变量配置）；
  云端下发 provider 配置的真实接入；改动既有环境变量隐藏名单的彻底禁用语义；
  凭据（apiKey/baseUrl）的界面编辑。
- **Adjacent expectations**：本特性依赖既有统一模型目录提供"全部已注册 provider 及其模型
  与来源标识"这一事实来源；它不拥有 provider 的注册与载入，也不拥有工具侧的可用性判定。
  当部署方经环境变量彻底禁用某 provider 时，该 provider 根本不进入本特性的清单，
  因此不存在"对同一 provider 两处配置打架"的情形。

## Requirements

### Requirement 1: 清单完整列出全部已注册 provider

**Objective:** 作为使用者，我希望设置页列出当前部署里全部已注册的 provider 及其模型数量与来源，以便知道自己实际拥有哪些可选项，而不必去翻部署方的环境变量。

#### Acceptance Criteria

1. When 使用者打开 Provider 设置面板, the Provider 设置面板 shall 列出统一模型目录中全部已注册的 provider，每条显示 provider 标识、来源归属与该 provider 当前的模型数量。
2. Where 某个 provider 由使用者在本面板自行新增, the Provider 设置面板 shall 将其标注为自定义来源，与部署方已配好的来源相区分。
3. If 统一模型目录暂时取不到数据, then the Provider 设置面板 shall 呈现可辨识的加载失败状态而非空白清单，且不丢失使用者已保存的配置。
4. While 清单中存在被使用者隐藏的 provider, the Provider 设置面板 shall 仍在本面板内列出该 provider 并标明其为已隐藏，以便使用者能把它改回可见。

### Requirement 2: provider 可见性开关

**Objective:** 作为使用者，我希望逐个开关 provider 在清单中的可见性，以便把用不到的 provider 从模型选择器里收起来，而不必依赖部署方改环境变量。

#### Acceptance Criteria

1. When 使用者在 Provider 设置面板关闭某个 provider 并保存, the 模型目录服务 shall 在此后的模型目录查询结果与各处模型选择器中不再列出该 provider 及其模型。
2. When 使用者重新打开某个此前被关闭的 provider 并保存, the 模型目录服务 shall 在此后的查询结果中恢复列出该 provider 及其模型。
3. The Provider 设置面板 shall 对每个已注册 provider 提供可见性开关，无论该 provider 来自部署方配置还是使用者自定义。
4. While 某个 provider 被使用者隐藏, the 会话服务 shall 保持已有会话中该 provider 模型的可用性不变，且工具调用不因此失败。
5. If 使用者隐藏了当前被设为默认的 provider, then the Provider 设置面板 shall 在保存前明确告知该后果，并要求使用者确认或改选其他默认项。

### Requirement 3: 两种"关掉"语义可分辨

**Objective:** 作为使用者与部署方，我希望能分辨自己面对的是"仅隐藏"还是"彻底禁用"，以便不会误以为关掉了某个 provider 而它实际仍在被工具使用。

#### Acceptance Criteria

1. The Provider 设置面板 shall 在可见性开关处明示其作用范围仅为展示，不影响已有会话与工具的可用性。
2. Where 某个 provider 已被部署方经环境变量彻底禁用, the Provider 设置面板 shall 不在清单中列出该 provider，也不为其提供可见性开关。
3. If 使用者试图理解某个 provider 为何不出现在清单中, then the Provider 设置面板 shall 提供足以区分"被自己隐藏"与"未被部署方启用"两种情形的说明。

### Requirement 4: 每个 provider 的模型展示清单

**Objective:** 作为使用者，我希望为每个 provider 勾掉不想看到的模型，以便面对上百个模型的 provider 时把选择器收敛到自己实际会用的那几个。

#### Acceptance Criteria

1. When 使用者展开某个 provider 的模型展示清单, the Provider 设置面板 shall 列出该 provider 当前目录中的全部模型，并标明每个模型当前是展示还是已勾掉。
2. When 使用者勾掉某个模型并保存, the 模型目录服务 shall 在此后的模型目录查询结果与各处模型选择器中不再列出该模型，而该 provider 的其余模型不受影响。
3. While 某个 provider 从未被配置过模型展示清单, the 模型目录服务 shall 展示该 provider 的全部模型。
4. When 某个 provider 的目录在部署方侧新增了模型, the 模型目录服务 shall 默认展示该新模型，无需使用者再次配置。
5. If 使用者勾掉了某个 provider 的全部模型, then the Provider 设置面板 shall 明确提示该 provider 将不再有可选模型，并要求确认。
6. While 某个 provider 的模型数量较多, the Provider 设置面板 shall 提供按名称筛选模型的手段，使使用者不必在长列表中逐条翻找。
7. While 某个模型已被使用者勾掉, the 会话服务 shall 保持已有会话中该模型的可用性不变。

### Requirement 5: 配置持久化与生效范围

**Objective:** 作为使用者，我希望这些设置保存后长期有效，以便不必每次打开产品重新配置。

#### Acceptance Criteria

1. When 使用者保存 Provider 可见性或模型展示清单, the 配置服务 shall 持久化该配置，使其在产品重启后依然生效。
2. When 使用者保存配置, the 模型目录服务 shall 使新配置对此后新建的会话与新打开的模型选择器立即生效，无需重启产品。
3. If 持久化保存失败, then the Provider 设置面板 shall 明确报错并保留使用者当前的编辑内容，不静默丢弃。
4. The 配置服务 shall 使 provider 可见性与模型展示清单的配置在使用者自定义 provider 与部署方已配 provider 上采用一致的表达方式。

### Requirement 6: 全部展示消费面一致

**Objective:** 作为使用者，我希望产品里每一处选模型的地方都遵守我的配置，以便不会在一处看不见的模型却在另一处冒出来。

#### Acceptance Criteria

1. The 模型目录服务 shall 使 provider 可见性与模型展示清单对全部模型目录查询结果一致生效，无论查询来自哪个界面。
2. When 使用者在任意界面打开模型选择器, the 该界面 shall 只呈现当前配置下可见的 provider 与模型。
3. Where 某个界面按输入或输出类型筛选模型, the 模型目录服务 shall 在筛选之外同时应用可见性配置，二者叠加而非互相覆盖。

### Requirement 7: 存量不失效与零侵入

**Objective:** 作为既有使用者与部署方，我希望升级后一切照旧，以便升级风险可控。

#### Acceptance Criteria

1. While 使用者从未配置过 provider 可见性或模型展示清单, the 模型目录服务 shall 产出与本特性引入前一致的结果。
2. The 本特性 shall 不改变 provider 的载入途径，部署方经环境变量配置 provider 的方式与效果保持不变。
3. When 部署方经环境变量彻底禁用某 provider, the 模型目录服务 shall 维持既有的彻底禁用语义，不因本特性的可见性配置而改变。
4. If 已保存的配置引用了某个已不存在的 provider 或模型, then the 模型目录服务 shall 忽略该条配置继续正常工作，不因此使整份配置失效。
5. The 配置服务 shall 保留既有自定义 provider 条目的全部字段与行为，升级不要求使用者重新配置。
