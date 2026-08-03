# Requirements Document

## Introduction

让 ai-gateway 目录中的模型**真正可用于会话**，而不只是可见。

`cloudflare-chat-provider` 已让 470 条 CF 模型出现在清单中，但 `model-catalog` 冻结的语义
把网关条目标记为 `availability: "catalog"` → 选择器中禁用。本 spec 补齐执行侧：把网关注册为
pi SDK 会话的内存 provider，使选中的网关模型能实际发起对话，随后翻转可用性标记。

安全立场沿袭 `sandbox-credentials-v2` 与 `ai-gateway-providers`：**真实网关凭据不下放到 agent
进程**，经本部署 `/ai-gateway/*` 换钥转发。

## Requirements

### Requirement 1：网关模型可在会话中实际运行

**User Story:** 作为使用外部网关的用户，我希望选中网关目录里的模型后能真的对话，而不是选完报错。

#### Acceptance Criteria

1.1 WHEN 网关套件已启用 AND 会话指定了一个 `provider = "ai-gateway"` 的模型，THE 系统 SHALL 在会话服务构造时使该模型可被模型注册表解析，而不抛出「模型未找到」。

1.2 WHEN 以网关模型发起一轮对话，THE 系统 SHALL 返回上游的实际回复内容。

1.3 WHEN 网关套件**未**启用，THE 系统 SHALL 不产生任何相关注册，且会话构造路径的行为与本 spec 实施前逐字节一致。

1.4 IF 网关模型解析失败（目录已过期、上游下线等），THEN THE 系统 SHALL 给出指明「模型标识 + 来源为网关」的错误，而非裸抛注册表内部文案。

### Requirement 2：凭据处置不越过既有信任边界

**User Story:** 作为部署方，我不希望「让模型可用」这件事顺带扩大凭据的暴露面。

> **★本需求于 design 前依调研结果修订。** 初稿要求「真实凭据一律不进 agent 进程」，
> 但调研发现本地分支的 spawn env **本就携带真实 provider key**（`pi-handler.ts:787`
> 的 `...config.providerKeys`），换钥网关是专为 **e2b 沙箱**那道边界建的
> （`llm-gateway-assembly.ts:27` 写明仅 e2b 分支替换）。初稿等于凭空给本地分支
> 加了一条既有代码并不遵守的约束。修订为按边界分别表述。

#### Acceptance Criteria

2.1 WHEN 会话运行于本地 agent 进程（与服务端同机、同信任边界），THE 系统 MAY 经 spawn env 下发网关凭据，且该处置 SHALL 与既有 provider key 的下发方式保持同一形态与同一边界，不新增落盘。

2.2 WHEN 会话运行于沙箱等低信任环境，THE 系统 SHALL NOT 下发真实网关凭据；该场景的接线不属本 spec 交付范围（见 Out of Scope）。

2.3 THE 系统 SHALL NOT 在任何日志、会话历史或错误文案中记录凭据明文。

2.4 THE 系统 SHALL NOT 将网关凭据或模型清单写入 `models.json` 等落盘配置；会话侧注册须为进程内存态。

2.5 WHEN 网关套件未启用或凭据缺失，THE 系统 SHALL 不进行任何注册，并保持既有行为不变。

### Requirement 3：与既有登录态模型注入共存

**User Story:** 作为同时启用了云端登录与外部网关的用户，我希望两者都能用，而不是互相顶掉。

#### Acceptance Criteria

3.1 WHEN 登录态注入与网关注入同时具备条件，THE 系统 SHALL 使两者的模型**同时**可解析，而非后者覆盖前者。

3.2 THE 网关 provider 命名空间 SHALL 与既有 provider 命名不冲突，且与模型清单接口输出的 provider 字段取值一致。

3.3 IF 命名空间与共享凭据存储中的既有条目同名，THEN THE 系统 SHALL 使该冲突在实施阶段被显式核对，不得静默生效。

3.4 WHEN 仅其中一方具备条件，THE 系统 SHALL 保持该方原有行为不变。

### Requirement 4：目录中不可对话条目的表态

**User Story:** 作为用户，我不希望「解除禁用」变成「随便选一个就报错」。

#### Acceptance Criteria

4.1 THE 本 spec SHALL 显式表明网关目录中不可对话变体（批处理、向量、语音、审核等）的处理归属：本期收敛，或明确留待后续 spec。

4.2 IF 判定为留待后续，THEN THE 系统 SHALL 在用户选中此类条目导致失败时，给出可据以自助排查的错误信息，且该局限须写入文档。

4.3 THE 本 spec SHALL NOT 以「难以判定可对话性」为由，把一个已知会失败的选择静默呈现为正常可选项。

> 依据：`cloudflare-chat-provider` 端到端已实测撞上 `openai/gpt-4-turbo:batch` → 401，
> 且 provider 级白名单收不掉（`owned_by` 同为 openai）。

### Requirement 5：可用性标记翻转

**User Story:** 作为用户，我希望能在模型选择器里正常选中网关模型。

#### Acceptance Criteria

5.1 WHEN 会话侧执行链路已具备，THE 系统 SHALL 使网关条目的可用性标记表示「可接入会话」。

5.2 WHEN 网关条目被标记为可接入会话，THE 选择器 SHALL 允许选中并提交该条目。

5.3 THE 系统 SHALL 保留网关条目的来源标识，使用户能区分该模型来自网关而非本地配置。

5.4 THE 可用性判据 SHALL 维持既有约定：由标记本身决定，不由来源字段决定。

### Requirement 6：默认 Provider 可选性

**User Story:** 作为用户，我希望能把网关设为默认 Provider —— 这是本轮需求的直接触发点。

#### Acceptance Criteria

6.1 WHEN 网关套件已启用 AND 网关条目已可接入会话，THE 模型清单接口的 provider 列表 SHALL 包含网关。

6.2 WHEN 网关被设为默认 Provider，THE 系统 SHALL 使随后新建的会话能解析到其下的模型。

6.3 WHEN 网关套件未启用，THE provider 列表 SHALL 与本 spec 实施前一致（不含网关）。

6.4 IF provider 列表语义的变更会影响既有断言（既有 spec 已钉住「provider 列表仅含自配来源」），THEN THE 变更 SHALL 被识别为对既有约定的**有意修订**并记录理由，而非以放宽断言的方式掩盖。

### Requirement 7：可诊断性与验证

**User Story:** 作为部署方，我希望链路不通时能查得出卡在哪一环。

#### Acceptance Criteria

7.1 WHEN 网关会话注入生效，THE 系统 SHALL 记录一条含 provider 名与模型条目数的日志，不含凭据。

7.2 THE 完成宣称 SHALL 建立在真实会话的端到端证据上：在真实服务实例中选中一个网关模型并得到实际回复。

7.3 THE 端到端验证 SHALL NOT 以「单元测试通过」或「直接请求转发端点成功」替代。

> 依据：pi-clouds `cloud-builtin-agent-normalization` 的教训 —— 单测与类型检查全绿，
> 仍掩盖不了运行时架构不兼容，只有真机建会话才暴露。

## Out of Scope

- 网关目录的拉取、白名单收敛（`cloudflare-chat-provider` 已交付）。
- 图像模型侧的网关接入（`model-catalog` 已交付其目录形态，执行链路另论）。
- **沙箱（e2b）分支的会话侧接线**。`ai-gateway-assembly.ts` 已注入 `PI_AI_GATEWAY_BASE` /
  `PI_AI_GATEWAY_TOKEN`，但本仓无从对其做真机验证（沙箱镜像侧消费超出本仓）。本期只交付
  本地分支；沙箱分支的消费方留待具备验证条件时另立切片 —— **不做无法验证的接线**。
- 定价元数据的采集与展示。

## Open Questions（design 阶段需决策）

1. **Req 4 的表态**：本期是否收敛不可对话变体？若收敛，判据用什么（id 模式匹配已被前作判定为脆弱启发式）。
2. **Req 3.1 的合成方式**：单一 registry 注册两 provider，还是其他形态。
3. **本地分支的自身可达 base 如何解析**（e2b 分支复用 `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`，本地同机需另定）。
4. **Req 6.4**：`mergeModelCatalog` 的 `providers` 语义修订，是否影响 `model-catalog` spec 的既有 e2e 断言。
