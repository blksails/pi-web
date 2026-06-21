# Implementation Plan

> 边界:本计划只做 L0 对象存储(本地后端)+ L1 描述符/`att_<nanoid>` + 上传/分发端点 + 前端改 URL 展示。
> **不**碰 L2 `resolve`/`AgentTool`/tool 执行/context 闸门(→ attachment-tool-bridge),**不**改 base64→LLM 的 `prompt({images})` 现状。
> 所有测试以新鲜运行证据为准;e2e 用隔离 build(`NEXT_DIST_DIR=.next-e2e`),不污染 dev `.next`。

## 1. 基础:协议 DTO 与 id/签名基件

- [x] 1.1 定义 `Attachment` 描述符与上传响应 DTO(协议层)
  - 在协议包新增 attachment DTO 模块:`Attachment{ id, name, mimeType, size, origin("upload"|"tool-output"), sessionId, createdAt }` 的 zod schema + 推导类型,以及上传响应 `{ attachment, displayUrl }` 的 schema/类型。
  - schema 强制 `size` 为非负整数、`createdAt` 为 ISO 字符串;`origin` 含 `tool-output` 取值(为下游预留)。
  - 经协议包 barrel 导出,沿用既有 `rest-dto.ts` 的 `zod schema + z.infer` 同风格。
  - 观察完成:协议包通过 typecheck,可从 `@pi-web/protocol` 导入 `AttachmentSchema`/`Attachment` 与上传响应类型,schema 对缺字段/负 size 校验失败。
  - _Requirements: 2.1, 2.2, 3.2_
  - _Boundary: Attachment DTO_

- [x] 1.2 (P) 实现公开 id 铸造工具
  - 提供生成形如 `att_<URL-safe 随机串>` 的公开 id 的工具,基于密码学随机字节(零新第三方依赖)。
  - 保证 id URL-safe、不可顺序枚举、多次生成不重复。
  - 观察完成:单元测试断言前缀为 `att_`、字符集 URL-safe、批量生成无重复且无顺序规律。
  - _Requirements: 2.3_
  - _Boundary: AttachmentStore(id 工具)_

- [x] 1.3 (P) 实现 URL 签名器(HMAC 签发/校验/过期)
  - 提供按公开 id + 过期时刻签发 HMAC 签名、并以常量时间比较校验签名与过期的能力。
  - secret 取自稳定来源 `PI_WEB_ATTACHMENT_SECRET` 环境变量;仅纯单进程无共享场景可回退进程启动随机(该回退在子进程共享场景不可用,需主/子进程一致);secret 与签名不写日志。
  - 观察完成:单元测试断言有效签名校验通过;篡改 id/过期戳/签名或已过期均校验失败(常量时间比较);相同 secret 构造的两个 signer 互验通过。
  - _Requirements: 4.3, 4.5, 4.6_
  - _Boundary: UrlSigner_

## 2. 核心:对象存储(L0)与描述符注册表(L1)

- [x] 2.1 (P) 定义 `BlobStore` 端口接口与未找到错误类型
  - 定义 S3 风格对象存储端口:写入、读为可读流、元信息查询、可达 URL 签发、删除五类能力;定义可 `instanceof` 识别的「未找到」错误类型。
  - 导出 `BlobMeta` 元信息类型供门面 `getReadStream` 与下游复用统一引用(不另起内联类型)。
  - 接口风格与既有可插拔存储(session-store-adapters)对齐:异步 `动词+名词`、错误类型化。
  - 观察完成:端口接口、`BlobMeta` 与错误类型通过 typecheck,可被后端实现与门面分别引用;读取不存在对象的契约为抛出可识别的未找到错误。
  - _Requirements: 1.1, 1.5, 1.6, 1.8_
  - _Boundary: BlobStore_

- [x] 2.2 实现本地文件系统后端 `LocalFsBlobBackend`
  - 实现 `BlobStore` 端口:字节落盘到约定目录、按 key 读为可读流并返回 mime/size、查询元信息、删除;读不存在抛未找到错误。
  - 字节以流式写读避免大文件全量入内存;本切片存储 key 等于公开 id(去重为 future);盘上布局为 `<root>/<key>`(平铺,冻结为跨 spec 契约)。
  - 可达 URL 签发委托 URL 签名器产出 `/attachments/:id/raw?exp&sig` 形态(与 S3 presign 同形)。
  - 暴露盘上绝对路径解析(`<root>/<key>`),供门面 `localPath(id)` 复用契约取用。
  - 观察完成:集成测试 `put` 后用新建后端实例(同目录)`get`/`head` 往返一致 mime/size(证明持久化、进程重启可读);读不存在 key 抛未找到错误;盘上路径解析返回 `<root>/<id>`。
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 2.6_
  - _Depends: 2.1, 1.3_
  - _Boundary: LocalFsBlobBackend_

- [x] 2.3 (P) 实现描述符注册表 `AttachmentRegistry`
  - 持久化与查询不含字节的 `Attachment` 描述符:按 id 保存/读取、按会话列出(`listBySession`,后续由门面提升为一等只读访问器);保证同一 id 仅一条描述符(单一身份)。
  - 观察完成:单元/集成测试断言保存后可按 id 取回完整描述符(不含字节)、`listBySession` 仅返回该会话附件、重复 id 不产生第二条。
  - _Requirements: 2.1, 2.2, 2.5, 2.7_
  - _Boundary: AttachmentRegistry_

- [x] 2.4 实现 `AttachmentStore` 门面(写路径铸造 id + 组合)
  - 组合对象存储、描述符注册表与 URL 签名器;`put` 在写路径内铸造公开 id、落盘字节、写描述符(记 `origin`/`sessionId`/`size`/`createdAt`),返回不含字节的描述符。store 不对 `origin` 取值设限(前端上传路径仅产 `"upload"`,`origin` 由调用方传入;`tool-output` 由下游 `attachment-tool-bridge` 经**同一** `put` 写入)。
  - 暴露按 id 取描述符、取读流(meta 用导出的 `BlobMeta`)、签发可达 URL、校验 URL、删除;并新增两个一等只读访问器 `localPath(id)`(盘上绝对路径,委托 LocalFs 后端)与 `listBySession(sessionId)`(由 Registry 提升到门面),冻结为跨 spec 复用契约。先落 blob 再写描述符,描述符写失败不暴露半落库引用。
  - 导出受认可的复用面 `AttachmentStore`(门面类型)/`PutInput`/`BlobStore`/`AttachmentRegistry`/`LocalFsBlobBackend`/`BlobMeta`/`UrlSigner` 供下游在子进程内组合实例化。
  - 观察完成:集成测试断言 `put` 返回的 `id` 形如 `att_…`、可经签发 URL 取回字节、`head` 返回属主与 mime;`localPath` 返回 `<root>/<id>`、`listBySession` 仅返回该会话附件;公开 id 仅由 `put` 产生(无对外铸造入口)。
  - _Requirements: 1.3, 1.6, 1.7, 2.3, 2.4, 2.5, 2.7, 4.5_
  - _Depends: 2.2, 2.3, 1.2, 1.3_
  - _Boundary: AttachmentStore_

- [x] 2.5 实现存储配置工厂(目录/secret 解析与后端构造)
  - 提供从环境变量解析附件存储目录约定与签名 secret、构造本地后端与门面的工厂(后端经配置选择,为 S3 留缝)。
  - 签名 secret 取自稳定来源 `PI_WEB_ATTACHMENT_SECRET`;仅在无子进程共享的纯单进程场景可回退随机,该回退在附件-tool 子进程共享场景下不可用(需稳定且主/子进程一致)。
  - 明确目录约定环境变量名(类比会话工作目录约定),作为本地后端落盘位置的单一来源。
  - 观察完成:单元测试断言给定目录/secret 环境变量时构造出指向该目录、使用该 secret 的可用 store;缺省目录回落到约定默认目录;同一 `PI_WEB_ATTACHMENT_SECRET` 下两个 store 实例签名互验通过。
  - _Requirements: 1.8, 4.6, 7.2_
  - _Depends: 2.4_
  - _Boundary: AttachmentStore(config)_

## 3. 核心:HTTP 上传(写)与分发(读)端点

- [x] 3.1 实现上传端点 handler(multipart 落库,会话域)
  - 经 http-api 注入接缝提供 `POST /sessions/:id/attachments`:解析 multipart 取文件,记会话属主与 `origin=upload`,落库并以 `{ attachment, displayUrl }` 响应;无有效文件部分返回客户端错误。
  - 复用 http-api 既有的 `:id` 会话解析与鉴权门控(会话不存在 404、越权 403、未鉴权 401),不绕开既有访问控制。
  - 设上传大小上限并对超限以客户端错误拒绝(不全量入内存)。
  - 观察完成:集成测试断言带文件请求返回 200 且描述符记 `origin=upload`+会话 id;无文件返回 400;经完整 handler 装配时会话不存在/越权返回 404/403。
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Depends: 2.4_
  - _Boundary: attachment-routes(上传)_

- [x] 3.2 实现分发端点 handler(签名校验、缓存、防枚举)
  - 经注入接缝提供 `GET /attachments/:id/raw?exp&sig`:校验签名与过期后以正确 mime 流式返回字节并带缓存头;签名缺失/无效/过期返回未授权;id 不存在返回未找到且不泄露存在性差异(防枚举)。
  - 观察完成:集成测试断言有效签名返回正确 `Content-Type`+`Cache-Control`+字节;无/过期签名返回 401;不存在 id 返回 404 且与签名失败响应不可区分语义。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 2.4_
  - _Boundary: attachment-routes(分发)_

- [ ] 3.3 暴露注入路由工厂并从协议/服务包导出
  - 提供 `createAttachmentRoutes(store)` 返回注入路由数组(上传+分发),与既有 `createConfigRoutes` 同范式;经服务包 barrel 导出工厂、store 类型/配置工厂,以及受认可的复用面 `AttachmentStore`(门面类型)/`PutInput`/`BlobStore`/`AttachmentRegistry`/`LocalFsBlobBackend`/`BlobMeta`/`UrlSigner`/`attachmentStoreConfigFromEnv` 供下游在子进程内组合实例化。
  - 观察完成:可从 `@pi-web/server` 导入 `createAttachmentRoutes`、store 配置工厂与上述复用面类型/类,返回的路由可直接放入 `createPiWebHandler({ routes })`。
  - _Requirements: 1.8, 7.1_
  - _Depends: 3.1, 3.2, 2.5_
  - _Boundary: attachment-routes_

## 4. 前端:上传摄入与 URL 展示

- [ ] 4.1 实现客户端上传函数(react transport)
  - 提供向会话上传端点发起 multipart 上传、解析并 zod 校验响应描述符的客户端函数;经 react 包导出。
  - 观察完成:单元测试(或 mock fetch)断言上传成功解析出 `attachment`+`displayUrl`;失败响应抛错供 hook 捕获。
  - _Requirements: 5.1, 3.5_
  - _Depends: 1.1_
  - _Boundary: uploadAttachment_

- [ ] 4.2 重构 `useAttachments`:上传拿正式 id + 状态机
  - 改 `add()` 为异步:本地预览后置「上传中」态、调用上传函数,成功置「就绪」并记 server 返回的正式公开 id 与展示 URL,失败置「错误」态;仅正式 id 视为已落库引用;保留 `toImageContents()`(vision 维持现状)。
  - 扩展待提交附件结构以承载状态、正式 id、展示 URL,且保持对既有调用方向后兼容。
  - 观察完成:单元测试断言添加后经历 uploading→ready 并带正式 id/展示 URL;上传失败置 error 且该项不计入可提交的已落库引用;前端不自造正式 id。
  - _Requirements: 5.1, 5.4, 5.5, 5.6, 2.4_
  - _Depends: 4.1_
  - _Boundary: useAttachments_

- [ ] 4.3 (P) 附件 UI 改用展示 URL 并呈现上传状态
  - 缩略图/悬浮预览改用展示 URL(回退本地预览),并对「上传中」「失败」呈现可感知状态。
  - 观察完成:组件测试/渲染断言就绪附件以网络展示 URL 作为图片源(非内联 base64)、上传中显进行态、失败显错误标记。
  - _Requirements: 5.2, 5.4, 5.5_
  - _Depends: 4.2_
  - _Boundary: attachments.tsx_

- [ ] 4.4 (P) 聊天提交链路接入异步上传与引用提交
  - 将聊天输入的添加附件回调接到异步上传;提交时以正式公开 id 引用作为附件标识(发消息不要求内联附件字节),并沿用现状 base64 发图链路。
  - 观察完成:交互/集成测试断言添加触发上传、提交携带正式 id 引用且不内联落库字节;现状 vision base64 链路不回归。
  - _Requirements: 5.3, 3.5_
  - _Depends: 4.2_
  - _Boundary: pi-chat.tsx_

- [ ] 4.5 (P) 历史回显改为按引用走分发 URL(保留遗留 base64)
  - 历史消息翻译为可渲染消息时,对带公开 id 的附件渲染分发 URL;对遗留无 id 的内联 base64 图片仍重建可渲染 URL(防回归)。
  - 观察完成:单元测试断言带公开 id 的历史项渲染指向分发端点的 URL、无 id 遗留项仍渲染内联图片。
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 1.1_
  - _Boundary: agent-message-to-ui_

## 5. 集成:主进程装配与目录约定下发

- [ ] 5.1 在应用 handler 装配中实例化 store 并注入路由
  - 在 server 主进程的 handler 装配处实例化附件 store(经配置工厂)并把上传/分发路由注入 `createPiWebHandler({ routes })`,使两端点在 `/api/**` 下可达。
  - 观察完成:应用启动后上传端点接受 multipart 落库、分发端点按签名 URL 返回字节;store 在主进程单例化服务读写两路径。
  - _Requirements: 7.1_
  - _Depends: 3.3_
  - _Boundary: 主进程 handler 装配_

- [ ] 5.2 经 spawn 环境下发存储目录约定与签名 secret(仅下发)
  - 在子进程 spawn 环境中**同时**透传附件存储目录约定 `PI_WEB_ATTACHMENT_DIR` **与**签名 secret `PI_WEB_ATTACHMENT_SECRET`(类比会话工作目录下发),为未来 runner 子进程共享同一本地后端预留接缝并保证签名 secret 主/子进程一致(否则子进程产出的 tool-output `/raw` 签名 URL 会在主进程 401);本切片仅下发约定与 secret,不在子进程实例化 store 或做跨进程 resolve。
  - 此 spawn env 透传(目录 + secret)整体归本 spec(attachment-store)拥有;下游 `attachment-tool-bridge` 不编辑该 spawn env,只校验子进程已收到。
  - 观察完成:测试/检查断言 spawn 环境**同时**包含目录与 secret 两变量且值与主进程 store 一致;子进程侧无 store 实例化代码(边界守住)。
  - _Requirements: 7.3, 7.4_
  - _Depends: 5.1, 2.5_
  - _Boundary: 主进程 handler 装配(spawn env)_

## 6. 验证:e2e 与回归

- [ ] 6.1 浏览器 e2e:添加→上传落库→URL 展示全链路
  - 在隔离 build(独立 dist 目录)+ external server 模式下,验证添加附件经历上传中态、落库后缩略图以分发 URL 展示(图片源指向分发端点且网络请求 200),不污染 dev 默认构建产物。
  - 观察完成:新鲜运行的浏览器 e2e 通过,断言展示用网络 URL(非 `data:` base64)且 `/attachments/.../raw` 返回 200。
  - _Requirements: 5.1, 5.2, 8.2, 8.3_
  - _Depends: 5.1, 4.3_
  - _Boundary: e2e/browser/attachment-store.e2e.ts_

- [ ] 6.2 e2e/集成:历史回显 URL 化与遗留 base64 防回归 + 上传失败路径
  - 验证已落库历史以分发 URL 渲染、遗留内联 base64 历史仍能渲染;并验证上传失败时该附件标错误且不可作为已落库引用提交。
  - 观察完成:新鲜运行测试通过,断言两类历史均正确渲染、失败附件不进入可提交引用集。
  - _Requirements: 6.1, 6.2, 6.3, 5.5, 5.6_
  - _Depends: 4.4, 4.5_
  - _Boundary: e2e/browser/attachment-store.e2e.ts, agent-message-to-ui_

- [ ] 6.3 汇总核心单元/集成测试并以新鲜证据收口
  - 汇总对象存储读写、公开 id 铸造与唯一性、签名校验与防枚举、上传落库与分发的核心单元/集成测试,确保全部覆盖并以新鲜运行证据证明通过。
  - 观察完成:相关包测试套件新鲜运行全绿,覆盖 id 唯一性、签名拒绝、落库属主、防枚举 404 等关键断言。
  - _Requirements: 8.1, 8.4_
  - _Depends: 2.4, 3.1, 3.2_
  - _Boundary: 测试套件_
