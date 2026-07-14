# Requirements Document

## Project Description (Input)
agent 具名附件 profile。依据 docs/attachment-union-store-design.md §4(Spec 2 范围),依赖已实现的 attachment-backend-pluggable:agent 定义新增可选 `attachmentProfile` 字段(纯字符串,引用宿主注册的具名后端);装配期投影给主进程做白名单校验,未注册名字 → 会话创建失败;本质 = 按会话覆盖组合后端的写路由;读/分发已由描述符后端绑定权威承担;凭据/端点全在宿主;运维关断 env 关断时忽略声明回宿主默认。

**问题归属**:多 agent 共享宿主的运维者与需要把特定 agent 产物定向到特定存储的 agent 作者——现状写路由是宿主级单一默认,agent 无法表达「我的产物落哪」。

## Introduction

`attachment-backend-pluggable` 交付了多具名后端并存与「宿主级默认写入目标」。本 spec 把写入目标的选择权下放到 agent 声明面:agent 作者在定义中以**纯名字**引用宿主注册的某个后端,该 agent 的会话新写入附件(浏览器上传与工具产物)即落到该后端。名字必须命中宿主白名单——agent 永远接触不到凭据与端点;读取与签名分发继续由附件描述符上已固化的后端绑定权威路由,与会话及 agent 进程的生死无关。不声明的 agent 与既有部署完全不受影响。

## Boundary Context

- **In scope**:agent 定义的可选 profile 声明;声明向主进程的投影与白名单校验(未注册 → 会话创建失败);该会话两条写入路径(前端上传、子进程工具产物)按 profile 落库;运维关断开关。
- **Out of scope**:按 route/按工具粒度的写路由(YAGNI,本 spec 仅会话粒度);运行期动态切换 profile(声明装配期一次性生效);后端实现、读路由、探测链、描述符绑定语义(归 `attachment-backend-pluggable` 拥有,本 spec 只消费);agent source 分发/安装链路。
- **Adjacent expectations**:依赖 `attachment-backend-pluggable` 提供的具名后端拓扑、组合写路由接缝与描述符后端绑定;依赖既有装配期声明帧机制(agent 声明 slash 补全 / routes 的同族通道)作投影载体;不改变其中任何一方的既有对外语义。

## Requirements

### Requirement 1: agent 声明面与默认不受影响

**Objective:** As a agent 作者, I want 在 agent 定义里用一个名字声明产物落库目标, so that 不接触任何存储配置即可定向产物存储。

#### Acceptance Criteria
1. The agent 定义契约 shall 提供一个可选的附件 profile 字段,取值为宿主注册的后端名(纯字符串)。
2. While agent 定义未声明附件 profile, the 附件系统 shall 维持宿主默认写入目标,行为与本特性引入前完全一致。
3. The agent 声明面 shall 仅接受后端名字,不提供任何声明凭据、端点或存储参数的途径。

### Requirement 2: 白名单校验与会话创建失败

**Objective:** As a 宿主运维者, I want agent 声明的 profile 必须命中我注册的后端白名单, so that agent 无法把宿主数据导向未经我批准的存储位置。

#### Acceptance Criteria
1. When 会话装配时 agent 声明了附件 profile 且该名字在宿主声明的后端集合中, the 会话装配层 shall 接受声明并使其对该会话生效。
2. If agent 声明的 profile 名字未在宿主声明的后端集合中(含宿主未声明任何多后端拓扑的情形), then the 会话装配层 shall 使会话创建失败,并给出包含该名字的明确错误。
3. The 会话装配层 shall 以纯数据形式接收 agent 的 profile 声明,agent 侧代码不参与主进程的校验与后端实例化。

### Requirement 3: 会话级写路由生效

**Objective:** As a agent 作者, I want 我的 agent 会话产生的新附件都落到声明的后端, so that 产物存储位置可预期且与其他 agent 隔离。

#### Acceptance Criteria
1. While 某会话的 agent 声明了有效 profile, when 该会话经前端上传附件, the 附件系统 shall 将字节写入该 profile 指向的后端,且附件描述符固化该后端名。
2. While 某会话的 agent 声明了有效 profile, when 该会话的工具在子进程内落库产物附件, the 附件系统 shall 将字节写入同一 profile 指向的后端,且附件描述符固化该后端名。
3. While 一个声明了 profile 的会话与一个未声明的会话并存, the 附件系统 shall 使二者的新写入分别落各自目标(profile 后端 / 宿主默认),互不影响。

### Requirement 4: 读取与分发不受会话生命周期影响

**Objective:** As a 终端用户, I want profile 会话产生的附件在会话结束后仍可正常显示, so that 会话历史完整可回放。

#### Acceptance Criteria
1. When 读取或签名分发一个由 profile 会话落库的附件, the 附件系统 shall 按描述符固化的后端绑定路由,不依赖该会话或 agent 进程仍然存活。
2. When 服务重启后收到对 profile 会话历史附件的有效签名分发请求, the 附件系统 shall 正常返回字节。

### Requirement 5: 运维关断

**Objective:** As a 宿主运维者, I want 一个开关整体关断 agent 的 profile 声明能力, so that 出现问题时可立即回收下放的选择权而不中断服务。

#### Acceptance Criteria
1. While 关断环境变量生效, when 会话装配遇到 agent 的 profile 声明, the 会话装配层 shall 忽略该声明并回落宿主默认写入目标,会话正常创建(不失败)。
2. While 关断环境变量生效, the 附件系统 shall 对未声明 profile 的 agent 保持行为完全不变。
