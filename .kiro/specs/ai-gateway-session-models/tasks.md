# Implementation Plan

## 0. 前置实证（决定后续方案是否成立）

- [x] 0.1 实证 pi SDK 对含斜杠模型 id 的处理
  - 构造内存注册表，注册一个网关命名空间的 provider，其中含一个 id 带斜杠的模型
  - 以 (provider, 带斜杠 id) 两参查找，确认可解析
  - ★这是 research §五标记的唯一未实证前提；不成立则须回到 design 改用 id 编码方案
  - 完成条件：以可复跑的测试断言查找成功，并记录结论
  - _Requirements: 1.1_
  - _Boundary: 模型注册表_

- [x] 0.2 核对命名空间是否与共享凭据存储撞名
  - 检查共享凭据文件中是否已存在同名 provider 条目
  - 撞名会静默覆盖本 provider 的凭据并表现为 401
  - 完成条件：给出核对结果；若撞名则在本文件记录改名决定
  - _Requirements: 3.3_

## 1. 会话侧模型来源

- [x] 1.1 新增网关会话模型来源模块
  - 定义跨进程 env 契约常量与 provider 命名空间常量
  - 从环境解析出「基址 + 凭据 + 模型 id 列表」，任一缺失/非法/列表为空 → 视为未启用
  - 提供「把该来源注册进给定注册表」的函数，采用 OpenAI 兼容 API 与标准认证头
  - ★env 名不得沿用会被子进程误认作其他网关凭据的历史名
  - 完成条件：解析与注册各有断言；带斜杠 id 可被解析
  - _Requirements: 1.1, 2.4, 3.2_
  - _Depends: 0.1_
  - _Boundary: 网关会话模型来源_

- [x] 1.2 重构既有登录态来源为「解析 + 注册」两层
  - 拆出纯解析函数与「注册进给定注册表」函数
  - 既有对外导出保持可用，内部改为经新原语实现
  - 完成条件：既有相关测试无需修改即通过
  - _Requirements: 3.1, 3.4_
  - _Boundary: 登录态模型来源_

- [x] 1.3 合成单一注册表并接入会话构造
  - 两来源分别解析；任一存在则构造一次共享凭据存储与内存注册表，各自注册
  - 两者均不存在时完全不触碰会话服务选项，保持既有默认路径
  - 完成条件：三种组合（仅登录态/仅网关/两者）均可解析各自模型；两者皆无时行为不变
  - _Requirements: 1.1, 1.3, 3.1, 3.4_
  - _Depends: 1.1, 1.2_

- [x] 1.4 模型解析失败时补来源提示
  - 当失败的模型属网关命名空间，错误信息补充来源与常见成因指引
  - 非网关来源的错误文案保持不变
  - 完成条件：两种来源各有断言
  - _Requirements: 1.4, 4.2_
  - _Depends: 1.3_

## 2. 装配层下发

- [x] 2.1 新增会话下发的纯函数
  - 依据「网关配置 + 凭据 + 目录快照」产出待并入 spawn 环境的键值对
  - 未启用 / 无凭据 / 目录为空 → 空对象
  - 记录下发的模型条目数与序列化字节数；超过约定阈值时告警
  - 完成条件：四种输入各有断言；凭据不出现在任何日志断言中
  - _Requirements: 2.1, 2.3, 2.5, 7.1_
  - _Boundary: 网关会话装配_

- [x] 2.2 在装配处并入 spawn 环境
  - 与既有登录态下发并列，取目录同步快照与凭据解析结果
  - 未启用网关套件时不产生任何相关键
  - 完成条件：启用与未启用两条路径均可跑通既有测试
  - _Requirements: 1.3, 2.5_
  - _Depends: 1.1, 2.1_

## 3. 目录语义修订

- [x] 3.1 目录条目可用性翻转为「可接入会话」
  - 网关条目的可用性标记改为可接入会话
  - 来源标识与渠道标识保持不变
  - 更新受影响的既有断言为新期望（★不得放宽为宽松匹配）
  - 完成条件：合并纯函数测试全绿，且改回旧值会使断言失败
  - _Requirements: 5.1, 5.3, 5.4_
  - _Depends: 1.3_

- [x] 3.2 provider 列表纳入网关
  - 存在网关条目时，provider 列表包含网关；无网关条目时与修订前一致
  - ★这是对既有 spec 已冻结约定的**有意修订**，须在本文件记录理由
  - 完成条件：有/无网关条目两种情形各有断言
  - _Requirements: 6.1, 6.3, 6.4_
  - _Depends: 3.1_

- [x] 3.3 回写前作 spec 的记账
  - 在被修订的前作 spec 中留下一条记账：哪条约定被改、为何、由本 spec 承接
  - 完成条件：前作 spec 中可查到该记录
  - _Requirements: 6.4_
  - _Depends: 3.2_

## 4. 不可对话变体的表态

- [x] 4.1 统计目录中特殊形态条目并据此决策
  - 统计真实目录中带 API 变体后缀的条目数量与形态分布
  - 若全部为已知变体后缀 → 落一条窄排除规则并记录统计数据
  - 若存在正常对话模型命中该形态 → 放弃收敛，改由错误提示与文档承担
  - ★决策必须基于实际统计数据，不得凭印象
  - 完成条件：统计结果与所选分支均记录在本文件
  - _Requirements: 4.1, 4.3_
  - _Depends: 2.2_

## 5. 端到端验证

- [x] 5.1 真实服务实例的全链验证
  - 设置页的默认 Provider 下拉出现网关项
  - 模型选择器中网关条目可选中（不再禁用）
  - 选中一个网关模型新建会话并发送消息，得到实际回复
  - ★不得以单元测试通过或直接请求转发端点成功替代
  - 完成条件：记录所用模型标识、耗时与回复内容作为新鲜证据
  - _Requirements: 1.2, 5.2, 6.1, 6.2, 7.2, 7.3_
  - _Depends: 2.2, 3.2_

- [x] 5.2 登录态共存验证
  - 在网关启用的前提下，确认既有登录态路径未被破坏
  - 若本机不具备登录态条件，以测试覆盖三种组合并如实说明真机未覆盖
  - 完成条件：给出验证方式与结论，受限处明确标注
  - _Requirements: 3.1, 3.4_
  - _Depends: 5.1_

## 6. 文档与验收

- [x] 6.1 更新接入文档
  - 说明模型现已可用于会话、新增的配置项、可用性标记的含义变化
  - 记录不可对话变体的现状与自助排查方式
  - 完成条件：按文档从零配置一次可成功用网关模型对话
  - _Requirements: 4.2, 4.3_
  - _Depends: 4.1, 5.1_

- [x] 6.2 全量测试与类型检查
  - 受影响的包跑通完整测试套件；类型检查无错误
  - 完成条件：以实际运行输出为证，无失败用例、无类型错误
  - _Requirements: 1.3, 3.4, 6.3_
  - _Depends: 5.1_


## Implementation Notes

### 0.1 前置实证结论 —— PASS（方案成立）

pi SDK **不对含斜杠的 modelId 做二次切分**。以真实 `ModelRegistry.inMemory` 实证：

```
★ 带斜杠 id 查找: OK   返回 id=anthropic/claude-opus-5  provider=ai-gateway
★ 不存在的 id  : OK(undefined)
```

research §五标记的唯一未实证前提成立，无需回退到 id 编码方案。已钉进
`session-model-source.test.ts`。

### 0.2 命名空间核对 —— 无撞名

`~/.pi/agent/auth.json` 现有 provider 仅 `openrouter`，与 `ai-gateway` 不冲突。
（撞名会让 auth.json 的 key 覆盖本 provider 的 apiKey → 静默 401。）

### 3.2 providers 修订理由（Req 6.4）

`model-catalog` spec 冻结了「providers 仅含 self 来源」，理由是「providers 是可设为默认的
集合，而网关条目**当时不可接入会话**」。该前提已随 `availability` 翻转消失 —— 网关模型
现在能跑，把它排除在默认 provider 之外就只剩功能缺失（本轮需求的直接触发点）。

三处断言按新期望更新（**未放宽为宽松匹配**）：
`ai-gateway/model-catalog.test.ts`、`model-catalog/service.test.ts`、
`test/ai-gateway-route-mount.integration.test.ts`。并新增「无网关条目时逐字节一致」用例。

### 4.1 统计数据与所选分支 —— design 的两个分支都不成立

对真实 CF 目录（2465 条，白名单收敛后 470 条）统计，含冒号者 68 条：

```
:batch 25 · :free 20 · :beta 14 · :thinking 3 · :exacto/:extended/:nitro 各 1
```

design §D4 预设的两个分支（「全为 API 变体 → 排除含冒号者」/「存在正常模型 → 放弃收敛」）
**都不适用**：`:free`/`:beta`/`:thinking` 是正常对话模型的路由后缀，一刀切会误伤 43 条。

**落更窄的实据规则：只排除 `:batch`**（形态确定、需另一套凭据、前作已实测 401）。
其余非对话条目（embedding/tts/whisper/moderation）留待后续，由 1.4 的来源提示与文档承担。
收敛结果 470 → **445**。

### 5.1 端到端证据（2026-07-29，真实服务实例 :3210）

**目录侧四项**（改动前实例为对照：`providers` 无 ai-gateway、`availability` 全 catalog、含 25 条 `:batch`）：

```
★ providers: ["apiservices","dashscope","dashscope-token-plan","qiniu","ai-gateway"]
★ 网关条目数: 445（改动前 470，差 25 = 被剔除的 :batch）
★ availability 取值: ["session"]
★ 残留 :batch: 0     其他冒号后缀保留: 43 条（:exacto/:free/… 未误伤）
```

**会话侧**：`POST /api/sessions/:id/model` → 状态回读证明模型已在 runner registry 解析：

```json
{"id":"anthropic/claude-opus-5","provider":"ai-gateway","api":"openai-completions",
 "baseUrl":"https://gateway.ai.cloudflare.com/v1/…/pi-labs/compat/v1"}
```

**跨厂商三连对话**（compat 修复后复验）：

```
anthropic/claude-opus-5           → "收到"  stop  3652 tok  19s
openai/gpt-5.5                    → "明白"  stop  1990 tok   9s
google-ai-studio/gemini-2.5-flash → "好的"  stop  2221 tok   9s
```

### ★端到端揪出的真实缺陷：`max_tokens` 不被 OpenAI 推理模型接受

首轮 e2e 中 anthropic 通过、**`openai/gpt-5.5` 返回 `content: []` + `stopReason: "error"`，
服务端无任何日志**。直连网关复现，根因是参数名：

```
Unsupported parameter: 'max_tokens' is not supported with this model.
Use 'max_completion_tokens' instead.
```

pi SDK 的 `openai-completions` 默认发 `max_tokens`；CF 上的 anthropic 接受它，OpenAI
推理模型不接受。三家上游实调确认**均接受** `max_completion_tokens`，故在
`registerAiGatewayProvider` 统一设 `compat.maxTokensField`，不按模型分支（靠 id 猜
「哪些是推理模型」是脆弱启发式）。已补测试钉死 —— 移除该 compat 会让 gpt-5 系在真机上
静默失败，而其他单测都发现不了。

**这是「不得以单测替代端到端」的又一次实证**：全部单测与 tsc 全绿，缺陷只在真机暴露。

### 5.2 登录态共存 —— 测试覆盖，真机未覆盖（如实标注）

三种组合（仅登录态 / 仅网关 / 两者）均有断言：`session-model-source.test.ts` 的
「egress 与 ai-gateway 共存」describe，含「仅 egress 时网关模型不可解析」反向锚定。

**本机不具备登录态条件**（未配 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE`、未登录），故
「两者同时启用」这一组合**真机未覆盖**。风险可控：合成逻辑是同一个 registry 上的两次
独立 `registerProvider`，且既有 egress 相关测试未经修改即通过（任务 1.2 的完成条件）。

### 6.2 全量测试与类型检查

```
packages/server  2471 passed | 18 skipped   （1 例 flaky,见下）
根包(app)         907 passed |  2 skipped
packages/ui       855 passed
tsc --noEmit      三处均 EXIT=0
```

### 顺带修的既有回归（非本 spec 引入）

`test/ai-gateway-route-mount.integration.test.ts` 持续失败：夹具 `owned_by: "openai-compat"`
不在 `cloudflare-chat-provider` 新增的默认白名单 `[anthropic, openai, google-ai-studio]` 内，
被 `filterByOwner` 静默滤空 → 网关条目永不出现。**该 spec 引入白名单时漏改了这个夹具**，
其「全量测试绿」的完成宣称不成立。已在测试中显式放行该渠道名（不改 GW_CHANNEL —— 它刻意
取一个与任何 self provider 都不同的值，用于断言「渠道名不进 providers」）。

### 一个 flaky 观察（与本 spec 无关）

`attachment-profile-disabled-subprocess.test.ts` 在 server 包全量并发下撞 40s 超时；
单独跑 3/3 通过（18.3s）。该用例只 import rpc-channel/session，不触达 ai-gateway。
与 `cloudflare-chat-provider` 记录的是同一 flaky。
