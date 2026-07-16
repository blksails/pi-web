# Requirements Document

## Project Description (Input)
AIGC provider key 出口代理网关(方案A:key 不进沙盒)。目标:e2b 沙盒内的 aigc 工具调用不再持有真实 provider key(NEWAPI_API_KEY/SUFY_API_KEY/DASHSCOPE_API_KEY 等),改为宿主侧凭据注入反代。核心机制:1) provider 路由声明层 baseUrl 字面量改为 `${X_BASE_URL:-字面量}` 占位(runEndpoint 已对 url/headers 做 resolveVars,本地行为不变);2) 宿主 server 新增 `/api/aigc-proxy/:provider/*` 反代路由段:校验会话短期 token → Authorization 换真实 key → 按白名单 provider→上游映射流式转发(multipart 与 SSE 必须 pipe 不 buffer;新顶层 API 段自带 catch-all 转发器);3) pi-handler e2b 分支注入内容改为 `X_BASE_URL=宿主反代地址` + `X_API_KEY=会话 token`(复用附件系统的沙盒回连宿主可达地址与 ATTACHMENT_SECRET 式 HMAC 凭据通道);4) 沙盒内 pi SDK 的 LLM 凭据(APISERVICES_API_KEY 经 models.json)同样把 baseURL 指向宿主反代、apiKey 填会话 token,最终清空 PROVIDER_KEY_NAMES 的 e2b 透传名单。本地 spawn 分支行为完全不变。注意:behavior.proxy/proxyFetch 是 CONNECT 正向代理接缝,不适用于凭据注入,勿走该路径。

## Introduction

e2b 云沙盒会话当前把 aigc 网关的真实 provider key(NEWAPI_API_KEY / SUFY_API_KEY / DASHSCOPE_API_KEY)经环境变量白名单透传进沙盒。沙盒内 agent 可执行任意命令,key 一旦进入沙盒即可被读取与外传(prompt injection 场景下为完整泄露),且 key 会经第三方沙盒控制面(Sandbox.create envs → Pod spec)留存。本特性引入宿主侧凭据注入代理:沙盒内 aigc 工具的上游请求改发宿主代理端点,由宿主校验会话短期凭据后替换为真实 key 再转发上游——真实 key 永不离开宿主进程边界。本地 spawn 运行环境行为完全不变。

## Boundary Context

- **In scope**:aigc 图像工具链(image_generation / image_edit 等经统一端点执行器发起的请求)的三个网关 newapi、sufy、dashscope;e2b 会话创建路径的凭据注入切换;宿主代理端点(鉴权、凭据注入、白名单上游、流式转发);会话短期凭据的签发与校验。
- **Out of scope**:pi SDK 的 LLM/视觉模型凭据收口(如 APISERVICES_API_KEY——容器内 models.json 由 pi-clouds 基础镜像的 entrypoint 生成,须该 entrypoint 支持自定义 baseURL 注入后另立 spec 处理,本特性不改其透传行为);CONNECT 正向代理接缝(behavior.proxy/proxyFetch,与凭据注入无关);本地 spawn 分支的任何行为改动;多租户/按用户的 key 管理。
- **Adjacent expectations**:沙盒到宿主的网络可达性沿用附件系统全远程拓扑已建立的前提(宿主地址对沙盒可达);会话凭据的签名密钥沿用既有主进程→子进程 secret 分发通道;上游网关(newapi/sufy/dashscope)的 API 行为不因本特性改变。

## Requirements

### Requirement 1: 代理模式的启用与切换

**Objective:** 作为部署 pi-web 的运维者,我想通过单一配置项启用宿主侧 key 代理,以便 e2b 沙盒会话不再持有 aigc 网关真实 key,且不影响既有部署。

#### Acceptance Criteria

1. Where 宿主配置了 aigc 代理对外可达地址, when 以 e2b 传输创建会话, the pi-web 服务 shall 向沙盒注入指向宿主代理的网关地址与该会话的短期凭据,且不向沙盒注入 newapi/sufy/dashscope 的真实 key。
2. Where 宿主未配置 aigc 代理地址, when 以 e2b 传输创建会话, the pi-web 服务 shall 沿用既有的 key 透传行为(向后兼容),并输出一条可识别的警告日志提示可启用代理模式。
3. While 会话经本地子进程传输运行, the pi-web 服务 shall 保持现有行为完全不变(工具直连既定上游,不经代理,不受代理配置影响)。
4. If 配置的代理对外可达地址不是合法的 http/https 地址, then the pi-web 服务 shall 在会话创建路径以携带修复指引的清晰错误使会话创建失败,不静默回退到 key 透传。

### Requirement 2: 代理端点的转发行为

**Objective:** 作为沙盒内运行的 aigc 工具,我想经宿主代理访问上游网关并获得与直连一致的响应,以便工具逻辑无需感知代理的存在。

#### Acceptance Criteria

1. When 代理端点收到携带有效会话凭据的请求, the 代理端点 shall 将请求中的凭据替换为对应 provider 的真实 key 并转发到该 provider 的既定上游,再把上游响应返回调用方。
2. The 代理端点 shall 仅接受预先登记的 provider 标识(newapi/sufy/dashscope);if 请求的 provider 不在登记表内, then the 代理端点 shall 拒绝请求且不发起任何上游请求。
3. The 代理端点 shall 转发已登记 provider 上游的任意子路径(含文生图、图像编辑、异步任务提交与轮询),无需逐路径登记。
4. When 转发请求体或响应体, the 代理端点 shall 保持流式语义:SSE 事件流与 multipart 上传均边到边传递,不得整体缓冲后再发送。
5. When 上游返回错误状态, the 代理端点 shall 把上游状态码与错误体(经脱敏)透传给调用方,使工具侧的错误识别与直连时一致。
6. If 上游不可达或转发超时, then the 代理端点 shall 向调用方返回表明网关故障的错误状态(502/504),且响应体不含真实 key。

### Requirement 3: 会话凭据的签发与鉴权

**Objective:** 作为安全负责人,我想让沙盒只持有与会话绑定、可过期的短期凭据,以便凭据即使泄露,影响也被限制在单会话与有限时间窗内。

#### Acceptance Criteria

1. When 以代理模式创建 e2b 会话, the pi-web 服务 shall 为该会话生成与会话标识绑定的短期凭据,该凭据不等于、也不可推导出任何真实 provider key。
2. The pi-web 服务 shall 使会话凭据的有效期覆盖该沙盒会话允许的最大存活时间(会话正常存续期间凭据不得先行失效)。
3. If 代理请求缺失凭据、凭据格式无效、签名不匹配或已过期, then the 代理端点 shall 返回 401 且不发起任何上游请求。
4. When 代理端点校验通过一个会话凭据, the 代理端点 shall 能从凭据中识别其所属会话标识(供日志审计与问题定位)。

### Requirement 4: 真实 key 零暴露

**Objective:** 作为安全负责人,我想确保代理模式下真实 provider key 永不离开宿主进程边界,以便沙盒内任意代码执行都无法窃取 key。

#### Acceptance Criteria

1. While 代理模式启用, the pi-web 服务 shall 不把 newapi/sufy/dashscope 的真实 key 写入沙盒环境变量、发往沙盒创建接口的参数或发往沙盒的任何数据帧。
2. The 代理端点 shall 不在日志、错误消息与返回给调用方的响应中输出真实 key(含替换后的 Authorization 头内容)。
3. When 记录代理请求日志, the 代理端点 shall 对凭据字段脱敏,仅保留可定位会话与 provider 的信息。

### Requirement 5: 工具侧透明重定向

**Objective:** 作为 agent 作者,我想让 aigc 工具在本地与沙盒两种运行环境下行为一致且无需改动 agent 代码,以便同一 agent 源可以不加区分地在两种环境运行。

#### Acceptance Criteria

1. Where 运行环境未提供网关地址覆盖, the aigc 工具路由 shall 使用既有默认上游地址,请求行为与现状完全一致(含 dashscope 异步任务的提交与轮询地址)。
2. Where 运行环境提供了网关地址覆盖, the aigc 工具路由 shall 把该网关的所有请求(含异步任务轮询)发往覆盖地址,工具的入参、产物形态与错误语义保持不变。
3. The 网关地址覆盖机制 shall 覆盖 newapi、sufy、dashscope 三个网关,并对每个网关可独立生效。
