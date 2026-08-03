# Requirements Document

## Project Description (Input)

### 谁有问题

pi-web 的使用者与部署方：想在**对话**中使用 Cloudflare AI Gateway 上的模型（点名 GPT 5.5、Claude Opus 5、Claude Sonnet 5、Claude Haiku 4.5），但目前做不到。

### 现状

- 仓内**没有**硬编码的对话模型清单 —— 它取自 pi SDK 的 `ModelRegistry`（内置 + `<agentDir>/models.json`），要新增模型只能让每个用户手工改 `models.json`。
- 已有的 `ai-gateway` 套件**具备**拉取外部网关目录并合并进模型清单的能力，但从未接过 Cloudflare。
- 同仓虽已有 Cloudflare 的**图像** provider（`cloudflare-aigc-provider`），但那是 `/ai/run` 端点、只服务 AIGC 工具，与对话无关。

2026-07-29 带凭据真机探测的结论（详见 `research.md`）：

| 验证项 | 结果 |
|---|---|
| CF 认标准 `Authorization: Bearer <CF_TOKEN>` | ✅ chat 200 / models 200 |
| `${baseUrl}/v1/models`（baseUrl 取到 `/compat`） | ✅ 2465 条真目录 |
| `${baseUrl}/v1/chat/completions` | ✅ 实回 `'ok'` |
| 四个点名模型 | ✅ 全部实调成功（Haiku 5 不存在，以 4.5 替代） |
| 只用一把 CF token（无需各 provider key） | ✅ 网关已配 stored keys，统一计费 |

即：**认证与路径两处均已天然吻合**，`ai-gateway` 极可能零代码改动即可接入。

### 要改成什么

1. 让部署方仅通过**环境变量**即可把 Cloudflare AI Gateway 接为对话模型来源，其上模型自动出现在模型选择器中。
2. 对 2465 条的庞大目录做**provider 白名单收敛**，使选择器保持可用。
3. 以**真实装配**跑通端到端，而非仅凭裸 curl 宣称可用。
4. 配置约定与易错点（尤其 `/compat` 层级）写进文档与错误提示。

### 已决策项（2026-07-29）

| 议题 | 决策 |
|---|---|
| 目录收敛策略 | **provider 白名单**（经 env 可配）。既排除 openrouter 那 1067 条重复，又保各家完整型号，新型号发布自动可见 |
| spec 范围 | **接线验证 + 收敛 + 文档**。若跑通中发现不兼容，再补最小改动 |
| Haiku 版本 | `claude-haiku-4-5`（`claude-haiku-5` 经实测不存在） |

## Boundary Context

- **In scope**：以 `ai-gateway` 套件接入 Cloudflare 的端到端验证；网关模型目录的 provider 白名单收敛；配置文档与可诊断的错误提示。
- **Out of scope**：
  - `llm-gateway`（沙箱换钥代理）—— 它只管转发、不产出模型清单，且其 `upstreamBase` 为静态字符串，与本需求无关；
  - Cloudflare **图像** provider（`/ai/run`，已由 `cloudflare-aigc-provider` 覆盖）；
  - 定价元数据（`cost_in`/`cost_out`）的采集与展示 —— 目录中现成，但本期不纳入；
  - 迁移到 CF 新端点 `api.cloudflare.com/client/v4/.../ai/v1/*`（实测其 `/models` 返回 405，尚不可替代）。
- **Adjacent expectations**：
  - 未配置本特性时，pi-web 行为与今天**逐字节一致**（`ai-gateway` 套件本就以单一 env 为启用判别）；
  - 模型能否真正调用取决于 Cloudflare 网关侧的 stored keys 配置，不由本特性保证；
  - 上游 CF 的端点与目录形态不受本仓控制，其变更需重新验证。

## Requirements

### Requirement 1: 经环境变量接入 Cloudflare 对话模型

**Objective:** 作为部署方，我希望只配置环境变量就能把 Cloudflare AI Gateway 接为对话模型来源，以便无需为每个用户手工维护模型文件。

#### Acceptance Criteria

1. When 部署方将网关地址与凭据配置齐备, the pi-web 服务 shall 把 Cloudflare 上的模型纳入可选对话模型清单。
2. When 用户在模型选择器中选择一个来自该网关的模型并发起对话, the pi-web 服务 shall 经该网关完成本轮对话。
3. The pi-web 服务 shall 仅要求网关自身的一份凭据，不要求部署方另行提供各上游厂商的密钥。
4. When 未配置该网关, the pi-web 服务 shall 保持与配置前完全一致的行为，不注册任何相关能力、不改变既有模型清单。

### Requirement 2: 目录收敛

**Objective:** 作为选择模型的用户，我希望模型列表保持可读可用，以便能快速找到想要的模型而不是面对数千条重复项。

#### Acceptance Criteria

1. When 网关返回的模型目录包含大量条目, the pi-web 服务 shall 依据可配置的 provider 白名单过滤后再纳入模型清单。
2. Where 部署方未指定白名单, the pi-web 服务 shall 采用一份内置的默认白名单，而非放行全部条目。
3. When 某模型的归属 provider 不在白名单内, the pi-web 服务 shall 不将其纳入模型清单。
4. When 白名单内的 provider 在上游新增了模型, the pi-web 服务 shall 无需修改代码即可使其出现在清单中。
5. The pi-web 服务 shall 使被收敛掉的条目数量可从服务端日志中得知，便于部署方判断白名单是否过窄。

### Requirement 3: 端到端可用性验证

**Objective:** 作为交付者，我希望「能用」这一结论建立在真实装配的运行证据上，以便不把「裸接口通」误当成「功能可用」。

#### Acceptance Criteria

1. The 验收过程 shall 以 pi-web 的真实服务装配跑通「目录拉取 → 模型清单 → 发起对话 → 得到回复」全链，而非仅验证上游接口可达。
2. When 端到端验证执行, the 验收过程 shall 覆盖至少一个 Anthropic 模型与一个 OpenAI 模型，以证明跨上游厂商均可用。
3. If 端到端验证中发现与既有实现不兼容之处, then the 交付 shall 补充能使其可用的最小改动，而非放宽验收标准。

### Requirement 4: 配置可诊断

**Objective:** 作为部署方，我希望配错时能立刻知道错在哪，以便不必对着空的模型列表猜测原因。

#### Acceptance Criteria

1. If 网关地址配置的层级不正确导致目录拉取失败, then the pi-web 服务 shall 在服务端日志中记录实际请求的地址与失败原因。
2. If 目录拉取失败, then the pi-web 服务 shall 保持既有的容错行为——不阻断服务启动，也不影响自配模型的展示。
3. The 项目文档 shall 说明所需的环境变量、网关地址的正确层级，以及层级配错时的表现。
4. The 项目文档 shall 记录已实测可用的代表性模型标识及其命名规则。

### Requirement 5: 已知误导性故障的可辨识

**Objective:** 作为排查问题的人，我希望知道哪些报错具有误导性，以便不被引向错误的方向。

#### Acceptance Criteria

1. The 项目文档 shall 记录：请求不存在的 Anthropic 模型时，网关会返回「凭据无效」类错误，而该错误**并不表示**凭据有问题。
2. The 项目文档 shall 记录：具备推理能力的模型在输出长度上限过小时会返回「输出被截断」，该现象**并不表示**模型不可用。
