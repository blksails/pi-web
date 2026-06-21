# 研究与设计决策 — attachment-store

## 摘要
- **Feature**: `attachment-store`
- **Discovery Scope**: Extension(在既有 http-api / session-engine / react-client / ui-components 上扩展)
- **Key Findings**:
  - http-api 已具备「路由注入接缝」(`createPiWebHandler({ routes })`)与统一的 `:id` 会话解析 + 鉴权门控(`Router.route`),上传/分发路由应经该接缝挂载,而非新写一套路由器。注入路由工厂的既有范式为 `createConfigRoutes()` / `createSandboxProjectRoutes()`(返回 `InjectedRoute[]`)。
  - 既有存储抽象范式见 `session-store-adapters`(`SessionEntryStore`:异步 `动词+名词` 方法、`AsyncIterable` 读流、可 `instanceof` 的错误类型、后端经配置 `sessionStoreConfigFromEnv()` 选择)。本 spec 的对象存储接口须与之同构,避免风格分裂。
  - 前端现状:`useAttachments` 用 `FileReader→dataUrl` 存内存,`PendingAttachment{id:"att-N", name, mimeType, dataUrl}`,`toImageContents()` 抽裸 base64;`pi-chat.tsx` 提交时 `sendMessage({text},{body:{images}})`;历史回显 `agent-message-to-ui.ts` 把 `image` part 重建为 `data:` URL。本 spec 改为「上传拿 `att_<nanoid>` 正式 id + URL 展示」,但**保留** `toImageContents()`(vision 仍发 base64,维持现状)。
  - 项目无 `nanoid` 依赖;既有唯一 id 用 `node:crypto` 的 `randomUUID`。为满足「URL-safe、不可枚举、`att_` 前缀」,采用 `randomBytes` 做 base64url id 生成(零新依赖),不引入 nanoid。
  - e2e 隔离 build 约定:`NEXT_DIST_DIR` 切 `distDir`(`next.config.ts`),Playwright 在 `playwright.config.ts` 透传;浏览器 e2e 在 `e2e/browser/*.e2e.ts`,Node 级 e2e 在 `e2e/node/*.e2e.test.ts`(`PI_WEB_STUB_AGENT=1`)。

## 研究日志

### http-api 路由注入与会话/鉴权门控
- **Context**: 上传/分发端点应如何接入既有 HTTP 层?
- **Sources Consulted**: `packages/server/src/http/{create-handler,router,handler.types}.ts`、`packages/server/src/http/routes/*`、`packages/server/src/config/config-routes.ts`、`lib/app/pi-handler.ts`。
- **Findings**:
  - `createPiWebHandler(opts)` 接收 `routes?: ReadonlyArray<InjectedRoute>` 注入外部路由;`Router.route(req)` 统一做:版本校验 → basePath 剥离 → 路径模板匹配(`:id` 捕获)→ `authResolver` 鉴权(401)→ `:id` 会话存在性(404 `SESSION_NOT_FOUND`)→ `authorizeSession`(403)→ `handler({req,auth,url,sessionId})`。
  - `RouteHandler = (ctx: RequestContext) => Promise<Response>`;`RequestContext{ req, sessionId?, auth, url }`。返回标准 Web `Response`。
  - app 经 `lib/app/pi-handler.ts` 单例装配,handler 挂在 `/api/**`,内部路由如 `/sessions/**`、`/config/**`(`sse.basePath:"/api"` 剥前缀)。注入路由工厂如 `createConfigRoutes({rootDir})`。
- **Implications**:
  - `POST /sessions/:id/attachments` 走 `:id` 会话解析 → 自动获得「会话不存在 404 / 越权 403」,满足 Req 3.3。会话存在性门控天然落在 `:id` 路由上。
  - `GET /attachments/:id/raw` **不带** `sessionId` 段 → 不经会话门控;其访问控制由**签名/令牌**自洽(Req 4.3/4.4)。这正是写路径(会话域、强鉴权)与读路径(签名自洽、可缓存)分离的依据。
  - 新增 `createAttachmentRoutes(opts): InjectedRoute[]` 工厂,在 `lib/app/pi-handler.ts` 的 `routes:[...]` 追加注入,与 config 路由同范式。

### 既有存储抽象风格(session-store-adapters)
- **Context**: 对象存储接口命名/签名/错误风格如何对齐既有,避免两套风格?
- **Sources Consulted**: `.kiro/specs/session-store-adapters/design.md`。
- **Findings**: `SessionEntryStore` 用异步 `动词+名词`(`create/append/read/list/delete`)、`AsyncIterable` 流读、`instanceof` 错误类型(`SessionNotFoundError` 等)、后端经 `sessionStoreConfigFromEnv()` 选择,fs adapter 落 `~/.pi/agent/sessions/<bucket>/<id>.jsonl`。
- **Implications**: `BlobStore` 接口取 `put/get/head/presignUrl/delete`(S3 风格,符合 brief),签名为异步;错误用可 `instanceof` 的 `BlobNotFoundError`;后端经 `attachmentStoreConfigFromEnv()`/构造参数选择 `LocalFsBlobBackend`。`AttachmentRegistry`(描述符元数据)同样异步 `verb+noun`。

### 前端附件链路现状与改造面
- **Context**: 上传拿 id + URL 展示要改哪些文件,改到何处止?
- **Sources Consulted**: `packages/react/src/hooks/use-attachments.ts`、`packages/ui/src/elements/attachments.tsx`、`packages/ui/src/chat/pi-chat.tsx`、`packages/react/src/transport/agent-message-to-ui.ts`。
- **Findings**:
  - `useAttachments()` 返回 `{items, supported, add, remove, clear, toImageContents}`;`PendingAttachment{id,name,mimeType,dataUrl}`;`add()` 仅收 `image/*`。
  - `attachments.tsx` 用 `item.dataUrl` 渲染缩略图/hover 预览;`pi-chat.tsx` 在 `onAddAttachments` 调 `add()`,提交时 `toImageContents()` → `{body:{images}}`。
  - `agent-message-to-ui.ts`:`raw.type==="image"` → `{type:"file", mediaType, url:"data:...;base64,..."}`。
- **Implications**:
  - `useAttachments` 需接受一个 `upload(file)→Promise<Attachment>` 注入(由 `@pi-web/react` 客户端提供,指向 `POST /sessions/:id/attachments`),`add()` 改为异步上传、置 `uploading` 态、成功后存 `att_<nanoid>` + 展示 URL(Req 5.1/5.4/5.5)。
  - `PendingAttachment` 扩展:增 `attachmentId?`(正式 id)、`status:"uploading"|"ready"|"error"`、`displayUrl`(分发 URL,替代 `dataUrl` 用于展示)。`dataUrl` 保留作上传前本地预览与 `toImageContents()`(vision 维持现状)。
  - `agent-message-to-ui.ts`:`image` part 若带公开 id(未来 wire 形态)→ 渲染分发 URL;**遗留**无 id 的内联 base64 仍重建 `data:` URL(Req 6.3 防回归)。本切片不改 wire 协议中 image part 形态(那属 LLM/transcript 域),仅在「描述符可得时」走 URL;实际 URL 化主要体现在输入区与上传回显。

### id 生成与签名 URL
- **Context**: `att_<nanoid>` 与防枚举签名 URL 在零新依赖下如何实现?
- **Sources Consulted**: `node:crypto` 用法(`randomUUID`/`randomBytes` 在 `pi-rpc-process.ts`/`stub-agent-process.mjs` 已用)。
- **Findings**: 无 nanoid 依赖;`randomBytes(16).toString("base64url")` 即得 URL-safe 不可枚举串。HMAC 签名用 `createHmac("sha256", secret)`。
- **Implications**: 公开 id = `"att_" + randomBytes(16).base64url`。`presignUrl(id)` 生成 `/attachments/:id/raw?exp=<ts>&sig=<hmac(id|exp)>`;`/raw` 端点 `timingSafeEqual` 校验签名 + 过期。secret 经 env(`PI_WEB_ATTACHMENT_SECRET`,缺省随进程随机生成)。本地后端据此「签发可达 URL」,接口形态 = S3 presign 同形(Req 4.5)。

### 存储目录约定与双进程接缝
- **Context**: 存储目录如何约定、如何为未来 runner 子进程共享预留?
- **Sources Consulted**: `assemble-spawn.ts`(`buildEnv`/`PI_CODING_AGENT_DIR` 经 env 下发)、`pi-handler.ts`(env 透传)。
- **Findings**: spawn env 已是既有「目录约定下发」范式(`PI_CODING_AGENT_DIR` 最后写入防覆盖)。
- **Implications**: 附件根目录约定 `PI_WEB_ATTACHMENT_DIR`(缺省 `<agentDir>/attachments` 或 `<defaultCwd>/.pi/attachments`),store 在**主进程**实例化(Req 7.1)。本切片仅**下发该 env 约定**到 spawn env,**不**在子进程实例化 store(Req 7.3/7.4 边界,留给 attachment-tool-bridge)。

## 架构方案评估

| Option | 描述 | 优点 | 风险/限制 | 备注 |
|--------|------|------|-----------|------|
| Ports & Adapters(选用) | `BlobStore` 端口 + `LocalFsBlobBackend` 适配器;`AttachmentRegistry` 管描述符元数据 | 边界清晰、S3 可后置接入不改调用方、与 session-store 同构 | 需建适配器层(本地后端) | 符合 brief「S3 风格接口、本地先行」与 steering 接口外置原则 |
| 单体 LocalFs(直接落盘 + 内联元数据) | 不抽端口,直接读写文件 | 实现快 | 切 S3 需改全部调用方;与既有可插拔风格分裂 | 违反 brief 约束 1,弃用 |
| 复用 SessionEntryStore 存字节 | 把附件塞进 session jsonl | 复用现成 | jsonl 不适合二进制大对象;混淆职责 | 弃用 |

## 设计决策

### 决策:对象存储用 Ports & Adapters,字节与描述符分离
- **Context**: brief 要求 S3 风格、本地先行、不含字节的描述符到处流通。
- **Alternatives**: 见上表。
- **Selected Approach**: `BlobStore` 端口(`put/get/head/presignUrl/delete`)+ `LocalFsBlobBackend`;`AttachmentRegistry` 持描述符(JSON 旁路文件或同目录 `.meta.json`)。`AttachmentStore` 门面组合二者,`put()` 内铸造公开 id 并写描述符。
- **Rationale**: 与 session-store-adapters 同构、为 S3 留缝、字节/元数据职责分离便于「描述符不含字节」不变式。
- **Trade-offs**: 多一层门面;但换来可替换性与边界清晰。
- **Follow-up**: 实现时确认 `presignUrl` 形态对 S3 presign 可平移。

### 决策:写路径走会话域强鉴权,读路径走签名自洽
- **Context**: Req 3(写)需会话属主+鉴权;Req 4(读)需可缓存+防枚举但不绑会话。
- **Selected Approach**: `POST /sessions/:id/attachments` 走 `:id` 会话门控;`GET /attachments/:id/raw?exp&sig` 用 HMAC 签名 + 过期自洽校验,不经会话门控。
- **Rationale**: 读路径需可被 `<img src>` 直接加载(浏览器不带自定义鉴权头),签名 URL 是标准做法且与 S3 presign 同形。
- **Trade-offs**: 需管理签名 secret;过期窗口需权衡缓存与安全。
- **Follow-up**: secret 经 env;e2e 覆盖无签名/过期签名拒绝。

### 决策:前端保留 base64 出口(vision 维持现状),仅展示与引用改 URL/正式 id
- **Context**: brief 明确「对 LLM 维持现状」,context 闸门留 tool-bridge。
- **Selected Approach**: `toImageContents()` 保留发裸 base64;新增上传链路得 `att_<nanoid>` + `displayUrl`;展示/历史回显用 URL。
- **Rationale**: 守住本切片边界,不动 `prompt({images})`。
- **Trade-offs**: 同一附件短期内既有本地 base64(发 LLM)又有落库 URL(展示);可接受,过渡态。

## 风险与缓解
- **签名 secret 缺省随机致重启后旧 URL 失效** — 缓存窗口短、URL 由前端即时签发;可经 `PI_WEB_ATTACHMENT_SECRET` 固化。
- **上传与发消息解耦后的孤儿对象**(上传后未发送) — 本切片不做 GC(标注为 future);描述符记 `createdAt` 便于后续清理。
- **大文件/multipart 解析** — 用 Web `Request.formData()`(Next/undici 原生),设上传大小上限并以 4xx 拒绝超限(非功能约束,任务中体现)。
- **历史回显回归** — 保留遗留内联 base64 渲染分支(Req 6.3),e2e 双覆盖。

## 参考
- 本仓 `.kiro/specs/session-store-adapters/design.md` — 可插拔存储接口风格基准。
- 本仓 `packages/server/src/http/{create-handler,router,handler.types}.ts` — 路由注入与门控范式。
- 本仓 `.kiro/steering/roadmap.md`「附件系统」波次 — 分层/pipeline/三不变式/关键约束权威来源。
