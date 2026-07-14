# Requirements Document

## Project Description (Input)
agent 附件资源目录(session attachment catalog)。让 agent 为会话扩展一个动态附件资源目录,实现动态注入与 @ 自动补全。核心形态(已与用户确认):1) agent 声明/运行时维护可枚举的资源目录,条目惰性物化——用户 @ 补全选中时才把字节物化成正式附件注入;2) 补全并入既有输入框 @ 触发符补全;3) 动态注入双向——用户选中物化注入 + agent 运行期主动推送新产物并让前端即时感知。

**问题归属**:agent 作者(想把自己的数据源/产物暴露给用户引用,现状只能靠工具调用经 LLM 落库,无法让用户直接发现和引用)与终端用户(现状 @ 补全只能引用本地文件与已上传/已落库附件,无法发现 agent 侧尚未物化的资源,只能靠对话让 agent 去取或手动下载再上传)。

**实现基线**:worktree `feat/attachment-backend-pluggable`(叠加多后端拓扑与 agent profile 两个 spec)。

## Introduction

现状的 @ 补全能引用本地文件(`@file:`)与本会话已存在的附件(`@attachment:`),但 agent 侧掌握的资源(自有数据源、运行期生成物、外部可拉取文件)对用户不可见——用户只能在对话里请求 agent 去取,或自己下载后手动上传。本 spec 让 agent 为会话提供一个**动态资源目录**:条目可枚举、可按名过滤、出现在 @ 补全的独立分组里;条目在被用户选中前**不占存储**,选中时才物化为正式会话附件并以既有引用形式进入消息;agent 也可在运行期**主动推送**新产物进会话附件空间,前端补全与附件展示即时可见。不提供目录的 agent 与既有部署完全零变化。

## Boundary Context

- **In scope**:agent 目录的提供与运行期动态变化;@ 补全的发现/过滤/分组展示;选中触发的惰性物化与消息注入;物化幂等(同条目未变更不重复落库);agent 主动推送与前端即时感知;会话隔离与失败降级。
- **Out of scope**:目录的持久化(会话重启后由 agent 重建,不落盘);跨会话/跨 agent 共享目录;目录树/层级浏览 UI(仅平铺 + 名字过滤);未物化条目的字节级预览(缩略图等沿用既有已物化附件的能力);LLM/模型侧对目录的访问(agent 自身代码本就可达其数据);附件存储后端、写路由 profile 的语义(归上游两个 spec,本 spec 只消费)。
- **Adjacent expectations**:依赖既有 @ 触发符补全框架(provider 注册/分组/token 文法/提交期解析)与附件系统(落库、引用标记、签名分发、会话归属),不改变二者对外语义;物化写路径自然继承宿主拓扑与 agent profile 的写路由,本 spec 不另设目标选择。

## Requirements

### Requirement 1: agent 提供动态资源目录

**Objective:** As a agent 作者, I want 为会话声明并在运行期维护一个可枚举的资源目录, so that 我的数据源与产物能被用户直接发现,而不必经由对话或预先落库。

#### Acceptance Criteria
1. The agent 定义契约 shall 提供声明资源目录的可选能力,目录条目至少携带稳定条目标识、展示名称,并可携带说明与内容类型提示。
2. While agent 未提供资源目录, the 系统 shall 在补全、附件、会话装配各方面保持与本特性引入前完全一致的行为。
3. The 资源目录 shall 支持运行期动态变化——同一会话内先后两次枚举可返回不同条目集合,以 agent 当次应答为准。
4. When 会话装配完成且 agent 提供了目录, the 系统 shall 使该目录仅对该会话可见,其他会话(含同一 agent 的其他会话)互不可见。

### Requirement 2: @ 补全发现与过滤

**Objective:** As a 终端用户, I want 在输入框用 @ 补全直接看到并筛选 agent 提供的资源条目, so that 无需离开输入框即可发现和引用 agent 侧资源。

#### Acceptance Criteria
1. When 用户在输入框触发 @ 补全且会话的 agent 提供了目录, the 补全结果 shall 以独立分组呈现 agent 目录条目,与本地文件、已落库附件分组并列且可区分。
2. When 用户在 @ 补全中继续输入查询词, the 系统 shall 按条目展示名称过滤 agent 目录条目,语义与既有附件补全的名字过滤一致。
3. While 会话正在推理(busy), the @ 补全(含 agent 目录分组) shall 照常可用,不被推理阻塞。
4. If 目录枚举失败或在补全时限内未应答, then the 系统 shall 仅将 agent 目录分组降级为空,其余补全分组不受影响,且不向用户报错弹窗。

### Requirement 3: 惰性物化与消息注入

**Objective:** As a 终端用户, I want 选中目录条目时系统才真正取回字节并作为正式附件注入消息, so that 未被引用的资源不占存储,被引用的资源与普通附件完全同等待遇。

#### Acceptance Criteria
1. While 目录条目未被选中物化, the 系统 shall 不为该条目占用附件存储空间。
2. When 用户在 @ 补全中选中一个目录条目并发送消息, the 系统 shall 在消息提交前将该条目物化为归属当前会话的正式附件,并使消息以既有附件引用形式携带它,agent 与前端渲染均与普通附件无差别。
3. When 同一目录条目(内容未变更)被再次选中, the 系统 shall 复用先前已物化的附件,不重复落库。
4. If 物化失败(条目已不存在、agent 未应答或取回出错), then the 系统 shall 向用户呈现可理解的失败反馈,且消息不携带失效引用。
5. When 目录条目物化落库, the 产出附件 shall 与普通附件遵循同样的写路径语义(含宿主拓扑与 agent profile 的写路由)、签名分发与会话归属规则。

### Requirement 4: agent 主动推送与即时感知

**Objective:** As a agent 作者, I want 在运行期把新产物直接注入会话附件空间并让用户立刻看到, so that 后台任务的产出无需等用户询问即可被发现与引用。

#### Acceptance Criteria
1. The agent 侧运行期能力 shall 支持把一个产物注入为归属当前会话的正式附件,注入不触发模型推理、不进入对话历史。
2. When agent 注入新附件, the 前端 shall 无需刷新页面即可在 @ 补全的附件分组中发现它(即时感知)。
3. Where 前端存在会话附件的可视化展示, when agent 注入新附件, the 该展示 shall 在同等时效内可见新条目。
4. The agent 注入的附件 shall 在引用、渲染、签名分发、会话结束后的历史回放上与用户上传附件同等待遇。

### Requirement 5: 生命周期与会话隔离

**Objective:** As a 终端用户, I want 已注入消息的资源永远可回放,而目录本身随会话存活, so that 历史完整可信且不产生悬空状态。

#### Acceptance Criteria
1. When 会话结束或服务重启后回放历史消息, the 已物化/已推送附件的引用 shall 照常可显示与分发(不依赖 agent 进程存活)。
2. While 会话的 agent 子进程重启(如热重载), the 目录 shall 以重启后 agent 的当次应答为准;重启前已物化的附件不受影响。
3. If 用户试图经补全提交一个已失效的目录条目引用, then the 系统 shall 按物化失败路径处理(可理解反馈,不带失效引用),不产生半落库状态。
4. The 目录枚举与物化 shall 仅接受来自条目所属会话的请求,跨会话请求一律拒绝。

### Requirement 6: 旁路语义与失败隔离

**Objective:** As a 宿主运维者, I want 目录能力是纯旁路且故障可隔离, so that agent 目录实现的缺陷不影响会话核心功能。

#### Acceptance Criteria
1. The 目录枚举与物化 shall 不触发模型推理、不进入对话历史、不产生除附件落库外的会话状态变化。
2. If agent 的目录实现抛错或挂起, then the 会话核心功能(对话、既有补全分组、既有附件能力) shall 不受影响。
3. The 目录条目的枚举与物化逻辑 shall 仅在 agent 子进程内执行,主进程只消费其应答的纯数据与已落库附件的标识。
