# Requirements Document

## Project Description (Input)

附件系统两切片之二(场景 ②:文件给 server 端 tool 用 + 产出物回流 + context 闸门)。依赖前置切片 `attachment-store`(L0 对象存储 + L1 描述符/`att_<nanoid>` id + 上传/分发端点)。

用户上传的文件(图)需要交给 **server 端 tool** 执行图像编辑/生成,且 tool **产出的新文件要回流**到对话与下一轮;同时 base64 一旦进 pi transcript 会被**逐轮复读**,撑爆 context。pi 协议层帮不上忙:`AgentTool.content` 仅 `text | image`(`ImageContent.data` 只有裸 base64 string),**没有文件引用原语**;给 tool 传文件的唯一通道,是把 `attachmentId` 当 tool 的 JSON 参数(`ToolCall.arguments`),tool 在 `execute` 内带外解析;而 **tool `execute` 运行在 runner 子进程**(非 pi-web 主进程,pi 不走 MCP),故 store 必须在子进程侧可达且指向与主进程同一后端。

本切片补全 L2 投影(`resolve` 句柄:path/url/bytes,S3 localPath 懒下载留接口)、runner 子进程 store 实例化、`AgentTool` 接入范式(至少一个端到端示例 tool)、`beforeToolCall` 属主校验、`afterToolCall` base64 剥离闸门、文本引用注入到 prompt、tool-output 落库回流(同一 id 空间,闭合跨轮回环)。**第一版不做智能意图路由**:给 tool 的文件走显式 `attachmentId` 参数;上传图给 LLM 看维持 `attachment-store` 现状 base64。

守三不变式:**单一身份**(公开 id 唯一,只能由 server `put()` 铸造)、**先落库后引用**(产出物先落库再回流)、**base64 仅具名出口物化**(base64 只在 build prompt 与 tool result 物化出口两处出现)。

## Boundary Context

- **In scope(本 spec 负责)**:
  - L2 `AttachmentHandle` / `resolve(id)`:派生 `bytes()`、`stream()`、`localPath()`、`url()` 四种访问形态;LocalFs `localPath()` 直返落盘路径;S3 `localPath()` 懒下载临时文件 + 临时文件回收(本切片 LocalFs 落地,S3 留可切换接口)。
  - runner 子进程 store 实例化:经 spawn env 下发后端配置(本地=共享目录路径),子进程内构造 store 客户端,与主进程指向同一后端,**不回调主进程**。
  - `AgentTool` 接入范式 + `agent-kit` 把 store 暴露给 `defineTool.execute`;至少一个端到端示例 tool(覆盖 path/url/bytes 三种 resolve 用法)。
  - `beforeToolCall` 属主校验(校验该 session 是否拥有 tool 参数中的 `attachmentId`,否则 `block`)+ `afterToolCall` base64 剥离闸门(默认把 tool result 里的 base64 剥成文本引用,除非标记需复看),经 runner / `AgentLoopConfig` 接入。
  - tool-output 落库回流:产出物经 `store.put({origin:"tool-output"})` 先落库拿新 `att_` id,再以引用回流;该 id 与上传 id **同一空间**,可被下一轮用户消息再次引用。
  - 文本引用注入:build prompt 时把附件以 `[attachment id=att_… type=… name=…]` 注入用户消息文本,模型据此把 id 抄进 tool 参数。
  - tool result 默认回"引用 + 一句话",可选回 base64(`ImageContent.data` 必须已 await 成 string)。
  - 单元/集成测试 + 浏览器 e2e(隔离 build),以新鲜运行证据证明。
- **Out of scope(交由 `attachment-store` / future)**:
  - 对象存储后端本体、上传 `POST /attachments`、分发 `GET /attachments/:id/raw`、前端上传/摄入/展示重构 —— 属 `attachment-store`(本切片仅复用其 `BlobStore`/`Attachment`/目录约定/`/raw` URL)。
  - 智能意图路由(模型自决 / UI 显式标注)—— future。
  - 改造 vision 侧 base64→LLM(`prompt({images})` 维持现状)。
  - S3 后端真实实现(`resolve`/`localPath` 接口按可切换设计,S3 实现 future)。
  - pi transcript 内已落 base64 的事后清理(pi 子进程持有,不可逆;闸门只前移防御)。
- **Adjacent expectations(对相邻系统/spec 的期待)**:
  - `attachment-store`:提供 `BlobStore` 端口、`Attachment` 描述符类型、`att_<nanoid>` 公开 id、`AttachmentOrigin`(含已预留的 `tool-output`)、`AttachmentStore` 门面(含只读访问器 `localPath(id)`/`listBySession(sessionId)`)、`BlobMeta`(`getReadStream` 的 meta 类型)、`attachmentStoreConfigFromEnv` 等受认可复用面、`PI_WEB_ATTACHMENT_DIR` 目录约定、`/raw` 分发 URL 与签名方案。**并由 store 经 spawn env 全权下发 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`**(本切片不编辑该 spawn env,仅校验子进程已收到)。本切片复用上游门面与类型,不重新定义、不抠门面内部。
  - `agent-runner`:提供 runner 子进程(jiti 载入 `index.ts` → `createAgentSessionRuntime` → `runRpcMode`)、`option-mapper` 注入 `customTools`、`assemble-spawn` 的 `buildEnv` spawn env 下发范式、`AgentContext`。本切片在其上注入 store 与 hook。
  - `agent-kit`:提供 `defineAgent`/`defineTool` re-export。本切片在其上暴露 store 给 tool 作者。
  - `session-engine`:提供会话属主校验与 prompt/消息构造接缝(文本引用注入处)。
  - pi 协议(`@earendil-works/pi-ai`、`pi-agent-core`):`AgentTool.content` 仅 `(TextContent|ImageContent)[]`、`ImageContent.data:string`、`Tool.description`/`AgentToolResult.details` 必填、`AgentLoopConfig.beforeToolCall`(可 `block`)/`afterToolCall`(可改写 `content`/`details`)。本切片在此协议约束内接入。

## Requirements

### Requirement 1: L2 附件投影句柄(resolve)

**Objective:** 作为 server 端 tool 作者,我想要按公开 id 把附件 `resolve` 成我需要的具体形态(原始字节 / 可读流 / 本地路径 / 网络 URL),以便不同 tool(图像编辑、放大、生成)都能从同一引用取到它要消费的数据。

#### Acceptance Criteria

1. When tool 以一个已落库附件的公开 id 请求解析,the Attachment Bridge shall 返回一个携带该附件元数据(至少 mimeType、文件名、大小、来源、所属会话)且提供原始字节、可读流、本地路径、网络 URL 四种访问形态的解析句柄。
2. When 解析句柄被请求其原始字节或可读流,the Attachment Bridge shall 从所属后端读取该附件内容并以字节或流形态返回。
3. When 解析句柄被请求本地路径且后端为本地文件系统,the Attachment Bridge shall 直接返回该附件在共享存储目录中的落盘路径,而不复制内容。
4. Where 后端为远程对象存储(S3 风格),the Attachment Bridge shall 在请求本地路径时将内容懒下载为临时文件并返回该临时文件路径;本切片以可切换接口承载该形态,远程后端的真实实现留待 future。
5. When 解析句柄被请求网络 URL,the Attachment Bridge shall 返回一个客户端可达的展示 URL(复用 `attachment-store` 的分发/签名方案),其形态与远程对象存储预签名保持同形。
6. If 被解析的公开 id 不存在或不可读,then the Attachment Bridge shall 返回一个可与"成功"明确区分、可被调用方按类型识别的失败结果,而不返回空内容当作成功。

### Requirement 2: 临时文件生命周期与回收

**Objective:** 作为平台工程师,我想要懒下载产生的临时文件有明确的回收策略,以便远程后端场景下临时文件不会随会话累积而堆积占满磁盘。

#### Acceptance Criteria

1. When 一次本地路径解析为远程附件创建了临时文件,the Attachment Bridge shall 记录该临时文件以便后续回收。
2. When 一次工具调用结束,the Attachment Bridge shall 回收该次调用期间为远程附件创建的临时文件。
3. When 一个会话结束,the Attachment Bridge shall 回收该会话残留的、尚未被回收的临时文件。
4. While 后端为本地文件系统,the Attachment Bridge shall 不创建临时文件,因为本地路径直接指向落盘文件(无需回收)。

### Requirement 3: runner 子进程 store 实例化

**Objective:** 作为平台工程师,我想要 runner 子进程能在本进程内实例化一个指向与主进程同一后端的 store 客户端,以便运行在子进程的 tool `execute` 能解析/落库附件,而无需回调主进程。

#### Acceptance Criteria

1. The Attachment Bridge shall 在 runner 子进程内实例化一个 store 客户端,服务子进程侧的附件解析与落库。
2. The Attachment Bridge shall 经 spawn 环境变量(`PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`,均由 `attachment-store` 全权下发,本切片不编辑该 spawn env、仅消费与校验)获取后端配置(本地后端为共享存储目录约定 + 一致签名 secret),使子进程实例化的 store 指向与主进程同一后端且签名 secret 一致。
3. While tool `execute` 在 runner 子进程运行,the Attachment Bridge shall 通过子进程内的 store 客户端直接访问后端,而不向主进程回调或发起跨进程请求来解析或落库附件。
4. While 后端配置未经 spawn 环境下发(缺省或未配置附件存储),the Attachment Bridge shall 以可被 tool 识别的方式表明附件能力不可用,而不以未定义行为崩溃子进程。

### Requirement 4: AgentTool 协议兼容接入与示例 tool

**Objective:** 作为 tool 作者,我想要一个在 pi `AgentTool` 协议约束内、能拿到 store 的接入范式与可参照的示例 tool,以便我能写出接收 `attachmentId` 参数、解析输入、产出新附件并回流的图像类 tool。

#### Acceptance Criteria

1. The Attachment Bridge shall 提供一种让 tool 在其执行逻辑内取得子进程 store 客户端的接入方式,使 tool 能以公开 id 解析输入附件并落库产出附件。
2. The Attachment Bridge 接入范式 shall 以 `attachmentId` 作为 tool 的显式调用参数承载输入附件引用,而不依赖任何 pi 协议中不存在的文件引用原语。
3. When 示例 tool 返回图像内容给模型,the Attachment Bridge shall 保证该图像内容的数据字段为已等待求值得到的字符串(裸 base64),而不是未求值的 Promise,以符合 pi `ImageContent.data` 为字符串的约束。
4. The Attachment Bridge 接入范式 shall 为每个 tool 提供必填的描述(`description`)与必填的结构化结果明细(`details`),以符合 pi `Tool.description` 与 `AgentToolResult.details` 必填约束。
5. The Attachment Bridge shall 提供至少一个端到端示例 tool,演示本地路径、网络 URL、原始字节三种解析用法,以及产出物落库回流。

### Requirement 5: beforeToolCall 属主校验

**Objective:** 作为安全负责人,我想要在 tool 执行前校验该会话是否拥有其参数中引用的 `attachmentId`,以便阻止越权解析他人会话的附件。

#### Acceptance Criteria

1. When 一次工具调用的参数携带 `attachmentId`,the Attachment Bridge shall 在该工具执行前校验当前会话是否为该附件的属主。
2. If 当前会话不是被引用 `attachmentId` 的属主,then the Attachment Bridge shall 阻止(block)该工具执行,使其不进入 `execute`。
3. If 被引用的 `attachmentId` 不存在,then the Attachment Bridge shall 阻止该工具执行,而不把不存在的引用当作可解析。
4. While 工具调用参数不携带任何 `attachmentId`,the Attachment Bridge shall 放行该工具,不因属主校验而阻断与附件无关的工具调用。

### Requirement 6: afterToolCall base64 剥离闸门

**Objective:** 作为关注 context 成本的用户,我想要工具结果默认只回引用与简短文本、把内联 base64 剥离,以便 base64 不被逐轮复读撑爆 context,且这套省 context 逻辑集中实现而非每个 tool 各写一遍。

#### Acceptance Criteria

1. When 一次工具调用返回了包含内联 base64 图像的结果,the Attachment Bridge shall 在结果回到模型对话历史前,默认把该 base64 图像剥离并以文本引用(指向其公开 id 的引用描述)替代。
2. Where 工具结果被显式标记为需要模型复看,the Attachment Bridge shall 保留该图像内容的物化形态(已 await 的 base64 字符串),不予剥离。
3. The Attachment Bridge shall 在统一的结果出口集中实现该剥离闸门,使各 tool 无需各自编写省 context 逻辑。
4. While 工具结果不含内联 base64,the Attachment Bridge shall 原样透传该结果,不改写无 base64 的内容与明细。

### Requirement 7: tool-output 落库回流与同一 id 空间

**Objective:** 作为聊天用户,我想要 tool 产出的新文件先落库再以引用回流到对话,并能在下一轮消息中再次引用它,以便闭合"产出物→下一轮输入"的跨轮回环。

#### Acceptance Criteria

1. When 一个 tool 产出新文件,the Attachment Bridge shall 在把产出物回流到对话之前,先将其写入对象存储并铸造公开 id(来源标记为 `tool-output`),实现先落库后引用。
2. The Attachment Bridge shall 使 tool-output 产出附件的公开 id 与上传附件处于同一 id 空间,使其可被后续用户消息以相同的引用方式再次引用。
3. While 产出附件已落库,the Attachment Bridge shall 以引用(公开 id 与展示 URL)而非内联字节回流该产出物,使展示侧可经既有分发 URL 呈现。
4. If 产出物落库失败,then the Attachment Bridge shall 不向对话回流一个半落库或不存在的引用,而以可识别的失败表明产出未成功。

### Requirement 8: prompt 文本引用注入

**Objective:** 作为聊天用户,我想要我附带的附件以可读的文本引用出现在发给模型的消息里,以便模型知道有哪些附件、能把对应的公开 id 抄进工具参数去调用 tool。

#### Acceptance Criteria

1. When 构造发往模型的用户消息且该消息附带已落库附件,the Attachment Bridge shall 在用户消息文本中注入每个附件的文本引用,至少包含其公开 id、类型与文件名。
2. The Attachment Bridge shall 使注入的文本引用采用稳定、可被模型据以抄取公开 id 的结构化标记形态。
3. While 一条用户消息不附带任何附件,the Attachment Bridge shall 不向该消息注入附件文本引用。
4. The Attachment Bridge shall 仅注入文本引用而不在该注入路径上内联附件的 base64 字节,使引用注入不成为 base64 进入 transcript 的额外出口。

### Requirement 9: base64 仅具名出口(不变式守护)

**Objective:** 作为审阅者,我想要 base64 在本切片只出现在两个具名出口,以便守住"base64 仅具名出口物化"的不变式、可审计、不在派生层泄漏。

#### Acceptance Criteria

1. The Attachment Bridge shall 仅在两个具名出口物化 base64:其一为 build prompt 时按现状把图发给模型(vision,维持 `attachment-store` 现状);其二为工具结果被显式标记需复看时保留的图像内容。
2. The Attachment Bridge L2 解析句柄 shall 以字节、流、本地路径、网络 URL 形态承载附件,而不以 base64 作为解析句柄的默认或必经表示。
3. While 工具结果未被标记需复看,the Attachment Bridge shall 不在工具结果出口物化 base64(由剥离闸门保证)。

### Requirement 10: 测试与验证证据

**Objective:** 作为审阅者,我想要本切片以单元/集成测试与浏览器 e2e 证明端到端可用,且测试运行不污染开发态构建,以便以新鲜运行证据接受该切片。

#### Acceptance Criteria

1. The Attachment Bridge shall 配备单元/集成测试,覆盖 L2 解析四形态、临时文件回收、子进程 store 实例化指向同一后端、属主校验阻断越权、base64 剥离闸门、tool-output 落库回流等核心行为。
2. The Attachment Bridge shall 配备浏览器端到端验证,覆盖"上传→tool 以公开 id 解析→执行→产出落库→引用回流→前端经分发 URL 展示"的完整链路。
3. While 运行端到端验证,the Attachment 验证流程 shall 使用隔离的构建产物(独立 dist 目录),不污染开发态使用的默认构建产物。
4. The Attachment Bridge shall 以新鲜运行的测试/e2e 证据证明上述行为通过,而非仅以代码存在为由声称完成。

## 增量:hydrate/血缘领域无关 seam(2026-07-02)

**Objective:** 作为上层 surface(如 Canvas)的作者,我想要在 `AttachmentToolContext` 上多两个领域无关的存取 seam,以便做「重建会话已产附件列表」与「持久不透明血缘/派生 meta」,而不需 attachment 层理解任何领域语义。

### Acceptance Criteria
1. The Attachment Tool Context shall 暴露 `listBySession(): Promise<Attachment[]>`,枚举上下文闭包绑定的当前会话的附件描述符(不含字节)。
2. The Attachment Tool Context shall 暴露 `getMeta(id)`/`setMeta(id, meta)`,把调用方传入的任意 JSON 原样持久到该附件描述符旁路文件的一个不透明扩展字段(`ext`),不解释其结构。
3. While 某附件从未 `setMeta`,the Attachment Tool Context shall `getMeta` 返回 `undefined`。
4. The Attachment Tool Context shall 在存储能力不可用时对上述三个方法同样安全拒绝(抛 `AttachmentCapabilityUnavailableError`),与既有 `resolve`/`putOutput` 一致。
