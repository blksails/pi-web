# 研究与发现日志 — sessions-list

## Discovery 范围与类型

- **特性类型**：Extension（在既有 pi-web 系统上集成），执行 integration-focused（light）discovery。
- **目标**：核实「会话列表 + 恢复」所需集成点的真实符号/签名/装配方式，避免设计漂移。

## 关键发现（带代码引用）

### F1. 持久化存储与 SessionMeta
- `SessionEntryStore` 接口：`packages/server/src/session-store/types.ts:102-136`。
  - `SessionMeta = { sessionId, cwd, name?, version, createdAt, updatedAt?, entryCount? }`。
  - `list(cwd): Promise<SessionMeta[]>`、`listAll(): Promise<SessionMeta[]>`，**无分页/排序参数**；实现内部按 `createdAt` **升序** 返回（`fs-store.ts:277-281` 的 `byCreatedAt`）。
- 排序字段：`createdAt` 必填；`updatedAt` **仅 fs 适配器** 提供（读文件 mtime，`fs-store.ts` `#metaFromFile`），sqlite/postgres 的 SELECT 不含 `updated_at`（`sqlite-store.ts:139-153`、`postgres-store.ts:157-172`）。
  - **决策影响**：跨适配器一致的排序键只能是 `createdAt`；统一采用 `updatedAt ?? createdAt` 倒序（fs 更精确，db 退化为 createdAt）。
- 损坏条目：fs 适配器在 `#metaFromFile` try-catch 中跳过无法解析的会话（满足 R1.4）。

### F2. 工厂与装配
- `createSessionEntryStore(config)`（**async**，postgres 惰性 import）+ `sessionStoreConfigFromEnv()`：`factory.ts:27-68`。按 `SESSION_STORE` 环境选后端，默认 fs（root=`~/.pi/agent/sessions`）。
- 装配单例 `pi-handler.ts:221-339`：`buildSingleton()`（同步）已用 `sessionStoreConfigFromEnv()` 构造冷恢复读取器 `makeResumeMetaLoader(...)`（`pi-handler.ts:303`），并通过 `routes:` 注入接缝挂载 `createConfigRoutes/createSandboxProjectRoutes/createExtensionsConfigRoutes/createAttachmentRoutes`（`pi-handler.ts:312-332`）。
  - **结论**：会话列表端点应仿此，新增 `createSessionListRoutes(...)` 注入到 `routes:`，store 惰性构造（buildSingleton 同步，不改为 async）。

### F3. HTTP 注入面与响应工具
- `InjectedRoute = { method, path, handler }`、`RouteHandler = (ctx: RequestContext) => Promise<Response>`，`RequestContext = { req, sessionId?, auth, url }`：`handler.types.ts:20-38`。注释「内置路由对冲突优先」。
- 内置仅有 `POST /sessions` 与 `GET /sessions/:id/*`，**无 `GET /sessions`**（`create-handler.ts`）。新增 `GET /sessions`（无 `:id`）无冲突。
- 响应工具：`jsonResponse(status, payload)`（注入 protocolVersion）、`errorResponse(status, code, message, fields?)`：`error-map.ts:47-73`。查询参数经 `ctx.url.searchParams`。

### F4. protocol DTO 风格
- `rest-dto.ts:38-115`：zod schema + `z.infer` 推导 type；命名 `*RequestSchema`/`*ResponseSchema` + `Create*Request`/`Get*Response`；响应按单顶层 key 包裹（`{ stats }`/`{ messages }`）。
- `CreateSessionRequestSchema` 已含 `resumeId?`（恢复入口已就绪）。

### F5. 前端 slots 与 env
- `PiChatSlots`（宿主级）：`packages/ui/src/chat/slots.ts:9-19` —— `header/footer/sidebar/messageActions/background/empty`（**不含 sidebarLeft/panelRight**）。`slots?: PiChatSlots` 在 `pi-chat.tsx:96`。
- 优先级链先例（background）：`pi-chat.tsx:759-775`（宿主 `slots` > `components` override > `extension.slots`）。`slots.sidebar` 渲染于 `pi-chat.tsx:924-928`。
- webext 的 18 个 SlotKey（sidebarLeft/panelRight 等）在 `packages/protocol/src/web-ext/descriptor.ts`，经 `ExtSlotRegion` 渲染——属另一套（扩展贡献），非宿主 `slots` prop。
- env 读取：前端构建期需 `NEXT_PUBLIC_` 前缀（`chat-app.tsx:99-104` 读 `NEXT_PUBLIC_PI_EXTENSION_COMMANDS`）；服务端直接 `process.env`（`query-routes.ts:108-112` 读 `PI_WEB_HIDE_PROVIDERS`）。

### F6. 恢复会话链路（已就绪，复用）
- `PiClient.createSession(req)` POST /sessions（`packages/react/src/client/pi-client.ts:109-110`）；`usePiSession` 在传入 `resumeId` 时混入 create 请求并 `getMessages(id)` 回放历史（`use-pi-session.ts:113-138`）。
- catch-all 转发：`app/api/sessions/[[...path]]/route.ts:19-21` 的 GET 自动转发到 handler；新增 `GET /sessions` 无需改 Next 路由。

## Synthesis（构建 vs 复用 / 简化）

- **复用优先**：列表数据复用 `SessionEntryStore.list/listAll`；恢复复用现有 `resumeId` 链路与 `usePiSession`；端点复用 `routes:` 注入接缝与 `jsonResponse/errorResponse`；位置复用宿主 `slots` 优先级链。新增代码集中在「一个注入路由 + 一组 DTO + 一个前端面板 + 宿主接线」。
- **简化**：分页在 handler 内存切片（store 无原生分页），cursor 用不透明编码 `{ts,id}`，避免引入 store 层 schema 迁移。
- **偏差记录**：原方案「宿主 slots 注入 sidebarLeft」不成立——宿主 `PiChatSlots` 无 sidebarLeft。修正为默认 `slots.sidebar`，env `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` 在宿主 slot 子集（sidebar/header/footer/empty）间选择；接入 webext extension SlotKey 体系列为 Out of Boundary（未来增强）。

## 风险

- **R-perf**：`listAll()` 全量扫桶（当前约 1780 桶）且 handler 内存切片，大规模历史下首屏开销线性增长 → 以「默认关闭全局视图 + 分页 + 仅读 header」缓解；store 层原生分页/索引列为未来增强。
- **R-sort**：sqlite/postgres 无 `updatedAt`，倒序退化为 `createdAt`；fs 用 mtime。文档明示，避免「最近活跃」承诺在 db 后端不成立。
- **R-route-match**：需验证 router 将 `GET /sessions` 与 `GET /sessions/:id/*` 正确区分（实现期 e2e 覆盖）。已消解：`Router` 按段数相等匹配（`router.ts:97`），`/sessions`（1 段）与 `/sessions/:id/*`（3 段）不会误匹配；注入路由经 `routes:` 接缝（内置冲突优先）。单测经完整 handler 路由确认。

## 实现期决策修正

- **持久化 store 经 `routes:` 注入接缝**（非改内置路由表）：`createSessionListRoutes()` 仿 `createConfigRoutes`，在 `pi-handler.ts` 装配注入；store 经 `createSessionEntryStore` 惰性单例（首请求构造，避免把同步 `buildSingleton` 改 async）。
- **宿主插槽修正**：宿主 `PiChatSlots` 仅 `header/footer/sidebar/messageActions/background/empty`（`slots.ts`），无 sidebarLeft/panelRight（那是 webext 扩展 SlotKey，走 `ExtSlotRegion`）。故默认注入宿主 `slots.sidebar`，`NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` 取值限 `sidebar|header|footer|empty`。
- **全局门控双端**：统一用 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL`——后端 `pi-handler` 运行时读（权威门控，scope=all 关闭→403），前端构建期内联读（隐藏「全部」Tab）。前端开启态因构建期内联需以该 env 重新构建方显现。
- **standalone 与 e2e 不兼容（既有回归修复）**：CLI spec（377d237）的无条件 `output: "standalone"` 使 playwright 的 `next start` 报错。本 spec 条件化为 `PI_WEB_DISABLE_STANDALONE==="1" ? undefined : "standalone"`（默认仍 standalone，CLI 打包不变），e2e 以该 env 构建非 standalone 产物起服。
