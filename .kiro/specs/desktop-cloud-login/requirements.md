# Requirements Document

## Introduction

本特性给 pi-web 桌面版（Tauri 桌面壳 + 随包 Node sidecar + 本地 agent）增加**登录能力**：桌面用户用 pi-cloud 账号登录后，会话的模型请求以其**用户身份**经云端网关出口发出并按其额度计费，而无需在本地手工配置各 provider 的 API key。登录是**叠加能力**——本地 agent 仍在本机运行、会话数据仍共享 `~/.pi/agent`；未登录时行为与当前桌面版完全一致。

身份来源为 pi-web / ai-gateway / pi-clouds 三方共享的同一套账号体系，`user_id` 为贯穿全链的稳定锚。桌面凭据为一枚代表用户身份的长效凭据，模型出口经 pi-cloud 云端换取该用户的网关数据面 key（下称 **网关数据面 key**）后打到 AI 网关，该 key **永不下发到本地或前端**。

## Boundary Context

- **In scope（本 spec，pi-web 仓）**：桌面登录入口与登录旅程、桌面凭据的获取与安全存储、登录态在桌面壳中的注入与恢复、登录态下会话模型请求经云端出口、未登录/登出的降级行为、身份与数据边界的安全不变式。
- **Out of scope（pi-clouds 仓，外部契约，本 spec 引用而不拥有）**：device 授权流服务端、桌面凭据的签发与验签、面向登录用户的 LLM egress 端点、网关数据面 key 的换取/映射/存储、账号注册登录的身份后端、计费与配额。
- **Adjacent expectations（相邻期望）**：pi-cloud 提供 device 授权与桌面凭据签发；云端 egress 端点接受携带桌面凭据的请求、以 OpenAI 兼容形式返回主对话结果，并在云端完成身份→网关数据面 key 的换取；桌面凭据可被云端验签与撤销。

## Requirements

### Requirement 1: 桌面登录与身份获取

**Objective:** 作为桌面版用户，我想在桌面应用内用 pi-cloud 账号登录，以便让模型请求以我的身份计费而无需手工配置本地 key。

#### Acceptance Criteria
1. Where 云端网关登录已启用, when 用户打开登录入口, the 桌面登录模块 shall 呈现发起 pi-cloud 登录的界面。
2. When 用户发起登录, the 桌面登录模块 shall 引导用户完成 device 授权流，并在授权成功后获得一枚代表其 pi-cloud 身份的长效桌面凭据。
3. When 授权成功, the 桌面登录模块 shall 展示已登录用户的可辨识标识（如邮箱或用户名）以确认登录态。
4. If device 授权流被用户取消或未在有效期内完成, then the 桌面登录模块 shall 中止登录、保持未登录态且不写入任何凭据。
5. If 授权请求被云端拒绝, then the 桌面登录模块 shall 向用户展示可读的失败原因且不泄漏敏感细节。

### Requirement 2: 桌面凭据的安全存储与生命周期

**Objective:** 作为桌面版用户与运维方，我想让桌面凭据被安全保存并可长期免密复用，以便重启应用后无需反复登录且不产生凭据泄露。

#### Acceptance Criteria
1. When 桌面凭据获取成功, the 凭据存储 shall 将其保存至操作系统安全存储或等价加密存储，不以明文落入普通配置文件或日志。
2. The 凭据存储 shall 仅保存代表用户身份的桌面凭据，不保存任何网关数据面 key。
3. While 桌面凭据仍在有效期内, the 桌面壳 shall 在应用重启后自动恢复登录态而无需用户重新输入账号密码。
4. When 桌面凭据接近或到达过期, the 桌面登录模块 shall 提供续期或重新登录的路径以恢复有效登录态。
5. When 用户主动登出, the 凭据存储 shall 清除本地保存的桌面凭据，并使后续模型请求回退到未登录行为。

### Requirement 3: 登录态下模型请求经云端网关出口

**Objective:** 作为登录用户，我想让会话的模型请求经云端以我的身份出口，以便使用我的网关额度而不暴露 provider key。

#### Acceptance Criteria
1. While 处于有效登录态, when 会话向模型发起主对话请求, the 会话运行时 shall 将请求经云端 egress 出口发出并携带代表当前用户身份的桌面凭据。
2. While 处于有效登录态, the 会话运行时 shall 使用云端换取的该用户网关额度完成主对话，而不使用本地配置的 provider key。
3. The 会话运行时 shall 不在本地磁盘或本地环境中留存网关数据面 key。
4. When 模型响应以流式返回, the 会话运行时 shall 逐帧透传流式内容而不额外缓冲整段响应。
5. The 会话运行时 shall 采用不短于云端网关首字/空闲上限的请求超时，以避免长响应被本地提前中断。
6. If 云端 egress 出口不可达或超时, then the 会话运行时 shall 向用户展示可读错误而不静默失败。
7. If 云端因身份失效（凭据过期或被撤销）拒绝请求, then the 会话运行时 shall 提示用户重新登录并停止以失效身份重试。

### Requirement 4: 未登录与降级行为（登录为叠加能力）

**Objective:** 作为现有桌面版用户，我想在不登录时保持原有本地单机体验，以便登录能力不破坏既有工作方式。

#### Acceptance Criteria
1. While 未登录, the 会话运行时 shall 使用本地 `~/.pi/agent` 凭据与配置完成会话。
2. Where 云端网关登录未启用, the 桌面壳 shall 不呈现登录入口且行为与当前桌面版一致。
3. The 桌面壳 shall 在登录与未登录两态下共享同一份 `~/.pi/agent` 会话数据，不按用户切换 agent 数据目录。
4. When 用户登出后继续使用, the 会话运行时 shall 回退到本地凭据路径；若本地未配置凭据，则以未配置状态提示用户。

### Requirement 5: 身份与数据边界安全不变式

**Objective:** 作为运维与安全负责人，我想让登录能力不引入凭据泄露或越权面，以便满足安全与隐私约束。

#### Acceptance Criteria
1. The 桌面壳 shall 不将网关数据面 key 下发到前端页面或渲染进程。
2. The 会话运行时 shall 不将桌面凭据或网关数据面 key 写入会话历史、附件或日志。
3. The 桌面壳 shall 不因登录能力而注入 agentDir，保持与本地 CLI 共享 `~/.pi/agent` 的不变式。
4. Where 登录相关的桌面原生命令可被前端页面调用, the 桌面壳 shall 仅允许在其访问控制声明中显式放行的命令执行，拒绝未声明的调用。

### Requirement 6: 登录态失效与账号切换

**Objective:** 作为桌面版用户，我想让登录态过期或切换账号时行为清晰可预期，以便不会以失效或错误身份继续发起请求。

#### Acceptance Criteria
1. When 桌面凭据在会话进行中过期, the 会话运行时 shall 停止以过期身份发起新请求并提示用户续期或重新登录。
2. When 用户切换到另一 pi-cloud 账号登录, the 桌面壳 shall 用新身份替换旧凭据，后续模型请求以新用户身份计费。
3. While 续期或重新登录进行中, the 桌面登录模块 shall 明确指示当前登录态（有效 / 失效 / 续期中），避免用户误以为请求会成功。

### Requirement 7: 外部云端契约的依赖与容错

**Objective:** 作为集成与运维方，我想让桌面端对 pi-clouds 所提供的 device 授权、凭据验签、LLM egress 的依赖边界清晰且容错，以便契约缺失时可优雅降级。

#### Acceptance Criteria
1. The 桌面登录模块 shall 依赖 pi-cloud 提供的 device 授权与桌面凭据签发能力获取身份，而不在本仓自行签发身份凭据。
2. The 会话运行时 shall 依赖 pi-cloud 的 LLM egress 出口完成网关数据面 key 换取与网关调用，而不在本仓保存或映射网关数据面 key。
3. If 所依赖的云端契约端点缺失或版本不兼容, then the 桌面壳 shall 以可读方式提示登录或网关不可用，并回退到未登录本地行为。
