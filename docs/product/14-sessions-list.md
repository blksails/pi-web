# 14 · 会话列表

会话列表（Sessions List）让用户在 Web UI 内**浏览历史会话**并**一键恢复**任意会话继续对话——无需手动记忆或输入会话 id。会话历史一直由底层持久化（每个会话按其工作目录 cwd 分桶，含 id / cwd / 创建·修改时间 / 可选名称等头部元数据），此前却从未在界面暴露；本特性把这份历史以一个可重定位的只读面板嵌入聊天界面，不占用、不替换既有对话区。

---

## 1. 它解决什么 / 能力边界

**In scope**

- 两类视图：**当前目录会话**（仅当前 cwd）与**系统会话**（本机全部目录），后者默认关闭、需部署方显式开启。
- 列表项展示足以区分会话的**轻量元数据**：名称或标识、时间（创建或最近修改）、所属工作目录。
- 从列表整行点击直接**恢复**某历史会话进入对话，回放历史上下文。
- 大规模会话集合下的**分页**（keyset 游标续取）与**倒序排序**。
- 展示位置由配置控制（默认左侧栏），并可重定位到其它界面区域。
- 每个会话项的**项级管理**:**删除**(不可逆物理删除)、**重命名**(持久化为最新显示名)、**收藏 / 置顶**(独立偏好、顶部分区置顶)——详见 [§9 会话项操作](#9-会话项操作重命名--收藏--删除)。三项写操作可由部署方经门控整体关闭。

**Out of scope**

- 会话的**归档**（archived 状态）、**分叉**（fork）、**导出**（下载 jsonl / markdown）、**搜索·全文检索**（本期不做，留待后续）。
- **批量选择 / 批量删除**;收藏项的**手动拖拽排序 / 分组 / 打标签**。
- 列表项展示消息条数、首条消息摘要等需读取**会话正文**的重型字段——本期只用文件头部轻量元数据。
- 跨机器 / 远端会话聚合与管理（仅限本机持久化的会话）。
- 新建会话入口（已由现有界面提供，不在本特性内重做）。

设计上：只读列表链路里服务端只负责「读 + 排序 + 分页 + 门控」，前端只负责「展示 + 切换 + 触发恢复」，恢复本身复用既有的 `resumeId` 冷恢复链路，不改动会话运行 / 流式内核，不改动持久化存储 schema。项级写操作（删除 / 重命名 / 收藏，[§9](#9-会话项操作重命名--收藏--删除)）在此之上叠加一组独立的写接缝，同样不触碰运行内核与冷恢复链路：删除复用会话存储既有的物理删除、重命名复用其 append 事件模型、收藏落一份独立的用户偏好文件。

---

## 2. 两类视图

| 视图 | `scope` | 范围 | 默认状态 |
|---|---|---|---|
| 当前目录 | `cwd` | 当前工作目录下已持久化的会话 | 始终可用 |
| 系统（全机器） | `all` | 本机全部工作目录下的会话 | **默认关闭**，需 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` 开启 |

两类视图均按 `updatedAt ?? createdAt` **倒序**（最新在前），跨 fs / sqlite / postgres 后端一致；单个会话头部元数据损坏 / 无法解析时由 store 适配器**跳过**该会话并继续返回其余，不使整个列表请求失败。

**系统视图的双重门控**：

- 服务端：`scope=all` 且全局开关关闭时，`GET /api/sessions` 直接返回 `403`，**不触达存储**（不扫描全机器会话桶、不暴露清单）。
- 前端：全局开关关闭时，面板根本**不渲染「全部」Tab**（仅保留「当前目录」视图）。

要开启系统视图，部署方设置 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true`（或 `=1`）——该值由服务端在 `GET /api/bootstrap` 请求时读 `process.env` 下发前端（`server/bootstrap.ts:97`），前端经 `setRuntimeFeatures()` 注入门控（`src/bootstrap.tsx:140`、`lib/app/runtime-features.ts:33`）。改后**重启服务端即生效，无需重新构建**（下发机制见 [§7.1](#71-门控为何运行时生效get-apibootstrap)）。

> **当前目录视图如何确定目标 cwd**：前端无从可靠推断「agent 解析后的真实 cwd」，故 `scope=cwd` 请求会带上当前活跃 `sessionId`，服务端以该会话的持久化 cwd 为准（`store.readHeader(sid).cwd`，`session-list-routes.ts:225-236`）；仅当 `sessionId` 缺失 / 无法解析时，才回退到 `cwd` 参数或服务端默认 cwd。

---

## 3. 展示位置与重定位（slot）

面板经宿主 `PiChat` 的 `slots` 注入，**默认位于左侧栏（`sidebar`）**，以追加方式占用所在区域，不替换、不遮挡既有对话区；同一区域若存在扩展（webext）贡献的内容，遵循既定宿主优先级与其共存。

展示位置由 `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` 控制，取值限 `PiChatSlots` 的可承载块级面板子集：

| 取值 | 位置 |
|---|---|
| `sidebar`（默认） | 左侧栏 |
| `header` | 顶部 |
| `footer` | 底部 |
| `empty` | 空态插槽区 |

非法 / 缺省取值一律回退 `sidebar`（`components/chat-app.tsx`）。宿主据此把 `<SessionListPanel>` 放入对应 slot（`sessionListSlots()`，`components/chat-app.tsx`）。

> 接线集中在宿主 `chat-app.tsx`，UI 包内不读 env——`SessionListPanel` 的数据源与回调均由宿主注入，组件本身不持 pi 接线。

---

## 4. 整行点击恢复

列表项**整行可点击**（无独立「恢复」按钮）：

- 每项显示 `name ?? sessionId`（主标题）+ `时间 · cwd`（副标题，时间取 `updatedAt ?? createdAt`，`session-list-panel.tsx`）。
- 点击经 `onResume(sessionId)` 上抛宿主（`session-list-panel.tsx`）。
- 宿主以 `window.location.assign('/session/:id')` 导航至该会话路由（`components/chat-app.tsx`）。

冷恢复链路：`/session/:id` 路由把 `resumeId` 传入 `chat-app`，经 `usePiSession` 以 `resumeId` 重建会话——这条链路同时**回溯 agent source**（否则 `create.source` 会回退为 `"."`，扩展的 region slots / background 等失效），随后 `GET /sessions/:id/messages` 回放历史消息，使对话从中断处接续。恢复失败时不破坏当前正在进行的会话。

```
点击列表项
  → onResume(sessionId)                          [SessionListPanel]
  → window.location.assign('/session/:id')       [chat-app 宿主]
  → resumeId 进 chat-app → usePiSession 重建会话   [冷恢复 + 回溯 agent source]
  → GET /sessions/:id/messages 回放历史           [接续上下文]
```

### 4.1 会话名来源与持久化

列表项主标题的显示名（`name ?? sessionId`）读的是 store 的 `SessionMeta.name`，其**读取口径统一**为「创建时头部名 → 最新 `session_info.name`」。写入这个名字有**两条来源，共用同一 `session_info` append 事件模型**：

1. **用户重命名**（[§9.2](#92-重命名内联编辑--最新显示名)）：`POST /sessions/rename` → 服务端 `store.append` 一条 `session_info{ name }`，成为最新显示名。
2. **自动会话标题扩展**：扩展经 `ctx.ui.setTitle(t)` 设置的标题原本只发一帧驱动前端**瞬态** `ambient.title`、**不写会话名**（故不进历史列表）。`wireSessionTitlePersistence` 以 prototype-patch `session.bindExtensions` 把 `setTitle` 包装为「先调原 `setTitle`（保留 ambient 展示）→ 再 best-effort `persistTitle` 写 `appendSessionInfo`」，落 sqlite/postgres + pi 原生 fs（`packages/server/src/runner/session-title-wiring.ts:1-20`）。

两条来源写的是**同一个会话名字段**，故自动标题与手动重命名**互相覆盖、后写为准**；且都经 `appendSessionInfo` 持久化，**冷恢复后保留**——恢复某会话时列表里显示的仍是最后一次写入的名字。本特性（重命名入口）只新增「写入新名」的用户路径，不改动读取口径。

---

## 5. HTTP 契约

只读列表端点经现有 `routes:` 注入接缝挂载（`createSessionListRoutes()`，与 `createConfigRoutes` 同构），与内置的 `POST /sessions`、`GET /sessions/:id/*` 共存。

```
GET /api/sessions?scope=&cwd=&sessionId=&limit=&cursor=
→ ListSessionsResponse
```

> **`/api` 前缀去哪了**：服务端宿主是 Hono，整个 `/api/*` 面收敛为一条 `app.all('/api/*')` 转发到 `createPiWebHandler` 单例（`server/index.ts`）；handler 内部路由**不带 `/api` 前缀**（注册为 `/sessions`、`/sessions/delete` 等）。故本章面向客户端一律写 `/api/sessions/...`（浏览器实际请求的路径），若你对照 `packages/server` 源码会看到路由声明为 `/sessions/...`——两者指同一端点，差的只是 Hono 层剥掉的 `/api` basePath。列表本身是纯读链路，恢复则走 SPA 的 `/session/:id` 路由（`src/app.tsx:24`、`src/routes/session.tsx:21` 把 `id` 作 `resumeId`）。

**请求参数**（query，`packages/protocol/src/transport/rest-dto.ts:187`）

| 参数 | 取值 | 说明 |
|---|---|---|
| `scope` | `cwd` \| `all` | 缺省 `cwd`；`all` 受全局门控 |
| `cwd` | string | `scope=cwd` 的目标目录（`sessionId` 不可用时的回退） |
| `sessionId` | string | `scope=cwd` 时优先以该会话的持久化 cwd 为目标目录 |
| `limit` | 正整数 | 单页上限，默认 50，硬 clamp 到 200 |
| `cursor` | string | 不透明 keyset 游标，续取下一页 |

**响应**（`rest-dto.ts:222`）

```jsonc
{
  "sessions": [
    { "sessionId": "...", "cwd": "...", "createdAt": "...", "updatedAt": "...", "name": "..." }
  ],
  "nextCursor": "...",     // 缺省表示无更多
  "scope": "cwd",          // 回显生效的 scope
  "globalEnabled": true     // 供前端确认系统视图可用性
}
```

**试一下**（dev 下 API 在 `:3000`，浏览器 UI 在 `:5173`；curl 直打 API 端口）：

```bash
# 当前目录视图首页(默认 scope=cwd, limit=50)——以某活跃会话的持久化 cwd 为目标目录
curl -s 'http://localhost:3000/api/sessions?sessionId=<活跃会话id>&limit=20' | jq

# 取下一页:把上一次响应里的 nextCursor 原样带回
curl -s 'http://localhost:3000/api/sessions?limit=20&cursor=<上页 nextCursor>' | jq '.sessions | length'

# 系统(全机器)视图:未开 NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL 时预期 403 SESSIONS_GLOBAL_DISABLED
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/sessions?scope=all'
```

预期：第一条返回 `{ "sessions": [...], "nextCursor": "...", "scope": "cwd", "globalEnabled": false }`；第三条在系统视图关闭时打印 `403`。

**分页（keyset）**：游标是 `base64url(JSON.stringify({ ts, id }))`，`ts = updatedAt ?? createdAt`、`id = sessionId`，取自上一页最后一项；服务端在排序序列中返回严格位于 `{ts,id}` 之后的项，保证续取**不重复**已返回会话，最终收敛（游标编解码与倒序比较 `session-list-routes.ts:70-112`，排序 + 切片 + `nextCursor` 生成 `256-263`）。分页在内存切片完成，store 仅提供 `list(cwd)` / `listAll()` 的轻量 header 元数据。

**错误**

| 状态 | code | 触发 |
|---|---|---|
| `400` | `INVALID_REQUEST` | `scope` / `limit` / `cursor` 非法（响应含出错字段） |
| `403` | `SESSIONS_GLOBAL_DISABLED` | `scope=all` 但系统视图未启用（不返回任何会话数据） |
| `500` | `INTERNAL` | 存储读取异常（前端展示可重试错误） |

> store 惰性单例：首次请求时 `await createSessionEntryStore(storeConfig)` 构造并缓存，配置与冷恢复同源（`sessionStoreConfigFromEnv()`），保证列表与恢复读到同一后端（`session-list-routes.ts:169-179`）。

### 5.1 会话操作端点（删除 / 重命名 / 收藏）

项级写操作经**另一组注入路由** `createSessionActionsRoutes()` 挂载（与 `createSessionListRoutes` 并列注入同一 `routes:` 接缝，`packages/server/src/session-actions/session-actions-routes.ts`），共四个端点，全部落在 `/sessions/**` 段：

| Method | Endpoint | 请求体 | 响应 | 门控 | 错误 |
|---|---|---|---|---|---|
| `POST` | `/api/sessions/delete` | `{ "sessionId": string }` | `{ "ok": true }` | 写门控 | 400 / 403 / 500 |
| `POST` | `/api/sessions/rename` | `{ "sessionId": string, "name": string }` | `{ "sessionId": string, "name": string }` | 写门控 | 400 / 403 / 404 / 500 |
| `GET` | `/api/sessions/favorites` | — | `{ "sessionIds": string[] }` | **不受门控** | 500 |
| `POST` | `/api/sessions/favorites` | `{ "sessionIds": string[] }` | `{ "sessionIds": string[] }` | 写门控 | 400 / 403 / 500 |

**为什么全是 `POST` 且路径无 `:id`**：Router 对任何含 `:id` 的路由做内存会话存在性门控（`router.ts:168`），历史（非运行中）会话必然 404;故这些端点一律**无 `:id` 路径参数**，`sessionId` 走请求体/查询，绕过门控作用于历史会话。写操作统一 `POST`（既有 `/sessions/**` 转发器只导出 GET/POST/DELETE），且刻意避开内置 `DELETE /sessions/:id`（停内存会话，语义完全不同）。

**逐端点行为**（均以 zod schema 校验请求体，`packages/protocol/src/transport/rest-dto.ts:337-377`）：

- **`POST /sessions/delete`** — `DeleteSessionRequestSchema`（`sessionId` 非空）。命中 `store.delete(sessionId)` **物理删除**（含头部与全部事件条目）;目标已不存在（`SessionStoreNotFoundError`）视为**幂等成功**（`{ ok: true }`），而非报错。
- **`POST /sessions/rename`** — `RenameSessionRequestSchema`（`sessionId` 非空;`name` 原串 `≤ 200`、`trim` 后非空）。先 `store.readHeader(sessionId)` 探测存在性——**不存在返回 `404 SESSION_NOT_FOUND`**（不为不存在的会话命名）;存在则 `store.append` 一条 `session_info{ name, id: randomUUID(), parentId: null, timestamp }`，使其成为**最新显示名**（服务端以 `trim` 结果落库，响应回显该名）。
- **`GET /sessions/favorites`** — 无请求体，返回已收藏的 `sessionIds` 集合（去重、无空串）;**不受写门控**，只读部署下仍可读出收藏用于置顶展示（Req 4.9）。
- **`POST /sessions/favorites`** — `SetSessionFavoritesRequestSchema`（`sessionIds` 字符串数组）。**全量替换**收藏集合并原子落盘，回读落盘结果返回（经 store 去重容错），前端据此确认最新集合。

**收藏是独立的用户偏好存储**：收藏集合落 `<agentDir>/session-favorites.json`（形态 `{ "sessionIds": string[] }`，`SessionFavoritesStore`，`packages/server/src/session-actions/session-favorites-store.ts`），与只读的会话枚举**完全独立**——它记录的是「哪些 `sessionId` 被用户置顶」这一偏好，不属于会话事件持久化。文件缺失 / 坏 JSON 一律容错回退空集（`list()` 不使请求失败）;`set()` 采用原子写（写 `<file>.<pid>.<counter>.tmp` 再 `rename`）避免半写被读到。它与启动导航区（LauncherRail）用的 agent-source 收藏（`agent-source-favorites.json` / `listFavorites` / `setFavorites`）**语义不同、文件独立、互不复用**。

**错误码**

| 状态 | code | 触发 |
|---|---|---|
| `400` | `INVALID_REQUEST` | 请求体不合 schema（缺 `sessionId`、空/超长 `name`、`sessionIds` 非数组等） |
| `403` | `SESSIONS_MANAGE_DISABLED` | 写门控关闭时命中删除 / 重命名 / 写收藏（不改动任何存储） |
| `404` | `SESSION_NOT_FOUND` | 重命名的目标会话在存储中不存在 |
| `500` | `INTERNAL` | 存储读写异常（前端展示可见错误并回滚乐观更新） |

> 对应 `PiClient` 方法（`packages/react/src/client/pi-client.ts`）：`deleteSessionHistory(sessionId)` → `CommandAck`、`renameSession(sessionId, name)` → `RenameSessionResponse`、`listSessionFavorites()` / `setSessionFavorites({ sessionIds })` → `ListSessionFavoritesResponse`。命名刻意与既有 `deleteSession`（停内存会话）/ `listFavorites`（agent source 收藏）区分，避免混淆。

---

## 6. 前端状态与交互

`SessionListPanel`（`packages/ui/src/elements/session-list-panel.tsx`）的三态可见：

- **加载中**：首屏加载显示 `loadingLabel`（默认「加载中…」）。
- **空态**：当前范围无会话时显示 `emptyLabel`（默认「暂无会话」），而非报错或空白。
- **错误**：加载失败显示 `errorLabel` + 可点击的**重试**按钮，而非静默空白。

视图切换仅在 `globalEnabled` 时出现「当前目录 / 全部」Tab；切 Tab 或数据源变化会重置并重新加载首页。`nextCursor` 存在时显示「加载更多」按钮续取并追加。组件内有**竞态守卫**（`reqIdRef`），快速切 Tab / 续取时丢弃过期响应（`session-list-panel.tsx:156`、`177`、`184`）。

> 列表项、Tab、三态、加载更多均带 `data-pi-session-list-*` 属性，供 e2e 与宿主定位。

---

## 7. 配置与环境变量小结

| 变量 | 默认 | 作用 | 读取处 |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `false` | `true`/`1` 开启系统（全机器）视图：显示「全部」Tab + 放行 `scope=all` | `bootstrap` 下发 → `chat-app.tsx`（前端）+ `pi-handler.ts:464` 注入 `globalEnabled`（服务端门控） |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | 面板展示位置（`sidebar`/`header`/`footer`/`empty`） | `bootstrap` 下发 → `chat-app.tsx`（`sessionsSlot()`） |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | 启用 | **写门控**：设为 `false` / `0` 关闭项级删除 / 重命名 / 收藏（前端隐藏写入口 + 服务端写端点 `403`）;其余取值（含未设）默认启用。读收藏（`GET /sessions/favorites`）不受此门控 | `bootstrap` 下发 → `chat-app.tsx`（前端 `manageEnabled`）+ `pi-handler.ts:477`（注入 `createSessionActionsRoutes({ manageEnabled })`） |

三者虽仍叫 `NEXT_PUBLIC_*`，但**已不是 Next 时代的构建期内联值**——现由服务端在 `GET /api/bootstrap` 请求时运行时读取并下发前端（见 [§7.1](#71-门控为何运行时生效get-apibootstrap)）。**改后重启服务端即生效，无需重新构建**；对 CLI 用户（`pi-web` 二进制本无 build 步骤）尤为关键。会话存储后端由既有 `sessionStoreConfigFromEnv()` 决定，与冷恢复同源;会话收藏另落独立文件 `<agentDir>/session-favorites.json`（不改动会话存储 schema，见 [§5.1](#51-会话操作端点删除--重命名--收藏)），本特性不引入新的存储后端配置。

### 7.1 门控为何运行时生效（`GET /api/bootstrap`）

Next 迁移到 Vite+SPA 后，这套门控的读取方式**根本改变**了，务必理解，否则会照着过时的「重新构建」指引白费力气：

- **Next 时代**：`NEXT_PUBLIC_*` 在客户端组件里被**构建期内联**成字面量——CLI 用户在运行时设置这些 env 其实**不生效**（`lib/app/runtime-features.ts:4-8` 文件头明确记录了这个坑）。
- **现在（SPA）**：服务端 `buildBootstrap()` 在每次 `GET /api/bootstrap` 请求时读 `process.env`（`server/bootstrap.ts:58-102`），把 `sessionsGlobal` / `sessionsManage` / `sessionsSlot` 等派生成 `RuntimeFeatures` 下发；SPA 启动时经 `setRuntimeFeatures()` 注入一次（`src/bootstrap.tsx:140`），此后 `chat-app.tsx` 全部门控经 `getRuntimeFeatures()` 惰性求值（`components/chat-app.tsx:210-286`）。于是 `pi-web --canvas` 这类**运行时开关终于能工作**。

因此本章所有 `NEXT_PUBLIC_PI_WEB_SESSIONS_*` 门控的正确操作口径是：**改 env → 重启服务端**（`node dist/server.mjs` 或 `pnpm dev`），**不需要也无法靠「重新构建」**。前后端读同一份 env，服务端门控（`lib/app/pi-handler.ts:464-478`）与前端下发的判定逐字段一致。

---

## 8. 故障排查 / 注意事项

- **「全部」Tab 不出现 / 切到系统视图报 403**：`NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` 未开启，或开启后未重启服务端（该值在 `GET /api/bootstrap` 时运行时下发，改后须重启，见 [§7.1](#71-门控为何运行时生效get-apibootstrap)）。服务端 403 与前端隐藏 Tab 是同一门控的双重保险，属预期行为。
- **当前目录视图列出的会话目录不符预期**：`scope=cwd` 以活跃 `sessionId` 的持久化 cwd 为准；若当前无活跃会话或该会话不可解析，会回退到 `cwd` 参数 / 服务端默认 cwd。
- **面板位置不对**：检查 `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` 取值是否落在 `sidebar`/`header`/`footer`/`empty` 之内；非法值静默回退 `sidebar`。
- **大量历史下首屏慢**：`scope=all` 走 `listAll` 全量扫桶 + 内存切片，开销随历史规模线性——默认关闭全局视图 + 分页（`limit` 默认 50、上限 200）是主要缓解手段。
- **点恢复后扩展 UI（region slots / background）失效**：恢复须经 `/session/:id` 冷恢复链路回溯 agent source；直接以 `resumeId` 之外的方式重挂会丢失 source。
- **⋯ 操作菜单不出现 / 删除·重命名·收藏写入口消失**：`NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` 被显式设为 `false` / `0`（写门控关闭），或改后未重启服务端（该值经 `GET /api/bootstrap` 运行时下发，见 [§7.1](#71-门控为何运行时生效get-apibootstrap)）。此时服务端也会对写请求返回 `403 SESSIONS_MANAGE_DISABLED`，属只读部署的预期行为;注意「收藏」分区仍会按已读收藏置顶展示（读收藏不受门控）。
- **删的是当前正在查看的会话**：删除成功后宿主会 `window.location.assign("/")` 导航至新会话空态，其余进行中的会话不受影响。
- **重命名报 404**：目标会话在存储中已不存在（如并发删除）;重命名不会为不存在的会话创建记录。删除则相反——删一个已不在的会话按幂等成功处理。

---

## 9. 会话项操作：重命名 / 收藏 / 删除

在整行点击恢复（[§4](#4-整行点击恢复)）之外，会话列表的**每个会话项**还带一个右侧 `⋯` 操作菜单，提供三项历史会话管理能力——**重命名**、**收藏 / 置顶**、**删除**——让用户在不离开聊天界面的前提下整理会话历史。菜单与项级交互由 `SessionItemMenu`（`packages/ui/src/elements/session-item-menu.tsx`）承载，挂进 `SessionListPanel` 的两条渲染路径（普通列表与启动导航区 `LauncherRail`）。

### 9.1 操作菜单入口与「不误触恢复」

- 每个会话项右侧渲染一个操作菜单触发入口（`⋯` 按钮），**悬停 / 键盘聚焦时显现**，其余时候可隐藏以保持列表整洁。
- 触发入口 `stopPropagation`，激活菜单**不会**触发整行的 `onResume`（恢复）——菜单交互与整行恢复互不误触。
- 菜单展开后，点击菜单外区域或按 Esc 关闭且无副作用。
- 写入口仅在**写门控启用且相应回调在场**时渲染;门控关闭时整组写入口隐藏（详见 [§9.5](#95-部署门控)）。
- 菜单、各菜单项、内联编辑输入、删除确认等均带稳定 `data-*` 定位属性（`data-pi-session-item-menu` / `-menu-content` / `-rename` / `-delete` / `-favorite` / `-rename-input` / `-delete-confirm` / `-delete-confirm-btn` / `-delete-cancel`），供 e2e 与宿主定位（`packages/ui/src/elements/session-item-menu.tsx`）。

### 9.2 重命名（内联编辑 → 最新显示名）

- 菜单选「重命名」进入该项**内联编辑态**，以当前显示名为初始值。
- 提交一个 `trim` 后非空的名称 → 经 `onRenameSession(id, name)` 上抛宿主 → `POST /sessions/rename` → 服务端向该会话 `append` 一条 `session_info`，使其成为**最新显示名**。前端乐观改名后由宿主 bump 刷新拉权威态，名称**跨刷新、跨视图一致**。
- `trim` 后为空的提交不发写请求、直接退出编辑保留原名;Esc / 取消同样放弃编辑、不发请求。
- 写失败（`500` 等）展示可见错误并回滚为原名。
- 显示名的**读取 / 派生口径**沿用会话列表既有规则（创建时头部名 → 最新 `session_info.name`，与 auto-session-title 共用同一 `session_info` 事件模型与持久化路径，见 [§4.1 会话名来源与持久化](#41-会话名来源与持久化)）;本特性只新增「写入新名」入口，不改读取规则。

### 9.3 收藏 / 置顶（独立偏好存储）

- 菜单选「收藏 / 取消收藏」→ 经 `onToggleFavorite(id, favorite)` 上抛宿主，宿主**读→算→写**：先 `listSessionFavorites()`，据目标态增删该 `sessionId`，再 `setSessionFavorites({ sessionIds })` 全量替换落盘，回读结果更新界面。
- 收藏以 **`sessionId` 为键**持久化在独立文件 `<agentDir>/session-favorites.json`（见 [§5.1](#51-会话操作端点删除--重命名--收藏)），与只读的会话枚举、与 agent-source 收藏均**互不相干**。因此同一会话在「当前目录」与「全部」两视图中收藏状态一致。
- 面板把 `favoriteSessionIds ∩ 当前视图会话` 求交，命中项在列表顶部以独立「**收藏**」分区置顶，并从普通列表中排除以免重复渲染;交集为空则**不渲染**该分区（不留空占位）。指向已删除会话的失效收藏 `sessionId` 因不在当前会话集合而被自然跳过，不报错、不渲染空条目。
- 收藏项在收藏分区与普通列表中**一致**地展示名称、恢复入口与 `⋯` 菜单（同样可重命名 / 删除 / 取消收藏）。
- **读收藏不受写门控**：只读部署下已持久化的收藏仍会被拉取用于置顶展示，仅写入（收藏 / 取消收藏）被门控拒绝。

### 9.4 删除（二次确认 + 不可逆物理删除）

- 菜单选「删除」→ 先弹**二次确认**（`dialog`）;确认前不发起删除，取消则列表不变。
- 确认后经 `onDeleteSession(id)` → `POST /sessions/delete` → 服务端 `store.delete()` **物理删除**该会话的头部与全部事件条目。删除**不可逆**——之后该会话不再出现在任一视图、也无法再被恢复。
- 删除成功后该项即时从列表移除（乐观移除 + 宿主 bump 刷新拉权威态），**无需整页手动刷新**。
- 删的是**当前正在查看**的会话时，宿主删除成功后 `window.location.assign("/")` 导航至新会话空态，其余进行中的会话不受影响。
- 目标会话已不存在按**幂等成功**处理（仍从列表移除）;删除因存储错误失败则展示可见错误并保留该项（不静默丢失、不误报成功）。

### 9.5 部署门控

三项**写**操作（删除 / 重命名 / 收藏）由 `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` 整体门控，**默认启用**，面向只读 / 受限部署可整体关闭。门控是双重保险：

- 前端：门控关闭 → 面板**不渲染**任何写入口（`⋯` 写菜单项隐藏）。
- 服务端：门控关闭 → 删除 / 重命名 / 写收藏端点一律返回 `403 SESSIONS_MANAGE_DISABLED` 且**不改动任何存储**;`GET /sessions/favorites` 例外，始终可读。

值经 `GET /api/bootstrap` 运行时下发，前端 `chat-app.tsx` 读取（`manageEnabled = 值 !== "false" && 值 !== "0"`），服务端 `pi-handler.ts:477` 以同一判定注入 `createSessionActionsRoutes({ manageEnabled })`——前后端读同一 env、语义一致，改后重启服务端即生效（见 [§7.1](#71-门控为何运行时生效get-apibootstrap)）。

### 9.6 一致性与并发

- 任一写操作成功 → 面板乐观更新（删除移除 / 重命名改名 / 收藏移动分区）+ 宿主 bump `refreshSignal` 拉权威态使显示与最新持久化一致，无需用户整页刷新（复用与新会话、auto_title 同一刷新通道）。
- 某项有写请求在途时提供可感知的进行中反馈（如禁用重复触发），避免对同一项重复发起冲突请求。
- 沿用面板既有 `reqIdRef` **竞态守卫**：列表因其它原因刷新时，不因过期响应覆盖较新状态。
- 菜单展开 / 内联编辑 / 二次确认等瞬态交互进行时，「当前会话高亮」「所在视图 Tab」等既有状态不被打断。

---

## 下一步 / 相关

- 会话项操作端点（删除 / 重命名 / 收藏）与 `/sessions/**` 其余端点、`GET /api/bootstrap` 运行时门控下发 → [24 HTTP/SSE API 参考](./24-http-api-reference.md)、本章 [§5.1](#51-会话操作端点删除--重命名--收藏)
- 宿主 `slots` 与界面布局 → [12 Web UI 扩展](./12-web-ui-extension.md)
- 会话管理写门控 `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE`、`GET /api/bootstrap` 运行时下发机制与环境变量总览 → [06 配置参考](./06-configuration.md)、本章 [§7.1](#71-门控为何运行时生效get-apibootstrap) / [§9.5](#95-部署门控)
- 同属会话内建 UI 特性、随本章一起上提的排队 / 取回 → [15 消息队列](./15-message-queue.md)
