# Requirements Document

## Introduction

本特性为 pi-web 的会话执行桥新增一个 **e2b 云沙盒传输后端**。当前 pi-web 的每个会话都在**本地** `child_process`(`PiRpcProcess`)里 spawn 一个 agent 子进程;本特性让 agent 子进程改在 **e2b 隔离云沙盒**里运行,用户仍通过现有 pi-web 网页(SSE/HTTP 前端**零改动**)与沙盒内的 agent 交互。

价值有三:(1) **隔离**——不可信 agent 代码在云沙盒里执行,不接触宿主机文件系统与凭据;(2) **可迁移**——为将来「控制面在本地/服务端、执行面在云端」的部署形态铺路;(3) **验证端口抽象**——`PiRpcChannel`/`SessionChannel` 端口自设计起就为 e2b/ssh/device 预留,本特性是第一个非 local 传输实现,验证该抽象是否真正可替换。

技术定位:通道注入点 `createPiWebHandler(opts.createChannel)` **已存在**(`create-handler.ts:89`),因此本特性**不改组合根**,只需(a)抽出传输无关的会话核心让 local 与 e2b 共享,(b)实现 e2b 传输通道,(c)在装配层按 `PI_WEB_TRANSPORT` env 注入对应的 `createChannel`。

**范围界定(PoC)**:目标是跑通**最小闭环**——起沙盒 → 投递最小 agent 源 → 网页发 prompt → 沙盒内 agent 流式回复 → 网页渲染。附件跨机器共享、多会话沙盒复用、保活/断线重连、生产级凭据分发等**明确标为二期**,本 spec 只保证「二期不需推翻一期的接口」。

## 术语

- **传输(Transport)**:承载「发送一行 / 逐行接收 / 关闭 / 健康」的底层双向 JSONL 通道,即 `PiRpcChannel` 的四方法(`send`/`onLine`/`close`/`health`)。local 实现是 `child_process` stdin/stdout;e2b 实现是沙盒内进程的 stdin/stdout。
- **会话核心(Session Core)**:在传输之上做「JSONL 分帧 + 三类消息(`response`/`event`/`extension_ui_request`)分发 + 命令封装(生成 id→send→等响应)」的传输无关逻辑,产出完整 `SessionChannel` 契约。当前内嵌在 `PiRpcProcess` 里,本特性将其抽出复用。
- **组合根(Composition Root)**:`createPiWebHandler` + 装配层 `lib/app/pi-handler.ts`,负责选择并注入 `createChannel`。

## Requirements

### Requirement 1: 传输无关的会话核心抽取
**Objective:** 作为 pi-web 维护者,我希望「JSONL 分帧 + 消息分发 + 命令封装」从本地进程传输中剥离为传输无关的会话核心,以便 local 与 e2b 两种传输共享同一套逻辑,避免在 e2b 通道里复制约 20 个命令方法与三类消息分发。

#### Acceptance Criteria
1. WHERE 存在一个只暴露传输四方法(`send`/`onLine`/`close`/`health`)的纯传输端口 THE SYSTEM SHALL 提供一个会话核心组件,消费该传输端口并对外产出满足完整 `SessionChannel` 契约的实例(`onEvent`/`onExtensionUIRequest`/`onExit`/`onStderr`/`respondExtensionUI` + 约 20 个命令方法)。
2. WHEN 会话核心收到一行 stdout THE SYSTEM SHALL 按 `\n` 严格分帧、剥除 `\r`、解析 JSON,并按消息类型分发:`response`(带 id)兑现对应待决命令 Promise、`event` 广播给 `onEvent` 监听器、`extension_ui_request` 登记并通知 `onExtensionUIRequest`。
3. WHEN 调用任一命令方法(如 `prompt`/`abort`/`setModel`) THE SYSTEM SHALL 生成唯一 id、经传输 `send` 写出、并返回一个在收到匹配 `response` 时兑现的 Promise。
4. IF 抽取后既有本地传输(`PiRpcProcess` 路径)复用同一会话核心 THEN THE SYSTEM SHALL 保持既有 `rpc-channel` 单元/集成测试全部通过(等价重构,行为不回归)。
5. WHERE 分帧逻辑已有独立实现(`JsonlLineReader`) THE SYSTEM SHALL 复用之,不重新实现分帧,且不使用 Node `readline`(避免误切 `U+2028/2029`)。

### Requirement 2: e2b 沙盒传输通道
**Objective:** 作为 pi-web 维护者,我希望有一个实现传输端口的 e2b 适配器,把「发送/接收/关闭/健康」映射到 e2b 沙盒内一个长驻 runner 进程的 stdin/stdout,以便 agent 在云沙盒里运行而会话核心无感。

#### Acceptance Criteria
1. WHEN e2b 传输被创建 THE SYSTEM SHALL 通过 e2b SDK 创建一个沙盒(`Sandbox.create`,携带 template、apiKey、timeout、env)并在其中以后台方式启动 runner 进程(`commands.run({ background: true })`,命令行等价于本地 `SpawnSpec.cmd`/`args`)。
2. WHEN 沙盒内 runner 进程向 stdout 输出一行 THE SYSTEM SHALL 经 `onStdout` 回调将该行交给传输的 `onLine` 监听器;AND stderr 经独立通道收集为日志/`onStderr`,**不混入** `onLine`(fd1 铁律:上行只走 stdout 帧通道)。
3. WHEN 调用传输 `send(line)` THE SYSTEM SHALL 将该行写入沙盒内 runner 进程的 stdin。
4. WHEN 调用传输 `close()` THE SYSTEM SHALL 终止沙盒内 runner 进程并销毁沙盒(`sandbox.kill`),且 `close()` resolve 后 `health().alive === false`。
5. WHERE 查询 `health()` THE SYSTEM SHALL 返回映射自沙盒/进程存活状态的 `{ alive, exitCode, signal }`。
6. IF 沙盒创建失败、runner 启动失败、或沙盒内进程崩溃 THEN THE SYSTEM SHALL 以结构化错误传播(对齐既有 `pi-rpc-process.errors` 的 `SpawnError`/`ChildCrashError`/`ChannelClosedError` 语义),并统一拒绝所有待决命令。
7. WHERE agent 源需在沙盒内可用 THE SYSTEM SHALL 通过约定的投递方式(PoC 阶段:自定义 e2b template 预装 node + pi SDK + 一个最小 agent 源)使 runner 能加载并运行 agent。

### Requirement 3: 组合根按环境切换传输
**Objective:** 作为部署者,我希望通过环境变量在「本地进程」与「e2b 沙盒」之间切换执行后端,以便同一套 pi-web 代码既能本地开发也能云沙盒运行,且默认行为不变。

#### Acceptance Criteria
1. WHERE 环境变量 `PI_WEB_TRANSPORT` 未设置或为 `local` THE SYSTEM SHALL 使用本地进程传输(默认 `defaultCreateChannel` 行为),既有部署零变化。
2. WHEN `PI_WEB_TRANSPORT=e2b` THE SYSTEM SHALL 由装配层注入一个 `createChannel`,使新建会话经 e2b 传输通道创建 agent。
3. WHERE 选择 e2b 传输但缺少必要配置(如 `E2B_API_KEY` 或 template id) THE SYSTEM SHALL 在会话创建路径以清晰错误失败(不静默回退到 local,避免「以为在沙盒里其实在本地」的隐患)。
4. IF 注入 e2b `createChannel` THEN THE SYSTEM SHALL **不修改** `createPiWebHandler` 组合根与前端(react transport / SSE / stream-route),接入仅发生在装配层与 rpc-channel 层。

### Requirement 4: 前端与协议零改动(透明替换)
**Objective:** 作为前端与协议维护者,我希望 e2b 接入对前端与协议契约完全透明,以便切换执行后端不触发 `@blksails/pi-web-protocol` 的 semver 变更,也不改任何 UI/transport 代码。

#### Acceptance Criteria
1. WHEN 会话经 e2b 传输运行 THE SYSTEM SHALL 向前端发送与 local 传输**逐字节同构**的 SSE 帧序列(同一 `protocolVersion`,同一帧类型集)。
2. IF 本特性合入 THEN THE SYSTEM SHALL 不新增/修改 `@blksails/pi-web-protocol` 的任何 zod schema 或类型(执行桥替换不属于协议变更)。
3. WHERE 用户在网页发起 prompt / abort / 切换模型等操作 THE SYSTEM SHALL 使沙盒内 agent 的行为与本地运行时对用户不可区分(除首次冷启延迟外)。

### Requirement 5: 最小闭环可用性(PoC 验收面)
**Objective:** 作为验收者,我希望能端到端验证「网页操作 e2b 沙盒里的 agent」这一最小闭环,以便确认执行桥抽象在真实 e2b 上成立。

#### Acceptance Criteria
1. WHEN 以 `PI_WEB_TRANSPORT=e2b` 启动 pi-web 并在网页新建会话 THE SYSTEM SHALL 在 e2b 沙盒内起会话并使网页进入可交互状态(就绪握手容忍沙盒冷启延迟)。
2. WHEN 用户在该会话发送一条 prompt THE SYSTEM SHALL 由沙盒内 agent 处理并将回复以流式 SSE 帧回传网页渲染。
3. WHEN 会话被删除或空闲回收 THE SYSTEM SHALL 终止 runner 进程并销毁对应 e2b 沙盒,不泄漏沙盒(避免持续计费)。
4. WHERE 就绪探针(getCommands)在 e2b 冷启期间超时窗口内 THE SYSTEM SHALL 采用与本地一致的就绪握手机制判定真实就绪,不提前放行。

### Requirement 6: 本地假设的显式绕过与边界(二期锚点)
**Objective:** 作为维护者,我希望一期明确标注并安全绕过那些隐含本地文件系统/进程假设的机制,以便一期最小闭环成立,同时不给二期埋下需要推翻接口的坑。

#### Acceptance Criteria
1. WHERE 运行在 e2b 传输下 THE SYSTEM SHALL 不依赖 `PI_RUNNER_HOT_RELOAD`(本地文件监听热重载在沙盒内无意义,应关闭或空实现)。
2. WHERE 运行在 e2b 传输下 THE SYSTEM SHALL 不依赖宿主机 `project-trust` 的 cwd 路径信任语义(沙盒内路径独立)。
3. IF 一期未接入跨机器共享的附件 blob 后端 THEN THE SYSTEM SHALL 在 e2b 会话中禁用或不启用附件相关能力(不产生本地磁盘签名 URL,避免 401),并在文档中标注附件为二期(依赖 cloud-http/UnionBlobStore 共享后端 + 两端 `PI_WEB_ATTACHMENT_SECRET` 一致)。
4. WHERE 定义 e2b 传输接口 THE SYSTEM SHALL 使二期(附件共享、沙盒复用、保活重连)可作为增量实现,不要求推翻一期的传输/会话核心接口。

### Requirement 7: 测试与验证(项目硬规则)
**Objective:** 作为项目质量守门人,我希望本特性满足 pi-web「单元 + 集成 + e2e 且有新鲜运行证据」的硬规则,以便合入前有可复现的通过证据。

#### Acceptance Criteria
1. THE SYSTEM SHALL 为会话核心与 e2b 传输提供单元测试,使用 mock 传输/mock e2b SDK(不真连 e2b),覆盖分帧、命令 id 匹配、send、close、health、错误传播。
2. THE SYSTEM SHALL 提供一个针对**真实 e2b 沙盒**的集成测试或可复现脚本,起最小 agent 跑通一轮 prompt→流式回复(可在缺少 `E2B_API_KEY` 时跳过并明确报告跳过)。
3. THE SYSTEM SHALL 提供一个 e2e 检查,验证网页在 `PI_WEB_TRANSPORT=e2b` 下的最小闭环(或在无凭据环境下以 stub 传输验证装配层切换路径)。
4. IF 会话核心从 `PiRpcProcess` 抽出 THEN THE SYSTEM SHALL 使既有 `rpc-channel` 与会话层测试在重构后全部通过(回归证据)。
5. THE SYSTEM SHALL 保持 TypeScript `strict`、无 `any`,遵循周边代码既有风格。
