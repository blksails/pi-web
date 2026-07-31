# Requirements Document

## Project Description (Input)

### 谁有问题

- **部署方**：想同时接入多个 LLM 网关（Cloudflare AI Gateway、BlackSail 自建网关 `blksails-ai`），但当前架构一次只能接一个，且接进来后无法分辨模型来自哪个网关。
- **使用者**：想新增一个 provider（如 `qiniu`），当前只能手工改 `~/.pi/agent/models.json` —— 那是本地文件、非发布机制，无法随产品分发，也没有任何 UI 入口。

### 现状（2026-07-31 真机实测）

**① 网关身份被拍平**

- 配置是**单实例**：唯一启用判别项 `BLKSAILS_GATEWAY_BASE_URL`（`packages/adapters/src/ai-gateway/config.ts:15`），一个进程只能接一个网关。
- provider 名是**写死的常量** `"ai-gateway"`（`packages/adapters/src/ai-gateway/model-catalog.ts:101,244`）。上游厂商名（`owned_by`）被降级为 `channel` 展示元数据。
- 实测后果：本机 `BLKSAILS_GATEWAY_BASE_URL` 指向 Cloudflare 的 `/compat` 端点，`GET /api/config/models` 返回 445 条 CF 模型，全部归在 provider `ai-gateway` 名下，`channel` 为 openai(196) / google-ai-studio(133) / anthropic(116)。用户看到的是 `ai-gateway`，**认不出这是 Cloudflare**，更无法与 BlackSail 自建网关并存区分。
- 这是 `cloudflare-chat-provider` spec（已实施）的设计决策：不做独立 CF provider，而是复用 `ai-gateway` 套件指向 CF。该决策解决了"能不能用"，但留下了"分不分得清"。

**② 云端配置层缺位**

- 桌面登录 egress 骨架完整（`cloud.json` 的 `egressBase` + `PI_WEB_CLOUD_EGRESS_MODELS`），但云端下发的是**扁平模型清单**，不是 provider 配置声明。
- ⚠ **既有缺陷**：登录态（或任一模型源启用）下，runner 用 `ModelRegistry.inMemory(authStorage)` **替换**整个 registry（`packages/adapters/src/auth/egress-model-source.ts:145-149`，经 `packages/runner/src/runner/option-mapper.ts:104-133` 装配）。实测该 registry **不读 `<agentDir>/models.json`**：本地自定义 provider（`apiservices` / `dashscope` / `dashscope-token-plan` / `qiniu`）在会话模型选择器里**整体消失**，只剩 pi 内置有凭据的 + 注册进去的那一个。配置页不受影响（走主进程），于是两处清单不一致。连带风险：`settings.json` 的 `defaultProvider` 若指向本地 provider，该状态下会话默认模型直接失效。

**③ 自定义设置层空白**

- `/settings` 只有 `defaultProvider` 一个下拉（`packages/protocol/src/config/domains/settings.ts:19-31`，`widget: "providerSelect"`），只能**从现有列表里选**，无法新增 provider、填 baseUrl / apiKey、启停某个 provider。

**④ AIGC（图像）侧的 provider 是另一套，且与对话侧同名不同义**

- image 命名空间的 `AigcCatalogEntry.provider` 是**硬编码字面量联合类型**（`packages/tool-kit/src/aigc/model-catalog.ts:17-32`），当前 6 个取值：`openrouter` / `newapi` / `sufy` / `dashscope` / `ai-gateway` / `cloudflare`。新增一个 AIGC provider 要改类型定义 —— 与 ① 的"加配置不是改代码"目标同样违背。
- ★ **同名不同义（必须一并收口的语义地雷）**：`ModelCatalogService` 刻意让 chat 与 image 两个命名空间不共享 key 空间，于是同一个字符串 `ai-gateway` 在两侧含义**正好相反**：
  - chat 侧：`ai-gateway` = 当前配到 `BLKSAILS_GATEWAY_BASE_URL` 的那个网关（本机实测指向 **Cloudflare**）；
  - image 侧：`ai-gateway` = **BlackSail 自建网关**，Cloudflare 另有独立取值 `cloudflare`（源码注释 `:28-31` 明确标注了这一区分）。
  - 后果：同一份 UI 里两处 `ai-gateway` 徽章指向不同的东西，运维按其中一处的经验去配另一处必然配错。
- 实测 `GET /api/aigc/models` 共 23 条：`openrouter` 6 / `cloudflare` 6 / `dashscope` 4 / `ai-gateway` 3 / `newapi` 2 / `sufy` 2。

**⑤ 无模态（modality）维度，过滤只能靠命名空间**

- 现有分类维度只有二元的命名空间（chat / image）与来源标记 `source`（self / ai-gateway / cloudflare）。provider **不声明自己支持哪些模态**。
- 仓内目前没有视频 / 音频生成工具（`packages/tool-kit/src` 无相关实现），即模态维度是全新的，不是对既有实现的重构。
- 后果：要加"生图 / 视频 / 声音"就得再开一个命名空间，命名空间数量随模态线性增长，而每开一个都要在目录服务、装配层、前端各改一遍；provider 与模态的多对多关系（一个 provider 可能同时供图与供视频）表达不出来。

### 要改成什么

三层递进：

1. **代码内置注册层** —— 网关配置从单实例改为**多实例**：每个网关实例有自己的 id、baseUrl、凭据、白名单；provider 名 = 实例 id（如 `cloudflare`、`blksails-ai`），不再是写死常量。provider 定义在代码中注册，不依赖 `models.json` 这类非发布机制。将来加第三个网关是**加配置，不是改代码**。
2. **认证 / 云端配置层** —— 登录身份后拉取云端下发的 **provider 配置声明**（而非扁平模型清单），与本地 provider 合并展示。**前置**：必须先修 ① 中的 `inMemory` 替换缺陷（改为在读 `models.json` 的 registry 之上**叠加**注册，而非替换），否则本层一上线就会让本地 provider 消失。
3. **自定义设置层** —— `/settings` 中可枚举并配置全部 providers（内置、云端下发、用户自定义三类来源），用户新增 / 改写的配置合并进前端展示，并在配置页 provider 下拉与会话模型选择器中一致生效。

贯穿三层的两条横向要求：

4. **provider 身份跨命名空间统一** —— 对话与 AIGC 两侧共用同一套 provider 身份，消除 `ai-gateway` 同名不同义。AIGC 的 provider 同样改为可注册 / 可配置，不再是硬编码字面量联合类型。
5. **模态成为 provider / 模型的一等维度，且分输入与输出两个方向** —— provider 与模型各自声明 `input` 与 `output` 两个类型集合，取值域 `text` / `image` / `video` / `audio`。前端按方向过滤，而不是靠"再开一个命名空间"。视频与音频当前无实现，本次只需**把维度留出来并让过滤生效**，不要求交付具体的视频 / 音频工具。

   **★ pi SDK 已有同形状字段，应对齐复用而非另起炉灶**（实测 `@earendil-works/pi-ai/dist/types.d.ts`）：

   | SDK 类型 | 字段 | 取值域 |
   |---|---|---|
   | `Model`（对话，`:567-587`） | `input: ("text"\|"image")[]` | 有 input，**无 output**（隐含 `["text"]`） |
   | `ImagesModel`（图像，`:592-595`） | `input` + `output: ("text"\|"image")[]` | 两个方向都有 |

   由此得出三条约束：

   - **命名用 `text` 而非 `chat`**：`chat` 是交互形式不是模态；SDK 已用 `text`，且"对话模型"恰好等价于 `output` 含 `text`。沿用 SDK 词表可省掉一层翻译。
   - **取值域必须由 pi-web 扩展**：SDK 的联合类型只有 `"text" | "image"`，**没有 `video` / `audio`**。因此目录条目要有 pi-web 自己的 `input` / `output` 字段，由 SDK 值映射进来再扩展，**不能**直接复用 SDK 类型（否则加 video/audio 就要等上游）。
   - **对话模型的 `output` 需补齐**：SDK 的 `Model` 没有该字段，pi-web 侧组装时按缺省 `["text"]` 补，使两类模型在目录里形状一致、可统一过滤。

   过滤语义随之自然导出：生图 = `output` 含 `image`；视觉理解 = `input` 含 `image`（正是现有 `listVisionModelOptions` 的判据，可收编）；对话 = `output` 含 `text`；将来的视频 / 配音 = `output` 含 `video` / `audio`。

6. **端点合一：删除 `GET /api/aigc/models`，全部改走同一个模型目录接口** —— 有了 `input` / `output` 维度，"图像目录"就退化成同一目录上的一次查询，不再需要独立端点。chat / image 双命名空间随之取消。

   影响面（实测清点）：

   | 消费方 | 位置 | 影响 |
   |---|---|---|
   | AIGC 图像模型开关控件 | `packages/ui/src/config/fields/aigc-model-toggles-field.tsx:47` | 唯一的前端调用点，改指统一端点 + 加过滤参数 |
   | 开关控件注册说明 | `lib/settings/register-panels.ts:150` | 注释与 widget 契约同步 |
   | 目录服务 | `packages/core/src/model-catalog/service.ts:63-65` | `chatOptions()` / `imageEntries()` 两个方法合一 |
   | 装配层 | `lib/app/pi-handler.ts:61` | 两处路由装配收敛为一处 |
   | 集成测试 | `test/ai-gateway-route-mount{,-disabled}.integration.test.ts`、`test/llm-gateway-route-mount-disabled.integration.test.ts`、`packages/server/test/model-catalog/service.test.ts` | 断言随端点重写 |
   | 浏览器 e2e | `e2e/browser/aigc-tool-settings.e2e.ts:7,37` | 断言随响应形状重写 |

   ★ **字段名不统一是本项的真正难点**，不是路由合并：

   - image 条目：`{ model, label, provider, source }`
   - chat 条目：`{ provider, id, name, source, channel, availability }`
   - 同一个东西两套名字（`model` ↔ `id`、`label` ↔ `name`）。合一必须选定一套，另一套是**破坏性变更**。
   - `aigc.json` 里用户已存的模型开关键取的是 image 侧的 `model` 值，改名会让存量开关静默失效（与 ④ 中 `defaultProvider` 同类风险，须一并给迁移策略）。

   ★ **`/api/aigc/models` 不吃 `PI_WEB_HIDE_PROVIDERS`，`/api/config/models` 吃**（`service.ts:9-11` 的 Req 5.1/5.2：image 命名空间刻意不受 hidden 影响，以免"工具能跑但清单不可见"）。合一后这条**按命名空间区分**的规则失去载体，须重新定义：是按 `output` 类型区分，还是改为查询参数显式控制。

### 已决策项（2026-07-31，用户确认）

| 议题 | 决策 |
|---|---|
| 网关拓扑 | **多网关并存**，各自成独立 provider（非"单网关正名"，非"按 channel 拆分"） |
| BlackSail 自建网关实例 id | `blksails-ai` |
| 本次范围 | 第①层 + 顺带修 `inMemory` 缺陷 + 含第③层配置 UI |
| 第②层 | 纳入设计考量，实现优先级低于 ①③（其前置修复在本次完成） |
| AIGC 侧 | 一并纳入：provider 身份与对话侧统一，消除 `ai-gateway` 同名不同义 |
| 模态维度 | 一并纳入：provider / 模型声明 **`input` 与 `output` 两个方向**的类型集合，取值域 `text`/`image`/`video`/`audio`，前端按方向过滤；本次**不**交付视频 / 音频工具本身 |
| 端点形态 | **删除 `GET /api/aigc/models`**，与 `GET /api/config/models` 合并为唯一模型目录接口；chat / image 双命名空间取消，改由 `input`/`output` 查询 |
| 模态取值域 | **由 pi-web 自己定义**（`text`/`image`/`video`/`audio`），不受 pi SDK `"text"\|"image"` 联合类型约束；SDK 值映射进来，扩展值由本仓维护 |
| 模态命名 | **用 `text`，不用 `chat`** —— 沿用 SDK 词表；"对话模型" = `output` 含 `text` |
| 对话模型 output | **组装时补齐**：SDK 的 `Model` 无该字段，pi-web 侧按缺省 `["text"]` 补，使两类模型形状一致 |

### 补充决策（2026-07-31，用户确认）

| 议题 | 决策 |
|---|---|
| 隐藏名单作用面 | **全部生效** —— 隐藏一个 provider 即彻底禁用，其模型不出现在任何清单，工具也不得使用（见 Req 5，语义统一后不再有"能跑但看不见"的偏差） |
| 自定义 provider 凭据 | **写入配置文件，UI 只写不回显** —— 可填写与覆盖，读回时只给掩码态 |
| 第②层深度 | **只留接口，不接真实云端** —— 目录服务预留"云端下发 provider 声明"这一类来源并定义合并语义，本次不实现拉取 |
| 视觉模型端点 | **一并删除 `GET /api/vision/models`** —— 其语义（`input` 含 `image`）由统一接口的类型筛选覆盖。注意消费方在 `packages/canvas-ui` 包内（`vision-op.ts`、`canvas-launcher.tsx` 的宿主直注接缝），属跨包改动 |
| 最终路由形态 | **两个**：`GET /api/config/models`（部署级目录，吃掉 aigc 与 vision 两个端点）+ `GET /api/sessions/:id/models`（会话运行时真值，保留原路径与命名）。二者职责正交：前者答"这套部署能配什么"，后者答"这个会话真能跑什么" |
| 会话端点为何保留 | 云端形态下沙箱 `agentDir` 来自烘焙镜像、`pi-cloud` 模型只在 runner 侧注册，部署级目录**无法**得知；删除需做跨沙箱边界的反向登记，代价高于收益 |
| 一致性口径 | **单向包含**，非集合相等：部署级目录有的不许在会话中无故缺失；会话可多出仅运行时注册的来源，但须标明来源（Req 6.1/6.2） |
| 写端点路径 | `POST /sessions/:id/model` **改为** `POST /sessions/:id/models`，与查询端点同路径不同方法，消除 `/model` 与 `/models` 只差一个 `s` 的视觉混淆。全仓仅一个调用链（`ModelSelector` → `useModels.select` → `usePiControls.setModel` → `pi-client.setModel`），改动面小 |
| 未纳入 | 不把读写合并为单数资源形态（即不改成 `GET/PUT /sessions/:id/model` 返回 `{current, available}`）；读写仍是两个独立操作 |
| 顺带修复 | 会话选择器的**当前模型选中态** —— 服务端已把 `set_model` 结果写入会话快照，前端却只记本地 state，导致刷新后不打勾。改为从会话快照派生（Req 11.8/11.9），不动任何路由与 API 形状 |

### 留待 design 阶段的实现选择

以下不影响用户可观察行为，属 HOW，交由 design 决定：多实例的配置命名约定；自定义 provider 的存储落点；provider id 与 pi SDK 内置 provider 名的去重机制；统一后目录条目的字段命名。

## Introduction

本特性把 pi-web 的模型 provider 从"单网关实例 + 写死常量 + 本地文件"改造为**可辨识、可注册、可配置**的体系：多个 LLM 网关可并存且各自成为独立 provider；provider 身份在对话与 AIGC 两侧统一，消除同一标识两处含义相反的隐患；模型按输入 / 输出类型（`text` / `image` / `video` / `audio`）分类，两个模型目录端点合并为一个；使用者可在设置界面自助新增与管理 provider，不必编辑本地文件。同时修复登录态下本地 provider 从会话模型清单中整体消失的既有缺陷。

## Boundary Context

- **In scope**：多网关实例的并存与身份区分；provider 标识空间跨用途统一；模型目录端点合一与输入 / 输出类型筛选；隐藏名单语义统一；会话与配置页模型清单一致（含 `inMemory` 缺陷修复）；自定义 provider 的配置界面与凭据存储；云端 provider 声明的来源位置预留；存量配置迁移。
- **Out of scope**：
  - 视频 / 音频生成工具本身 —— 本次只把类型维度留出来并让筛选生效，不交付对应工具；
  - 云端 provider 配置的**实际拉取与下发** —— 只预留来源位置与合并语义，跨仓的云端实现另行推进；
  - 模型定价元数据的采集与展示；
  - 各网关上游能否真正调通 —— 取决于上游侧的密钥与配额配置，不由本特性保证。
- **Adjacent expectations**：
  - 上游 pi SDK 的模型类型取值范围（当前仅 `text` / `image`）不受本仓控制，故本产品维护自己的类型取值范围并从 SDK 值映射；
  - 各网关的目录形态与端点由其运营方决定，其变更需重新验证；
  - 未配置任何网关实例且未自定义 provider 时，本特性不改变既有行为。

## Requirements

### Requirement 1: 多网关实例并存与身份可辨识

**Objective:** 作为部署方，我希望同时接入多个 LLM 网关并在界面上分辨它们，以便同一部署既能用 Cloudflare 也能用自建网关，而不必二选一。

#### Acceptance Criteria

1. The 模型目录服务 shall 支持同时启用零个、一个或多个网关实例，每个实例拥有部署方指定的唯一标识。
2. When 某个网关实例被启用, the 模型目录服务 shall 以该实例的标识作为其模型条目的 provider，而不是任何固定常量。
3. When 两个网关实例同时启用, the 模型目录服务 shall 在 provider 清单中分别列出两者，且各自的模型归属其所属实例。
4. If 两个网关实例被配置为相同的标识, then the 模型目录服务 shall 拒绝启动并报出冲突的标识名，而不是让其中之一静默覆盖另一个。
5. If 某个网关实例的目录拉取失败, then the 模型目录服务 shall 仅使该实例的模型缺席，其余实例与本地模型不受影响。
6. The 模型目录服务 shall 使新增一个网关实例只需增加配置，不需要修改代码或发布新版本。

### Requirement 2: provider 身份在对话与 AIGC 两侧统一

**Objective:** 作为使用者，我希望同一个 provider 标识在对话模型和 AIGC 图像模型两处含义一致，以便按一处的经验去理解另一处不会出错。

#### Acceptance Criteria

1. The 模型目录服务 shall 对全部模型使用单一 provider 标识空间，不区分用途另立标识。
2. The 模型目录服务 shall 使 Cloudflare AI Gateway 与 BlackSail 自建网关（`blksails-ai`）拥有各自独立且不相同的 provider 标识，无论其模型用于对话还是图像。
3. When 使用者在界面上看到某个 provider 标识, the 系统 shall 使该标识在任何模型清单中指向同一个上游服务。
4. The 模型目录服务 shall 使新增一个 AIGC provider 只需增加配置，不需要修改类型定义或代码。

### Requirement 3: 模型目录端点合一

**Objective:** 作为前端与集成方，我希望只有一个模型目录接口，以便不必为不同用途记住不同端点与不同字段名。

#### Acceptance Criteria

1. The 系统 shall 提供唯一一个**部署级**模型目录查询接口，供全部与会话无关的模型清单取数。
2. The 系统 shall 移除独立的 AIGC 模型目录端点与独立的视觉模型目录端点，其能力由部署级接口的类型筛选覆盖。
3. The 模型目录接口 shall 对所有模型条目使用统一的字段命名，不因模型用途而异。
4. When 调用方需要某一类模型, the 模型目录接口 shall 支持按输入 / 输出类型筛选，而不是要求调用方切换端点。
5. Where 网关与本地来源同时存在, the 模型目录接口 shall 为每个条目标明其来源，使调用方可分辨模型出自本地配置、某个网关，还是云端下发。
6. The 系统 shall 保留会话级的可用模型查询接口，其职责限定为回答"该会话运行时实际可用什么"，不承担部署级目录的职责。
7. The 系统 shall 使切换会话当前模型的操作与会话级模型查询共用同一路径，仅以请求方法区分，不再使用与查询路径仅差单复数的另一路径。
8. When 既有集成方调用变更前的模型切换路径, the 系统 shall 以可辨识的方式告知该路径已变更，而不是静默地不生效。

### Requirement 4: 输入 / 输出类型维度与过滤

**Objective:** 作为使用者，我希望按"能吃什么、能产出什么"筛选模型，以便找生图模型、配音模型或能读图的对话模型时不必靠命名猜测。

#### Acceptance Criteria

1. The 模型目录服务 shall 为每个模型条目声明输入类型集合与输出类型集合两个方向。
2. The 模型目录服务 shall 支持 `text`、`image`、`video`、`audio` 四种类型取值，且该取值范围可由本产品扩展，不受上游 SDK 的取值范围限制。
3. When 某个模型来源未声明输出类型, the 模型目录服务 shall 按对话模型缺省补齐为 `text`，使全部条目形状一致。
4. When 调用方按输出类型 `image` 筛选, the 模型目录接口 shall 返回全部图像生成模型，无论其来自本地配置还是任一网关。
5. When 调用方按输入类型 `image` 筛选, the 模型目录接口 shall 返回全部可读图模型，其结果与既有视觉模型清单一致。
6. Where 某 provider 的全部模型共享同一组类型, the 模型目录服务 shall 允许在 provider 层声明一次，由其模型继承。
7. If 模型条目自身声明了类型, then the 模型目录服务 shall 以模型条目的声明为准，覆盖其 provider 的继承值。

### Requirement 5: 隐藏名单语义统一为彻底禁用

**Objective:** 作为部署方，我希望隐藏一个 provider 就是彻底关掉它，以便不出现"清单里看不见但工具仍在用"这种自相矛盾的状态。

#### Acceptance Criteria

1. When 某 provider 被列入隐藏名单, the 模型目录接口 shall 在全部查询结果中排除其模型，不因输入 / 输出类型不同而例外。
2. When 某 provider 被列入隐藏名单, the 系统 shall 使其模型同样不可被 AIGC 工具选用。
3. If 使用者已启用的模型属于被隐藏的 provider, then the 系统 shall 使该模型不可用，且在使用者查看设置时不将其呈现为可选项。
4. The 系统 shall 使隐藏名单的生效范围在配置页、会话模型选择器与工具模型清单三处一致。

### Requirement 6: 会话可用模型对部署级目录单向包含

**Objective:** 作为使用者，我希望配置页里能选的 provider 在会话里也真的能用，以便不会出现设为默认却在会话中失效的情况。

#### Acceptance Criteria

1. The 系统 shall 使部署级目录中可用的每个 provider 在会话中同样可用，不因会话装配而无故缺失。
2. Where 某来源仅在会话运行时注册（如云端出口、沙箱内烘焙的配置）, the 系统 shall 允许会话可用模型多于部署级目录，并使调用方可分辨这些条目的来源。
3. While 使用者处于登录态, the 系统 shall 保留其本地配置的全部 provider 可用，而不是仅保留云端下发的那些。
4. When 额外的模型来源被启用, the 系统 shall 在既有可用模型之上追加该来源的模型，而不是替换掉既有集合。
5. If 使用者设定的默认 provider 在当前会话中不可用, then the 系统 shall 给出可辨识的提示，而不是静默地让会话回落到别的模型。

### Requirement 7: 自定义 provider 配置

**Objective:** 作为使用者，我希望在设置里新增和管理 provider，以便无需编辑本地文件就能接入自己的服务。

#### Acceptance Criteria

1. The 设置界面 shall 列出全部 provider，并标明每个来自内置注册、云端下发还是使用者自定义。
2. When 使用者新增一个 provider 并填写其访问地址与凭据, the 系统 shall 使该 provider 的模型出现在模型目录中。
3. When 使用者保存 provider 凭据, the 系统 shall 将其写入受限权限的配置文件，并在此后读取时只呈现掩码形式，不回显原值。
4. When 使用者重新填写凭据, the 系统 shall 以新值覆盖旧值。
5. When 使用者停用某个 provider, the 系统 shall 使其模型从模型目录中消失，且保留其配置以便再次启用。
6. If 使用者自定义的 provider 标识与既有 provider 冲突, then the 系统 shall 在保存时报错并指明冲突对象，而不是覆盖既有配置。
7. The 设置界面 shall 允许为自定义 provider 声明其输入 / 输出类型，使其模型能被类型筛选正确命中。

### Requirement 8: 云端 provider 声明的接口预留

**Objective:** 作为产品负责人，我希望目录服务已经为云端下发的 provider 配置留好位置，以便将来接入时不必重构目录结构。

#### Acceptance Criteria

1. The 模型目录服务 shall 支持"云端下发的 provider 声明"作为一类来源，与本地配置、网关实例并列。
2. When 云端来源未接入, the 模型目录服务 shall 表现得与该来源不存在时完全一致。
3. Where 云端来源与本地配置声明了相同的 provider, the 模型目录服务 shall 以确定且有文档的规则决定取舍，不产生随启动顺序变化的结果。

### Requirement 9: 存量配置不因改动失效

**Objective:** 作为既有使用者，我希望升级后原有的模型设置继续有效，以便不必重新配置一遍。

#### Acceptance Criteria

1. When 使用者升级到本特性, the 系统 shall 使其已设定的默认 provider 与默认模型继续生效。
2. When 使用者升级到本特性, the 系统 shall 使其已保存的 AIGC 模型启停设置继续生效。
3. If 某项存量设置因 provider 标识变化而无法直接沿用, then the 系统 shall 自动将其迁移到新标识，而不是静默丢弃。
4. If 存量设置指向的 provider 在新体系中已不存在, then the 系统 shall 保留该设置并给出可辨识的提示，而不是静默清除。

### Requirement 10: 零侵入与可诊断性

**Objective:** 作为部署方，我希望未启用任何新能力时行为不变、启用出错时能定位，以便升级风险可控。

#### Acceptance Criteria

1. While 未配置任何网关实例且未自定义任何 provider, the 系统 shall 使模型清单与本特性引入前保持一致。
2. If 某个 provider 的配置不合法, then the 系统 shall 在启动时报出具体的配置项与原因，而不是静默忽略该 provider。
3. When 某来源的模型因筛选或隐藏而未出现在结果中, the 系统 shall 使运维可通过日志判断该来源实际返回了多少条、被滤除了多少条。

### Requirement 11: 全部界面消费面接入统一目录

**Objective:** 作为使用者，我希望产品里每一处选模型的地方都来自同一份清单，以便在任何一处看到的 provider 与模型都一致、不互相矛盾。

#### Acceptance Criteria

1. The 系统 shall 使设置界面的默认 provider 与默认模型下拉、AIGC 图像模型开关清单、视觉模型选择清单三者取自同一份模型目录。
2. When 使用者在设置界面按类型查看模型, the 系统 shall 依据模型声明的输入 / 输出类型呈现，而不是依据其取自哪个端点。
3. The 系统 shall 使新增的网关实例与自定义 provider 的模型同样出现在会话内模型选择器中，不需要使用者做额外操作。
4. The 系统 shall 使提示词栏的 AIGC 快捷设置所列模型与设置界面的 AIGC 模型开关一致，两处对同一模型的启停状态相同。
5. When 某 provider 被新增、停用或删除, the 系统 shall 使上述全部消费面在使用者无需重启的情况下反映该变化。
6. Where 某消费面只需某一类模型, the 系统 shall 由该消费面声明所需的输入 / 输出类型进行筛选，而不是由服务端为其定制专用清单。
7. The 设置界面 shall 提供管理 provider 的入口，使新增、编辑、启停 provider 可在界面内完成。
8. When 使用者刷新页面或重新进入一个已设定过模型的会话, the 会话模型选择器 shall 呈现该会话当前实际使用的模型为选中态，而不是显示为未选择。
9. If 会话当前使用的模型不在该会话的可用模型清单中, then the 会话模型选择器 shall 使该模型可辨识而非静默消失，使使用者知道自己正用着一个已不在清单里的模型。
