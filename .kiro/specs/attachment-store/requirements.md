# Requirements Document

## Project Description (Input)

附件系统两切片之一(基础层 L0 + L1)。

当前附件能力仅覆盖「图片 + 内存 base64」:前端 `useAttachments` 用 `FileReader` 把文件读成 data URL 存内存,提交时抽裸 base64 经 `prompt({images})` 发给 LLM,历史回显再重建 `data:` URL。带来四个痛点:无持久化(刷新即丢)、撑大体积(base64 膨胀 ~33% 且进消息历史/DOM)、仅图片(非图片一律 rejected)、server 端 tool 拿不到文件。

本切片落地一个**可插拔后端的对象存储**(先 LocalFs):上传即落盘并返回稳定的 `Attachment` 描述符(含 `att_<nanoid>` 公开 id);上传与发消息解耦(`POST /sessions/:id/attachments` 多部分上传落库拿 id,前端发消息只带引用);任意附件可经 `GET /attachments/:id/raw` 用网络 URL 展示,前端不再把 base64 塞进列表/历史;`useAttachments` 改为「上传拿正式 id、用 URL 展示」。

**本切片对 LLM 维持现状**:仍按 base64 发图(vision),不改 `prompt({images})` 链路 —— context 闸门、tool resolve、AgentTool 接入留给配套切片 `attachment-tool-bridge`。

守住三不变式中的两条:**单一身份**(公开 id 唯一,只能由 server `put()` 铸造)、**先落库后引用**(发消息引用前必先落库)。

## Boundary Context

- **In scope(本 spec 负责)**:
  - 对象存储抽象接口(S3 风格:`put`/`get`/`head`/`presignUrl`/`delete`)+ 单一 `LocalFsBackend` 实现 + 公开 id 生成(`att_<nanoid>`)。
  - `Attachment` 描述符类型(不含字节)+ session 属主元数据。
  - `POST /sessions/:id/attachments`(multipart 上传落库,返回描述符)。
  - `GET /attachments/:id/raw`(签名/token 校验、正确 mimeType、缓存头)。
  - 前端 `useAttachments` 重构:上传→正式 id;列表/缩略图改用网络 URL 展示。
  - 历史回显从内嵌 base64 改为按引用走 `/raw` URL。
  - 存储目录约定经 spawn env 下发(为未来 runner 子进程共享同一后端预留接缝,本切片仅下发约定,不在子进程实例化 store)。
- **Out of scope(交由 `attachment-tool-bridge` 或 future)**:
  - L2 `resolve` 句柄、`AgentTool` 接入、tool `execute`、tool-output 落库回流。
  - L3 context 闸门、智能意图路由。
  - 改造 base64→LLM 的 `prompt({images})` 链路(维持现状,vision 仍发 base64)。
  - S3/对象服务后端实现(接口预留,future)。
  - runner 子进程侧的 store 实例化与跨进程 `resolve`。
  - 让 LLM「看」非图片附件(pi 协议不支持,非本系统职责)。
- **Adjacent expectations(对相邻系统/spec 的期待)**:
  - `http-api`:提供路由注入接缝(`createPiWebHandler` 的 `routes` 注入 + `:id` 会话解析、鉴权门控),本 spec 经该接缝挂载上传/分发路由。
  - `session-engine`:提供会话存在/属主校验与会话工作目录概念,作为附件属主与存储目录归属的依据。
  - `react-client` / `ui-components`:提供 `useAttachments` 与 `attachments.tsx`,本 spec 在其上重构摄入/展示。
  - `session-store-adapters`:对齐其可插拔存储的接口命名风格(异步 `动词+名词`、后端经配置选择、错误类型可 `instanceof`),避免两套接口风格分裂。
  - `attachment-tool-bridge`(下游):复用本 spec 铸造的同一 id 空间与同一后端实例化约定。

## Requirements

### Requirement 1: 可插拔对象存储抽象与本地后端

**Objective:** 作为后端工程师,我想要一个按 S3 风格定义、可后续替换实现的对象存储抽象与一个本地文件系统后端,以便上传内容能持久化落盘,且未来切到 S3 时不改调用方。

#### Acceptance Criteria

1. The Attachment Store shall 暴露一个与后端无关的对象存储接口,包含写入(put)、读取(get)、元信息查询(head)、可达 URL 签发(presignUrl)与删除(delete)五类能力。
2. The Attachment Store shall 提供一个本地文件系统后端作为默认实现,使内容落盘到约定的存储目录而非进程内存。
3. When 对象存储接口被调用以写入一段内容及其 mimeType,the Attachment Store shall 将内容持久化,并返回该对象的稳定标识,使该内容在进程重启后仍可读取。
4. When 对象存储接口被调用以按标识读取一个已存在的对象,the Attachment Store shall 返回该对象的内容流及其 mimeType。
5. If 对象存储接口被调用以读取一个不存在的对象标识,then the Attachment Store shall 返回一个可与「成功」明确区分、可被调用方按类型识别的「未找到」结果。
6. The Attachment Store shall 提供多种内容访问雏形(至少包含可读流访问与可达 URL 访问),其中本切片要求可读流访问与可达 URL 访问可用,且 `getReadStream` 的元信息类型统一为门面导出的 `BlobMeta`(供下游复用,不另起内联类型)。原始字节访问形态由 `attachment-tool-bridge` 切片补全使用。
7. The Attachment Store 门面 shall 暴露一等只读访问器 `localPath(id)`,返回该附件在本地后端的盘上绝对路径(LocalFs 后端 = `<root>/<id>`;非本地后端返回未定义或留待后端实现),作为冻结的跨 spec 复用契约供 `attachment-tool-bridge` 依赖。
8. The Attachment Store shall 采用与项目既有可插拔存储一致的接口风格(异步方法、`动词+名词`命名、可按类型识别的错误结果、后端经配置选择),避免引入分裂的第二套接口风格。

### Requirement 2: Attachment 描述符与公开 id 铸造

**Objective:** 作为系统集成者,我想要一个不含字节、可在系统内到处流通的 `Attachment` 描述符,并由 server 唯一铸造不可枚举的公开 id,以便附件以稳定引用而非内联数据在各层间传递。

#### Acceptance Criteria

1. The Attachment Store shall 为每个已落库的附件维护一个描述符,至少包含公开 id、文件名、mimeType、字节大小、来源(upload 或 tool-output)、所属会话 id 与创建时间。
2. The Attachment 描述符 shall 不包含附件的字节内容,仅承载引用所需的元数据。
3. When 一段内容被写入对象存储,the Attachment Store shall 在写入路径内铸造该附件的公开 id,其形如 `att_` 加 URL 安全的随机串,且不可被顺序枚举推测。
4. The Attachment Store shall 保证公开 id 仅由 server 端写入路径铸造,使前端无法自行制造一个被系统接受为「已落库」的正式 id。
5. While 一个公开 id 已被铸造,the Attachment Store shall 保证该 id 在系统内唯一标识同一份附件(单一身份)。
6. Where 后续启用按内容哈希去重,the Attachment Store shall 允许底层存储 key 后置内容哈希而不改变对外公开 id 的稳定性;本切片可令存储 key 等于公开 id。
7. The Attachment Store 门面 shall 暴露 `listBySession(sessionId)` 一等只读访问器,按会话属主列出附件描述符(由 `AttachmentRegistry` 内部能力提升到门面),作为冻结的跨 spec 复用契约。

### Requirement 3: 上传落库端点(写路径)

**Objective:** 作为前端应用,我想要一个独立于发消息的多部分上传端点,以便先把文件落库换回正式描述符,再在发消息时只带引用,实现上传与发送解耦。

#### Acceptance Criteria

1. When 一个携带文件的多部分(multipart)请求被发往会话上传端点,the Attachment Store shall 将该文件内容写入对象存储,记录其会话属主(来源为 upload),并以描述符响应。
2. The Attachment Store shall 在上传成功响应中返回该附件的公开 id 及前端展示所需的描述符字段(文件名、mimeType、大小、来源、所属会话、创建时间)。
3. While 上传端点在受理请求,the Attachment Store shall 复用 http-api 既有的会话解析与鉴权门控(目标会话不存在时返回未找到、无权访问时返回禁止),不绕开既有访问控制。
4. If 上传请求未携带有效文件部分,then the Attachment Store shall 以一个明确的客户端错误响应,而不静默落库空对象。
5. When 上传落库完成,the Attachment Store shall 不在发消息路径上要求内联附件字节,使发消息只需携带附件引用即可(先落库后引用)。

### Requirement 4: 分发端点与可达 URL(读路径)

**Objective:** 作为查看者,我想要一个能按 id 取回附件原始内容的网络 URL,且该 URL 防枚举越权,以便前端用网络 URL 展示附件而无需内联 base64。

#### Acceptance Criteria

1. When 一个带有效签名/令牌的分发请求按公开 id 取原始内容,the Attachment Store shall 以正确的 mimeType 返回该附件的字节内容。
2. The Attachment Store 分发响应 shall 携带适当的缓存头,使可重复展示的内容可被客户端缓存。
3. If 分发请求缺失或携带无效/过期的签名/令牌,then the Attachment Store shall 拒绝该请求并返回未授权,而不返回字节内容。
4. If 分发请求指向一个不存在的公开 id,then the Attachment Store shall 返回未找到,且其响应不泄露其他附件是否存在的信息(防枚举)。
5. The Attachment Store shall 能为本地后端签发一个客户端可达的展示 URL,且该签发接口形态与 S3 预签名(presign)保持同形,使未来切到 S3 时调用方无需改动。
6. The Attachment Store shall 以稳定来源(`PI_WEB_ATTACHMENT_SECRET` 环境变量)作为 HMAC 签名 secret;Where 存在 runner 子进程共享同一后端的场景,该 secret shall 在主进程与子进程间稳定且一致,使子进程产出的签名 URL 能在主进程通过校验。可保留「未设置时回退随机」仅用于无子进程共享的纯单进程场景,但该回退在附件-tool(子进程共享)场景下不可用。

### Requirement 5: 前端摄入与展示重构(上传拿 id、URL 展示)

**Objective:** 作为聊天用户,我想要选择/拖拽/粘贴的附件被上传落库并以网络 URL 在输入区与历史中展示,以便不再受内存 base64 之累且刷新后引用仍可用。

#### Acceptance Criteria

1. When 用户经选择、拖拽或粘贴添加一个附件,the Attachment 前端 shall 先将该文件上传到会话上传端点,并以返回的正式公开 id 作为该附件的身份。
2. While 一个附件已落库,the Attachment 前端 shall 使用其分发 URL 在输入区列表与缩略图中展示该附件,而不再将 base64 内联进列表项。
3. When 用户提交携带附件的消息,the Attachment 前端 shall 以附件的正式公开 id 引用作为提交内容,且不要求把附件字节内联到列表状态。
4. While 一次上传正在进行,the Attachment 前端 shall 向用户呈现该附件处于上传中的可感知状态,直至落库返回正式 id 或失败。
5. If 一次上传失败,then the Attachment 前端 shall 向用户告知该附件未能添加,并不把它当作可提交的已落库引用。
6. The Attachment 前端 shall 仅接受由 server 上传端点返回的正式公开 id 作为「已落库」引用,不自行制造正式 id。

### Requirement 6: 历史回显改为按引用走 URL

**Objective:** 作为查看历史的用户,我想要历史消息中的图片/附件以网络 URL 渲染而非内嵌 base64,以便历史不再背负膨胀的 base64 且展示一致。

#### Acceptance Criteria

1. When 历史消息被翻译为可渲染的界面消息,the Attachment 历史回显 shall 将其中的附件引用渲染为指向分发端点的网络 URL,而非重建 `data:` base64 URL。
2. The Attachment 历史回显 shall 对已落库的附件以其公开 id 对应的分发 URL 呈现,使展示侧不内联附件字节。
3. Where 历史中仍存在本切片之前遗留的内联 base64 图片(无公开 id),the Attachment 历史回显 shall 仍能将其渲染出来,以避免历史回显回归。

### Requirement 7: 存储目录约定与双进程接缝预留

**Objective:** 作为平台工程师,我想要附件存储目录像会话工作目录一样有明确约定并可经 spawn 环境下发,以便未来 runner 子进程能共享同一后端,而本切片不引入跨进程实例化。

#### Acceptance Criteria

1. The Attachment Store shall 在 server 主进程内实例化,以服务上传(写)与分发(读)两条路径。
2. The Attachment Store shall 采用一个明确的存储目录约定(类比会话工作目录),作为本地后端落盘位置的单一来源。
3. Where 未来需要让 runner 子进程共享同一本地后端,the Attachment Store shall 经 spawn 环境变量**同时下发**该存储目录约定**与**签名 secret(`PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`),使子进程既指向同一目录又持有一致的签名 secret;本切片仅下发该约定与 secret,不在子进程内实例化 store。spawn env 透传(目录 + secret)整体归本 spec 拥有,`attachment-tool-bridge` 不编辑该 spawn env,只校验子进程已收到。
4. The Attachment Store shall 不在本切片内实现 runner 子进程侧的 store 实例化或跨进程 `resolve`,该职责属于 `attachment-tool-bridge`。

### Requirement 8: 测试与验证证据

**Objective:** 作为审阅者,我想要本切片以单元/集成测试与浏览器 e2e 证明端到端可用,且测试运行不污染开发态构建,以便以新鲜运行证据接受该切片。

#### Acceptance Criteria

1. The Attachment Store shall 配备单元/集成测试,覆盖对象存储写读、公开 id 铸造与唯一性、上传端点落库、分发端点签名校验与防枚举等核心行为。
2. The Attachment Store shall 配备浏览器端到端验证,覆盖「添加附件→上传落库→以分发 URL 展示」的完整链路。
3. While 运行端到端验证,the Attachment 验证流程 shall 使用隔离的构建产物(独立 dist 目录),不污染开发态使用的默认构建产物。
4. The Attachment Store shall 以新鲜运行的测试/e2e 证据证明上述行为通过,而非仅以代码存在为由声称完成。
