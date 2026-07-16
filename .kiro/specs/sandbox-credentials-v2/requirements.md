# Requirements Document

## Introduction

沙箱凭据保护 v2(pi-web 侧):让云沙箱内运行的 agent 不再持有任何真实上游凭据。按接口性质分两面治理——**平台基础配额面**(LLM 主对话、附件 store)采用统一的 scoped token 代理认证:沙箱只持有按服务面细分、与会话绑定、可过期的 token,由服务端点原生校验后以真实凭据代为访问上游;**扩展接口面**(AIGC 等 agent 扩展调用)凭据由平台层(pi-clouds settings UI)配置并以环境变量覆盖注入,pi-web 仅保留接头。同时摘除已废弃的 aigc-proxy 反代。本 spec 取代被搁置的 fetch-bridge 全局 fetch 接管方案:不做任何 fetch 层拦截,不做转发器协议重写。设计权威:`docs/sandbox-credentials-v2-design.md`。

## Boundary Context

- **In scope**(pi-web 本仓):scoped token 签发/校验原语;沙箱装配期的 LLM 凭据切换(token 替代真实 key 下发);dev/自部署形态的 LLM 网关路由;aigc-proxy 的完全摘除;附件面部署形态的文档对齐;端到端与回归验证。
- **Out of scope**:pi-clouds 生产网关端点、settings UI、平台 env 注入通道、配额/审计(兄弟仓,本仓仅固化环境变量名与 token 校验契约);pi SDK 改动(已实证零改动可行);沙箱基座镜像 entrypoint 的 models.json 生成逻辑(镜像仓,本仓仅固化 env 名契约);现有 attachment/consume token 向 v2 形态的迁移(后续独立 spec)。
- **Adjacent expectations**:沙箱基座镜像 entrypoint 依约定环境变量生成指向网关的 models.json;pi-clouds 生产部署提供与 dev 网关同契约(路径形态、token 格式、错误语义)的端点;附件 cloud-http 后端与其 token 机制沿现状不动。

## Requirements

### Requirement 1: 分面 scoped token(签发与校验)

**Objective:** As a 平台运维者, I want 沙箱凭据是按服务面细分、与会话绑定、可过期的 token 而非真实上游凭据, so that 单枚 token 泄露只损失单一服务面且可随会话终止自然失效。

#### Acceptance Criteria

1. When 创建一个沙箱会话且某服务面启用 token 代理认证, the pi-web 宿主 shall 为该会话按每个启用的服务面(如每个 LLM provider)分别签发相互独立的 scoped token。
2. The scoped token shall 绑定所属会话与过期时间,且过期时间与沙箱会话的最大存活时长对齐。
3. When 校验一枚 scoped token, the 校验方 shall 同时验证完整性(签名)、过期时间与作用域逐字匹配,任一不满足即拒绝该请求。
4. If 一枚 token 的作用域与被访问的服务面不符(如附件面 token 访问 LLM 面、provider A 的 token 访问 provider B), the 校验方 shall 拒绝该请求。
5. The 不同服务面的 token shall 采用相互独立的签名秘密,使单一服务面的秘密泄露不波及其他服务面。
6. The token 校验失败的对外响应 shall 不包含任何凭据内容、签名秘密或可用于伪造的细节。

### Requirement 2: LLM 主对话凭据不进沙箱(装配切换)

**Objective:** As a 平台运维者, I want 配置 LLM 网关后沙箱环境中不存在任何真实 LLM provider 凭据, so that 沙箱内代码(含 agent 与其安装的任意依赖)无法窃取平台的 LLM 上游凭据。

#### Acceptance Criteria

1. Where LLM 网关基址已配置, when 创建沙箱会话, the pi-web 宿主 shall 不把任何真实 LLM provider 凭据值下发进沙箱环境(容器环境与 agent 子进程环境均不含)。
2. Where LLM 网关基址已配置, the pi-web 宿主 shall 为每个启用的 LLM provider 签发对应作用域的 token,并连同网关基址按约定环境变量名注入沙箱。
3. While 沙箱内 agent 以注入的 token 与网关基址发起主对话, the 主对话 shall 正常完成且流式回复不受影响。
4. Where LLM 网关基址未配置, the 沙箱装配 shall 维持现状(真实凭据透传)并输出可识别的告警日志,便于渐进启用。
5. The 本地(非沙箱)运行模式 shall 行为零变化。

### Requirement 3: dev 替身 LLM 网关(同契约端点)

**Objective:** As a pi-web 自部署者/开发者, I want 本地即可运行一个与生产同契约的 LLM 网关端点, so that 无平台环境也能完整验证 token 换钥链路并支撑本仓端到端测试。

#### Acceptance Criteria

1. Where dev 网关已启用, when 收到携带有效对应作用域 token 的请求, the 网关 shall 以宿主真实凭据替换请求中的认证信息后转发至该 provider 的上游,并将上游响应回传给请求方。
2. If 请求的 token 无效或过期, the 网关 shall 返回 401;if token 作用域与路径中的 provider 不匹配, the 网关 shall 返回 403;if 路径中的 provider 未登记, the 网关 shall 返回 404;if 上游不可达, the 网关 shall 返回 502。
3. The 网关的错误响应 shall 不包含任何真实凭据或其片段。
4. While 上游以流式(SSE)返回响应, the 网关 shall 不缓冲整个响应而是持续转发(长对话流不因网关中转而退化为整体等待)。
5. When 请求方中断请求, the 网关 shall 同步中断对上游的请求。
6. The 网关 shall 仅接受 POST 与 GET 方法,且对请求与响应主体逐字节透传、不做内容修改。
7. The 网关 shall 在每次请求时即时读取宿主真实凭据而不缓存,使运维更换凭据即时生效。
8. Where dev 网关未启用, the 对应路由 shall 不注册(请求得到 404),且不因缺少网关相关配置而影响其余功能的装配。

### Requirement 4: aigc-proxy 摘除(废弃落地)

**Objective:** As a 维护者, I want 已废弃的 aigc-proxy 反代从代码与运行时完全摘除, so that 扩展接口面回归单一的 env 覆盖机制,消除重复的凭据代理路径。

#### Acceptance Criteria

1. When 请求原 aigc-proxy 反代路径, the 服务 shall 返回 404(路由不复存在)。
2. The 原 aigc-proxy 的专属配置项 shall 不再产生任何效果;if 运维仍设置了这些已废弃配置项, the 服务 shall 输出提示其已废弃的告警日志。
3. Where 平台/运维未注入 AIGC 覆盖环境变量, the 沙箱装配 shall 沿用宿主环境变量透传,行为等同摘除前"未配置代理"的形态(无功能回退)。
4. The AIGC 工具既有的 base URL 与 key 环境变量覆盖机制 shall 保持零改动可用,注入的覆盖值优先于默认值生效。
5. When 摘除完成, the 仓库 shall 不再包含 aigc-proxy 的实现代码、装配接线及其专属测试,且全量既有测试通过。

### Requirement 5: 附件面部署形态对齐(文档性)

**Objective:** As a 自部署运维者, I want 明确的附件后端部署形态指引, so that 我能选择不让对象存储静态凭据进入沙箱的推荐形态,或在可信部署下显式选择直连。

#### Acceptance Criteria

1. The 部署文档 shall 说明:推荐自部署使用经 token 认证的附件后端回环形态,使沙箱环境不含对象存储静态凭据;s3 直连(凭据透传)保留为宿主可信部署下的显式选项,并说明其凭据暴露面。
2. Where 附件后端拓扑全部为经 token 认证的远程后端, the 沙箱环境 shall 不含任何对象存储静态凭据(现状能力的验证性确认,不引入代码改动)。

### Requirement 6: 端到端与回归验证

**Objective:** As a 维护者, I want 真实沙箱环境下的端到端证据与全量回归, so that "凭据不进沙箱"这一安全属性与既有功能的完好性都有可复现的验证。

#### Acceptance Criteria

1. When 在配置了 LLM 网关的真实沙箱(或等价的多进程编排)中创建会话, the 验证 shall 证明沙箱环境(容器环境与 agent 子进程环境)不含任何真实 LLM provider 凭据值。
2. When 在上述环境中发起主对话, the 对话 shall 经网关完成 token 换钥并成功返回流式回复。
3. When 以无效 token、过期 token、错误作用域 token 访问网关, the 网关 shall 分别按 Requirement 3 的错误语义拒绝。
4. When 请求已摘除的 aigc-proxy 路径, the 服务 shall 返回 404。
5. The 全量既有测试套件 shall 零回归通过。
