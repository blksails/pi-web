# Requirements Document

## Introduction

本特性为 aigc-canvas-agent 增加「AIGC 图像工具设置」的设置 UI 与生效链路，让用户能够：（1）关闭某些图像模型，使其不再被 LLM 与前端选择器使用；（2）开关工具的「提示词优化」行为。采用**混合载体**方案：模型开关走**装配期读取的持久配置**（真正从 LLM 可见枚举与下发清单移除），提示词优化走 **canvas 内实时开关 + 会话状态**（本期只做开关与读取接缝，真正的 LLM 改写留后续）。

> 既有事实与代码接缝见 `## Project Description (Input)` 段（已探查核实），作为设计阶段的输入参考。

## Boundary Context

- **In scope（本期包含）**
  - 用户可关闭 / 启用某些图像模型；被关模型同时从 LLM 可见 `model` 枚举、下发清单（`aigc.models` / `modelLabels` / `modelProviders`）与前端选择器移除。
  - 模型开关持久化，且在 aigcExtension **装配期**读取生效。
  - 用户可在 canvas 内实时开关「提示词优化」，标志经会话状态桥双向同步、并跨会话记忆。
  - 图像工具在派发到 provider 前读取「提示词优化」标志并调用一个 `optimizePrompt` 接缝。
  - 一个可达的 canvas 内设置入口（齿轮 / 设置弹层）。
- **Out of scope（本期排除）**
  - 真正的提示词改写算法或任何二次 LLM 调用（本期 `optimizePrompt` 为**无改写透传占位**）。
  - 将 aigc 设置接入「全局设置页 / 扩展面板」的**声明式 schema（config-ui）通道**。
  - 新增 / 修改 pi RPC 帧类型或协议 union（复用现有 `control:state` 桥与配置文件 / 会话状态接缝）。
- **Adjacent expectations（相邻依赖，不由本特性拥有）**
  - 依赖既有会话状态桥（`wireStateBridge` / `getSessionState` / `WebExtStateAccess`）传递提示词优化标志；本特性不改其协议。
  - 依赖既有图像工具路由（`IMAGE_GENERATION_ROUTES` / `IMAGE_EDIT_ROUTES`）与 `publishAigcCatalog` 下发链路作为过滤对象。
  - 依赖既有会话生命周期 / runner reload 机制使装配期配置变更生效；本特性不重造重载机制。

## Requirements

### Requirement 1: 模型开关的持久配置

**Objective:** 作为 aigc-canvas-agent 用户，我想把不想用的图像模型关掉并持久保存，以便之后所有会话都不再出现它们。

#### Acceptance Criteria

1. The AIGC 设置特性 shall 提供一个持久化的「被禁用模型」配置，其在 aigcExtension 装配期可被读取。
2. When 用户在设置界面禁用某个模型, the AIGC 设置特性 shall 把该模型标识写入持久配置。
3. When 用户在设置界面重新启用某个此前被禁用的模型, the AIGC 设置特性 shall 从持久配置中移除该模型标识。
4. The 持久配置 shall 以模型的稳定 `model` 标识（如 `gpt-image-2`）为键，不依赖显示 label。
5. If 持久配置缺失或为空, the AIGC 扩展 shall 视为「无模型被禁用」并保持全量模型可用。
6. If 持久配置中包含未知或已下线的模型标识, the AIGC 扩展 shall 忽略该无效标识且不报错。

### Requirement 2: 装配期模型过滤（枚举 + 清单同步移除）

**Objective:** 作为 aigc-canvas-agent 用户，我希望被禁用的模型对 LLM 与前端都彻底不可见，以便 LLM 不会选到、界面也不列出它们。

#### Acceptance Criteria

1. While 某模型在持久配置中被禁用, when 图像工具注册, the 图像工具 shall 不在其 LLM 可见 `model` 枚举中暴露该模型。
2. While 某模型被禁用, when aigcExtension 装配下发模型清单, the aigcExtension shall 使 `aigc.models`、`aigc.modelLabels`、`aigc.modelProviders` 均不含该模型。
3. While 某模型被禁用, the 前端模型选择器 shall 不在下拉中列出该模型（作为清单被移除的自然结果）。
4. If LLM 或过期客户端仍请求一个被禁用（因而已从路由集移除）的模型, the 图像工具 shall 回退到默认模型并继续执行，而非崩溃或报错终止。
5. If 持久配置将导致全部模型被禁用, the aigcExtension shall 至少保留默认模型可用，以保证工具仍可执行。
6. The 未被禁用模型的枚举顺序与清单内容 shall 与未启用本特性时保持一致（仅做过滤，不重排、不改标签 / provider 语义）。

### Requirement 3: 模型开关的生效时机

**Objective:** 作为 aigc-canvas-agent 用户，我希望清楚知道改动何时生效，以便不会误以为关了模型却仍看到它。

#### Acceptance Criteria

1. The 模型开关变更 shall 在下一次会话或 runner 重载后对该 agent 的会话生效（因其在装配期读取）。
2. If 用户在一个已激活会话中更改模型开关, then the AIGC 设置特性 shall 不对当前已装配的会话追溯改变其 LLM 枚举。
3. When 模型开关被保存, the 设置界面 shall 以用户可见的方式告知「该变更将在下一次会话 / 重载后生效」，或触发一次会话 / runner 重载使其生效（二者取一，由设计阶段确定）。

### Requirement 4: 提示词优化开关（会话状态 + 读取接缝）

**Objective:** 作为 aigc-canvas-agent 用户，我想实时开关「提示词优化」，以便控制生成前是否对我的描述做优化处理。

#### Acceptance Criteria

1. The AIGC 设置特性 shall 使用一个布尔会话状态键 `aigc.enablePromptOptimization` 表示提示词优化开关。
2. When 用户切换提示词优化开关, the Canvas 设置面板 shall 把新布尔值写入会话状态。
3. While `aigc.enablePromptOptimization` 为真, when 图像工具执行, the 图像工具 shall 在解析媒体字段之后、派发到 provider 端点之前调用提示词优化接缝（`optimizePrompt`）。
4. Where 提示词优化改写器在本期尚未实现, the `optimizePrompt` 接缝 shall 原样返回 prompt（无改写透传），不改变现有生成结果。
5. While `aigc.enablePromptOptimization` 为假或未设置, the 图像工具 shall 原样透传 prompt（与启用本特性前行为一致），不调用改写逻辑。
6. The AIGC 设置特性 shall 在会话状态与跨会话记忆均无值时，将提示词优化默认为「关」。

### Requirement 5: Canvas 内设置入口与呈现

**Objective:** 作为 aigc-canvas-agent 用户，我想在 canvas 内就地打开一个设置面板，以便无需跳转即可调整模型与提示词优化。

#### Acceptance Criteria

1. The Canvas 设置面板 shall 通过 canvas 区域内一个可达的入口控件（齿轮 / 设置按钮）打开。
2. When 设置面板打开, the Canvas 设置面板 shall 展示「模型开关」列表与「提示词优化」开关两组设置。
3. The 模型开关列表 shall 基于已下发的模型清单（含 label 与 provider 徽章语义）呈现每个模型的启用 / 禁用状态。
4. When 提示词优化开关或某模型开关的会话 / 持久值经外部更新, the Canvas 设置面板 shall 回显最新状态（订阅式更新）。
5. Where 会话状态桥不可用（宿主未接入 state）, the Canvas 设置面板 shall 优雅退化（不呈现且不报错）。

### Requirement 6: 跨会话记忆与退化

**Objective:** 作为 aigc-canvas-agent 用户，我希望我的提示词优化偏好在新会话里被记住，以便不必每次重新设置。

#### Acceptance Criteria

1. When 用户更改提示词优化开关, the AIGC 设置特性 shall 将其写入浏览器本地跨会话记忆。
2. When 新会话挂载且其会话状态中提示词优化为空, the AIGC 设置特性 shall 用跨会话记忆的值回填会话状态。
3. If 新会话的会话状态已存在提示词优化真值, then the AIGC 设置特性 shall 不用跨会话记忆覆盖该会话内真值（回填须有防竞态延迟，与既有偏好回填一致）。
4. If 浏览器本地存储不可用（隐私模式等）, then the AIGC 设置特性 shall 静默降级，会话内开关仍可用，仅不跨会话记忆。

### Requirement 7: 可测试性与质量门控

**Objective:** 作为该仓库的维护者，我要求本特性的行为可被自动化测试覆盖，以便符合项目的测试门控硬规则。

#### Acceptance Criteria

1. The 模型过滤与清单同步移除逻辑 shall 由单元 / 集成测试覆盖（含「禁用后 LLM 枚举、`aigc.models` / labels / providers 三者均不含该模型」的断言）。
2. The 提示词优化开关读取接缝 shall 由单元测试覆盖（含「开关为真时调用接缝、为假时透传」的断言）。
3. The Canvas 设置面板行为 shall 由组件测试覆盖（含入口打开、模型开关列表、提示词优化切换写会话状态、state 缺失退化）。
4. The 本特性 shall 提供一个端到端检查，验证从「设置界面切换」到「工具执行 / 清单可见性」的闭环，并以新鲜运行输出为证。
5. The 全部新增代码 shall 遵循 TypeScript strict 且不使用 `any`。
