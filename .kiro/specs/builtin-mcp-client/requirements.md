# Requirements Document

## Introduction

pi-web 目前的 MCP 支持依赖外部扩展 `pi-mcp-adapter`:MCP 配置面「装了该扩展才出现」,且只提供一个不带结构约束的原始 JSON 文本编辑入口。用户要接入一个 MCP server,既要先知道该装哪个扩展,又要手写符合该扩展私有约定的 JSON,出错后也缺少可定位的反馈。

本特性把 **MCP 客户端能力内置进 pi-web 核心**:用户无需安装任何扩展即可连接外部 MCP server,把其 tools / resources / prompts 注入 agent 会话;支持 **stdio、SSE、Streamable HTTP** 三种标准 MCP 传输,以覆盖本地进程型与远程服务型 server;配置沿用 pi-web 既有配置域范式,但从裸 JSON **升级为结构化表单**——按所选传输协议呈现对应字段,凭据字段按既有掩码语义保护。

## Boundary Context

- **In scope**:pi-web 作为 **MCP 客户端**连接外部 MCP server;三种标准传输(stdio / SSE / Streamable HTTP)的接入;已连接 server 的 tools / resources / prompts 在 agent 会话中可用;MCP 配置的结构化表单与凭据保护;连接状态与失败原因的可观测;从既有 MCP 配置的平滑迁移。
- **Out of scope**:pi-web **不**作为 MCP server 对外暴露自身能力;不支持标准三种之外的传输(如 WebSocket);不负责实现、托管或分发 MCP server 本身;不改变 agent 调用工具的既有交互形态。
- **Adjacent expectations**:本特性依赖 pi-web 既有的配置持久化与设置界面范式承载 MCP 配置,依赖既有会话与工具调用呈现机制展示 MCP 工具的调用与结果;它**不拥有**这两者的通用行为,只在其上增加 MCP 专有的配置与能力。已安装 `pi-mcp-adapter` 的用户,其既有 MCP 配置内容应继续有效。

## Requirements

### Requirement 1: MCP 服务器配置与连接管理

**Objective:** 作为 pi-web 用户,我想配置并管理一个或多个外部 MCP server 的连接,以便把外部工具接入我的 agent 会话。

#### Acceptance Criteria

1. The pi-web shall 支持同时配置零个或多个 MCP server 条目,且每个条目具有在配置内唯一的名称。
2. When 用户新增一个 MCP server 条目并保存, the pi-web shall 持久化该条目,并在下次读取配置时原样呈现其内容。
3. When 会话启动, the pi-web shall 对全部处于启用状态的 MCP server 条目发起连接。
4. Where 某个 MCP server 条目处于禁用状态, the pi-web shall 跳过对该条目的连接,且不把其任何能力注入会话。
5. If 某个 MCP server 连接失败, then the pi-web shall 继续完成会话启动并保持其余功能可用。
6. When 用户删除某个 MCP server 条目并保存, the pi-web shall 结束与该 server 的连接,且其能力不再出现在后续会话中。

### Requirement 2: 多传输协议支持

**Objective:** 作为 pi-web 用户,我想按目标 MCP server 实际提供的接入方式选择传输协议,以便本地进程型与远程服务型 server 都能接入。

#### Acceptance Criteria

1. The pi-web shall 支持 stdio、SSE、Streamable HTTP 三种 MCP 传输协议。
2. When 用户为某个条目选择 stdio 传输, the pi-web shall 要求提供启动命令,并允许提供启动参数与环境变量。
3. When 用户为某个条目选择 SSE 或 Streamable HTTP 传输, the pi-web shall 要求提供服务端地址,并允许提供自定义请求头。
4. When 用户切换某个条目的传输协议, the pi-web shall 呈现该协议对应的字段集合,且不再要求填写不适用于该协议的字段。
5. If 用户提交的条目缺少所选传输协议的必填字段, then the pi-web shall 拒绝保存该条目,并给出指明缺失字段的提示。

### Requirement 3: MCP 能力注入 agent 会话

**Objective:** 作为 pi-web 用户,我想让已连接 MCP server 提供的能力在会话中可用,以便 agent 直接调用外部工具完成任务。

#### Acceptance Criteria

1. When 某个 MCP server 连接成功, the pi-web shall 把该 server 声明的 tools 提供给当前会话的 agent 调用。
2. Where 某个已连接的 MCP server 声明了 resources 或 prompts, the pi-web shall 使其在当前会话中可被访问。
3. When agent 调用某个 MCP 工具, the pi-web shall 把调用结果回流到会话,并按 pi-web 既有的工具调用形态呈现。
4. If 两个已连接的 MCP server 声明了同名工具, then the pi-web shall 以可区分的方式呈现二者,使用户与 agent 能够明确指向其中之一。
5. If 某次 MCP 工具调用失败, then the pi-web shall 在会话中呈现该次失败,并保持会话可继续使用。

### Requirement 4: 结构化配置界面

**Objective:** 作为 pi-web 用户,我想在既有设置界面中以结构化表单管理 MCP 配置而非手写原始 JSON,以便降低配置门槛并减少出错。

#### Acceptance Criteria

1. The pi-web shall 在既有配置界面的 MCP 配置面中以结构化表单呈现 MCP server 条目,而非原始 JSON 文本输入。
2. When 用户打开 MCP 配置面, the pi-web shall 列出全部已配置条目及其名称、所选传输协议与启用状态。
3. Where 某个字段承载凭据(如访问令牌、密钥或含密的环境变量), the pi-web shall 以掩码形式呈现该字段,且不把已保存的明文回读到浏览器。
4. When 用户提交对某个条目的修改, the pi-web shall 保存该修改,并使其在此后新建的会话中生效。
5. The pi-web shall 允许用户在不删除条目的前提下切换该条目的启用与禁用状态。

### Requirement 5: 内置化与既有配置迁移

**Objective:** 作为 pi-web 用户,我想开箱即用 MCP 而无需另行安装扩展,同时让我此前已有的 MCP 配置继续有效,以便升级过程不丢失配置。

#### Acceptance Criteria

1. The pi-web shall 在未安装任何额外扩展的情况下提供完整的 MCP 客户端能力。
2. The pi-web shall 始终呈现 MCP 配置面,不以「某个扩展是否已安装」作为该配置面的可见条件。
3. When 用户在启用本特性前已配置过 MCP server, the pi-web shall 读取这些既有条目并在配置面中呈现。
4. If 既有配置中存在 pi-web 无法识别的条目或字段, then the pi-web shall 保留该内容而不擅自丢弃,并提示用户存在未被识别的部分。

### Requirement 6: 连接状态与错误可观测

**Objective:** 作为 pi-web 用户,我想看到每个 MCP server 的连接状态与失败原因,以便快速定位并修正配置问题。

#### Acceptance Criteria

1. When 用户查看 MCP 配置面, the pi-web shall 呈现每个已启用条目的当前连接状态。
2. If 某个 MCP server 连接失败, then the pi-web shall 呈现足以定位问题的失败原因。
3. While 某个 MCP server 正处于连接过程中, the pi-web shall 呈现其处于连接中的状态。
4. When 用户修正配置后重新发起连接, the pi-web shall 呈现本次连接的最新结果。

### Requirement 7: 凭据保护

**Objective:** 作为 pi-web 用户,我想让 MCP 配置中的凭据得到妥善保护,以便接入远程 server 不引入泄露风险。

#### Acceptance Criteria

1. The pi-web shall 不把 MCP 配置中的凭据以明文写入日志。
2. When 用户读取 MCP 配置, the pi-web shall 对凭据字段返回掩码而非明文。
3. When 用户提交配置且未修改某个凭据字段, the pi-web shall 保持该凭据原值不变。
4. When 用户显式清除某个凭据字段, the pi-web shall 移除该凭据的已保存值。
