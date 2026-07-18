# Requirements Document

## Project Description (Input)
模型目录统一(model-catalog):修复 ai-gateway 启用后模型清单的五个缺陷中的 D1/D2/D4/D5 并收敛目录服务(P0+P1)。P0 止血:mergeModelCatalog 同名判定从裸 id 改为 provider/id(根治 self provider 被网关同 id 条目吞并);网关条目 provider 恒为 "ai-gateway",owned_by 降级为 meta.channel 展示元数据;默认 Provider 下拉只枚举 session 可用(self)provider,网关模型渲染徽章+未接入会话 disabled 态;GET /api/aigc/models 按 AI_GATEWAY_BASE_URL 条件并入网关三条图像路由。P1 收敛:抽 ModelCatalogService,chat/image 双命名空间统一数据模型,三模型端点统一取数与过滤。约束:未启用 ai-gateway 时输出与今天逐字节一致;响应形状只增不改;tool-kit 双入口纪律。P2(agent 经 models.json 注入使网关模型 session 可用)刻意不在本 spec 范围。权威设计参考:docs/model-catalog-design.md。

## Introduction

启用 ai-gateway 套件后,pi-web 的模型清单出现四类用户/运维可观察的缺陷(2026-07-18 实测复现,证据见 docs/model-catalog-design.md §1):自配 provider 的模型被网关同名条目整体吞并、网关内部渠道名冒充 provider 流入默认 Provider 下拉、设置页可选到会话实际用不了的网关模型、AIGC 图像模型开关清单漏掉运行时真实可跑的网关图像路由。本 spec 修复上述缺陷并统一各模型清单的取数口径,交付后:自配目录永不因网关聚合而缺失;网关模型统一归属单一「ai-gateway」分组且不可被误设为会话默认;图像模型开关清单与运行时路由集恒同源一致。

## Boundary Context

- **In scope**:对话(chat)模型清单聚合的正确性与归属语义;设置页默认 Provider/Model 的可选性约束;AIGC 图像(image)模型开关清单与运行时路由集的同源一致;模型清单响应的向后兼容扩展(来源/可用性标记)。
- **Out of scope**:让网关对话模型在会话内真正可跑(agent 侧接线,P2 独立 spec);网关侧 `/v1/models` 的能力标记扩展(跨仓);视觉识别模型清单(`image_vision` 弹层)的并入;计费/配额联动;ai-gateway 套件既有的转发路由、token 签发、目录 TTL/fail-soft 机制(全部沿用不动)。
- **Adjacent expectations**:依赖 ai-gateway-providers spec 已交付的网关目录拉取(TTL + fail-soft)与 `AI_GATEWAY_BASE_URL` 启用判别;依赖 aigc-tool-settings spec 已交付的图像模型禁用机制(`<agentDir>/aigc.json`,下一次会话/重载生效);不改变二者的对外契约。

## Requirements

### Requirement 1:聚合目录完整性(自配模型永不丢失)
**Objective:** 作为部署运维,我希望启用网关目录聚合后自配 provider 的模型一个不少地保留,以便用户始终能选到 agent 真正可用的模型。

#### Acceptance Criteria
1. While ai-gateway 套件已启用, when 前端请求对话模型选项清单, the pi-web 服务端 shall 返回全部自配可用模型条目,其集合与未启用聚合时完全一致(不因网关目录聚合而丢失任何条目或 provider)。
2. When 网关目录与自配目录存在相同模型 id, the pi-web 服务端 shall 同时保留两个条目并以各自归属分组区分,不做跨归属的覆盖删除。
3. While ai-gateway 套件未启用, the pi-web 服务端 shall 返回与启用本特性前逐字节一致的对话模型选项响应。
4. If 网关目录拉取失败或从未成功, the pi-web 服务端 shall 照常返回完整自配目录,不阻断、不向前端报错(沿用既有 fail-soft 语义)。

### Requirement 2:网关模型归属与展示语义
**Objective:** 作为终端用户,我希望网关目录模型统一归属到一个清晰的「ai-gateway」分组,以便与自配 provider 不混淆。

#### Acceptance Criteria
1. When 对话模型清单包含网关目录条目, the pi-web 服务端 shall 将其 provider 统一标为 `ai-gateway` 单一分组。
2. The pi-web 服务端 shall 不把网关内部上游渠道名(如 `openai-compat`、`dashscope-token-plan`)作为 provider 暴露在 providers 列表中。
3. When 网关条目携带上游渠道信息, the pi-web 服务端 shall 以附加元数据字段下发(仅供界面二级分组展示),既有响应字段的形状与语义不变。
4. When 设置界面展示网关目录模型, the 设置界面 shall 渲染来源徽章区分网关目录与自配目录(沿用既有徽章机制)。

### Requirement 3:默认 Provider/Model 选择约束(可选即可用)
**Objective:** 作为终端用户,我希望默认 Provider/Model 下拉只让我选会话真正可用的项,以便不会把会话默认配置写坏。

#### Acceptance Criteria
1. When 用户打开「默认 Provider」下拉, the 设置界面 shall 仅枚举会话可用(自配来源)的 provider,不出现 `ai-gateway` 分组或网关内部渠道名。
2. When 用户打开「默认模型」下拉且网关目录已聚合, the 设置界面 shall 将网关目录模型渲染为不可选中状态并附「未接入会话」提示。
3. If 配置中已存在会话不可用的 defaultProvider/defaultModel 存量值, the 设置界面 shall 原样显示该值且不崩溃,允许用户改选有效项。
4. The 会话内模型选择器 shall 仅列出 agent 会话实际可用的模型(本 spec 不把网关目录并入会话选择器;该打通属 P2 范围)。

### Requirement 4:AIGC 图像模型开关清单与运行时同源一致
**Objective:** 作为部署运维,我希望设置页的图像模型开关清单与运行时图像工具实际注册的路由集永远一致,以便任何可跑的模型都能被看到并可被禁用。

#### Acceptance Criteria
1. While ai-gateway 套件已启用, when 用户打开设置页「AIGC 图像」模型开关, the 设置界面 shall 列出网关图像模型条目,且与运行时图像工具实际注册的网关图像路由一一对应。
2. When 用户在设置页禁用某网关图像模型并保存, the 图像工具 shall 在下一次会话或重载后不再暴露该模型(与既有禁用机制同语义、同生效时机)。
3. While ai-gateway 套件未启用, the 图像模型开关清单 shall 与启用本特性前逐字节一致。
4. The 设置页图像模型开关清单 shall 与运行时图像工具注册路由集在任一启用形态下保持同源一致(清单条目集合 = 可运行路由集合)。
5. When 图像开关清单包含网关条目, the 设置界面 shall 以来源标记区分网关与自配条目。

### Requirement 5:清单过滤与命名空间边界
**Objective:** 作为部署运维,我希望 provider 隐藏开关的作用范围明确且各清单口径一致,以便配置行为可预期。

#### Acceptance Criteria
1. The `PI_WEB_HIDE_PROVIDERS` 部署开关 shall 对对话模型清单(设置页下拉与会话内选择器)持续生效(维持现状口径)。
2. The 图像工具模型清单 shall 不受 `PI_WEB_HIDE_PROVIDERS` 影响(图像工具的 provider 命名空间与对话 provider 相互独立;避免出现「工具可跑但清单不可见」的偏差)。
3. When `PI_WEB_HIDE_PROVIDERS` 包含 `ai-gateway`, the pi-web 服务端 shall 从对话模型清单中剔除全部网关目录条目(网关分组可被整体隐藏)。
4. When 模型清单响应新增来源/可用性/渠道等标记字段, the pi-web 服务端 shall 以可选字段形式追加,既有消费方零改动可继续解析(响应形状只增不改)。

### Requirement 6:回归与验证可观察性
**Objective:** 作为项目维护者,我希望本次修复具备可复验的证据,以便回归时能快速判定缺陷是否复发。

#### Acceptance Criteria
1. When 在启用 ai-gateway 的部署上请求对话模型清单, the pi-web 服务端 shall 使自配 provider 集合与未启用时相等(D1 回归断言可自动化)。
2. When 在启用 ai-gateway 的部署上请求对话模型清单, the providers 列表 shall 不含任何网关内部渠道名且至多新增 `ai-gateway` 一项(D2 回归断言可自动化)。
3. When 在启用 ai-gateway 的部署上请求图像模型清单, the 清单 shall 含全部网关图像路由条目(D4 回归断言可自动化)。
4. The 端到端验证 shall 覆盖「设置页默认 Provider 下拉恢复自配 provider、网关模型分组与不可选态、图像开关含网关条目」三个用户可观察结果。
