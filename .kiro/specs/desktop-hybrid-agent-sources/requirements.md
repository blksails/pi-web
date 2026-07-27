# Requirements Document

## Project Description (Input)

桌面版用户已能通过 pi-cloud 登录并持有桌面凭据，但 agent source 选择器仍只枚举本机源（默认扫描 `~/.pi-web/agents` 与本地 `sources.json`）。云端已交付 `POST /api/desktop/capabilities`（授予 registry 访问的 `sources.baseUrl` + 短期 consume token）与 registry `GET /sources`。

本特性在 **pi-web 本机 server** 上将 agent source 列表改为：**使用线上登录凭证换取能力授予后，合并线上 registry 可见 agent 与本地 `~/.pi-web/agents`（及本地 sources 登记）**。未登录时行为与今日一致；线上失败不得拖垮本地列表。

**范围（P1）**：列表并集与凭证链路。  
**非范围（P2）**：选中线上源后自动 resolve/install 并建会话（可后续 spec）。

## Boundary Context

- **In scope（本 spec，pi-web 仓）**：hybrid agent source 列表装配；桌面凭据 → capabilities → registry 列表；本地扫描默认根 `~/.pi-web/agents`；未登录/失败降级；token 不落盘；与既有 `GET /agent-sources` 分页/排序兼容。
- **Out of scope（pi-clouds 仓，外部契约，引用不拥有）**：`POST /api/desktop/login`、`POST /api/desktop/capabilities`、registry 可见性/鉴权、consume token 签发。
- **Out of scope（后续）**：线上源一键可运行（install/resolve 后 spawn）；`runnable`/`reason` 协议字段正式化；Workspace 新实现。
- **Adjacent expectations**：用户已通过 `desktop-cloud-login` 获得有效桌面凭据；云端 capabilities 在有效凭据下返回 `sources` 授予；registry 接受 consume token 的 `GET /sources`。

## Requirements

### Requirement 1: 本地源始终可见

**Objective:** 作为桌面用户，我想始终能看到本机已放好的 agent，以便离线或未登录时也能工作。

#### Acceptance Criteria
1. When 请求 agent source 列表, the 系统 shall 包含默认扫描根 `~/.pi-web/agents` 下可识别的一级子目录源（`origin` 为扫描类）。
2. Where 环境变量显式配置了扫描根, the 系统 shall 使用该配置**完全接管**默认根（覆盖而非静默追加到默认根之外的未声明行为保持与现状一致）。
3. When 扫描根不存在或不可读, the 系统 shall 将该根视为空贡献，不使整列表失败。
4. When 本地 sources 登记文件存在合法条目, the 系统 shall 将其并入列表；文件不存在或损坏时视为空贡献。

### Requirement 2: 登录后合并线上源

**Objective:** 作为已登录的桌面用户，我想在选择器中同时看到线上对我可见的 agent 与本地 agent，以便选用云端分发的源。

#### Acceptance Criteria
1. While 处于有效桌面登录态, when 请求 agent source 列表, the 系统 shall 使用当前桌面凭据向云端能力端点换取 registry 访问授予，并枚举线上可见 agent。
2. While 处于有效桌面登录态, the 系统 shall 将线上源与本地扫描源（及本地登记源）以并集形式返回。
3. When 同一逻辑源同时出现在多路贡献中, the 系统 shall 按稳定优先级去重，使调用方看到唯一条目（线上优先于本地登记，登记优先于扫描；具体排序与分页键须与既有列表契约兼容）。
4. While 未登录或登录态已失效, the 系统 shall 不请求线上 registry，列表仅含本地贡献。
5. When 用户登出后再次请求列表, the 系统 shall 不再包含此前仅因登录而出现的线上条目。

### Requirement 3: 线上源条目语义

**Objective:** 作为选择器与后续安装链路的消费者，我想线上源条目有稳定、可提交的引用形态，以便与云端约定一致。

#### Acceptance Criteria
1. When 投影线上 agent 摘要, the 系统 shall 将条目的可提交 `source` 设为 `sourceId@channel` 形态（默认 channel 与云端约定一致，如 `stable`）。
2. When 投影线上条目, the 系统 shall 将其来源标记为 registry 类（与协议 `origin` 判别式兼容），展示名优先使用线上 displayName。
3. When 线上列表含确定为 plugin 的源, the 系统 shall 不将其作为会话 agent 列入选择器。
4. The 系统 shall 不在列表响应中暴露租户内部策略字段或 consume token 明文以外的任何新凭据（token 仅用于服务端拉取，不返回给前端）。

### Requirement 4: 凭证与能力授予安全

**Objective:** 作为安全与运维方，我想列表链路不扩大凭据面，以便与桌面登录安全不变式一致。

#### Acceptance Criteria
1. The 系统 shall 仅使用进程内有效桌面凭据（及钥匙串恢复后的登录态）换取能力授予，不要求用户另行配置 registry 长期 token 作为默认路径。
2. The 系统 shall 不将桌面凭据、capabilities 响应中的 `sources.token`、或其他短期授予写入 Workspace、配置文件、会话历史或日志。
3. When 缓存能力授予, the 系统 shall 仅使用进程内存，并在 `expiresAt` 到期后重新获取，不得无限期复用过期 token。
4. If 桌面凭据无效或过期, then the 系统 shall 不携带失效身份请求 capabilities，列表回退为本地贡献。

### Requirement 5: 失败与降级（本地优先）

**Objective:** 作为桌面用户，我想线上能力故障时本地源仍可用，以便网络或云端问题不阻断本机工作。

#### Acceptance Criteria
1. If 能力端点不可达、返回非成功或响应缺少 sources 授予, then the 系统 shall fail-soft：记录可诊断信息（不含 token），列表仍返回本地贡献，且不因线上失败对整端点返回 500（除非本地路径本身致命错误——与现状 agent-sources 错误语义对齐时须保持可测）。
2. If registry `GET /sources` 失败, then the 系统 shall 将该路贡献视为空，本地贡献仍返回。
3. If 能力端点因身份拒绝（401 类）, then the 系统 shall 不重试刷屏，并按未获线上源处理；可依赖既有登录态 UI 引导重新登录。
4. While 线上贡献失败, the 系统 shall 不删除或修改本地 `~/.pi-web/agents` 与本地登记文件。

### Requirement 6: 协议与分页兼容

**Objective:** 作为前端选择器，我想列表协议与分页行为保持稳定，以便无需改 UI 契约即可展示并集。

#### Acceptance Criteria
1. The 系统 shall 继续通过既有 `GET /agent-sources`（含 limit/cursor）返回并集结果。
2. The 系统 shall 保持与既有 `AgentSourceItem` 字段兼容（id/source/name/kind/origin/mode 及可选 title/description/avatar）。
3. The 系统 shall 使用与既有比较器一致的稳定排序与 keyset 游标语义，避免分页漂移或重复/漏项。
4. Where 前端已有登录态变化后的列表刷新机制, the 系统 shall 使重新请求即可反映登录/登出后的并集变化（不强制新 SSE 推送）。

### Requirement 7: 运行性边界（P1 明确）

**Objective:** 作为产品与实现方，我想明确「能看见」与「能直接跑」的边界，以免 P1 范围膨胀。

#### Acceptance Criteria
1. The 系统 shall 将「列表并集与凭证链路」视为本特性完成条件；不要求选中线上 `sourceId@channel` 后本机会话必然创建成功。
2. When 用户选中本地目录类源（扫描得到的绝对路径）, the 系统 shall 保持既有建会话行为可用。
3. The 系统 shall 允许后续特性在不破坏本列表契约的前提下，增加线上源的安装/resolve 与可运行性展示。

### Requirement 8: 外部契约依赖

**Objective:** 作为集成方，我想对 pi-clouds 的依赖边界清晰，以便契约缺失时行为可预期。

#### Acceptance Criteria
1. The 系统 shall 依赖 pi-cloud 的桌面能力端点获取 `sources.baseUrl` 与短期 consume token，而不在本仓签发 registry consume token。
2. The 系统 shall 依赖 registry 的消费面列表 API 枚举线上源，而不在本机扫描云端包存储。
3. If 云端能力端点或 registry 未配置/不可用, then the 系统 shall 降级为仅本地列表（见 Requirement 5），不引入第二套硬编码源清单作为默认。
