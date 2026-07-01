# Research & Design Decisions — session-list-item-actions

## Summary
- **Feature**: `session-list-item-actions`
- **Discovery Scope**: Extension（在既有 sessions-list / launcher-rail / session-store 之上增写操作接缝）
- **Key Findings**:
  - **路由 `:id` 门控是核心约束**：`packages/server/src/http/router.ts:168` 对任何含 `:id` 路径参数的路由做 `store.get(sessionId)` 存在性校验（内存中正在运行的会话），命中不到即 `404 SESSION_NOT_FOUND`。历史会话按定义**不在内存**，故删除 / 重命名端点**不能**用 `:id` 路径参数，必须把 `sessionId` 放在请求体 / 查询里、走无 `:id` 的路径。
  - **底层能力大半就绪**：`SessionEntryStore.delete()`（fs/sqlite/pg 三后端物理删除）、`append()` + `session_info` 条目 + `displayName()`（改显示名机制，auto-title 同款）、`createFavoritesStore()`（原子写 JSON 偏好，现服务于 agent source）。
  - **现有 DELETE /sessions/:id 不可复用**：`makeDeleteSessionHandler` 只 `session.stop()` 停内存会话、要求会话在跑、不碰持久化（`packages/server/src/http/routes/delete-session.ts`）。

## Research Log

### 路由匹配与 `:id` 门控
- **Context**: 删除 / 重命名针对的是历史（非运行）会话，需确认端点能否命中。
- **Sources Consulted**: `packages/server/src/http/router.ts:124-194`、`create-handler.ts:101-219`、`routes/delete-session.ts`。
- **Findings**:
  - Router 逐条匹配 `method + path`；`matched.params["id"]` 仅在路由模板含 `:id` 段时非空。
  - 仅当 `params["id"]` 非空时才触发 `store.get(id)` 存在性门控（内存 `SessionStore`，非持久化 `SessionEntryStore`）。
  - 内置 2 段路由只有 `DELETE /sessions/:id`；`GET/POST` 的 2 段 `[sessions, X]` 无内置占用；`GET /sessions/:id/*` 均为 3 段且第 3 段为固定字面量（messages/model/…）。
- **Implications**: 新写端点用 `POST /sessions/delete`、`POST /sessions/rename`、`GET|POST /sessions/favorites`——皆 2 段、无 `:id` 参数 → **绕过内存门控**，且与内置路由零冲突。

### Next catch-all 转发器方法集
- **Context**: 记忆中「新顶层 API 段须自带 catch-all 转发器否则静默 404」。
- **Sources Consulted**: `app/api/sessions/[[...path]]/route.ts`。
- **Findings**: 该转发器仅导出 `GET / POST / DELETE`（无 PUT/PATCH）。DELETE 分支对**恰好** `/api/sessions/:id` 附带 `forgetSessionSource` 清理。新端点全部落在 `/sessions/**` 下 → **复用现有转发器**，无需新增顶层段。
- **Implications**: 写操作统一用 **POST**（转发器已导出），避免新增 PUT/PATCH 方法导出；不新建顶层 API 段。

### 重命名的持久化机制
- **Sources Consulted**: `runner/session-title-wiring.ts`、`session-store/{types,fs-store,sqlite-store,postgres-store}.ts`。
- **Findings**: 显示名口径 = 最新 `session_info` 条目的 `name`。fs 后端 `displayName()` 扫文件取最新；sqlite/pg 在 `append(session_info)` 时更新去规范化 `name` 列。`SessionInfoEntry = SessionEntryBase & { type:"session_info"; name }`，`SessionEntryBase = { id; parentId: string|null; timestamp }`。
- **Implications**: 重命名 = 用**新生成的 `id`、`parentId: null`、当前 `timestamp`** append 一条 `session_info{name}`，三后端一致地把它变为最新显示名；无需新增 store 方法，复用既有 `append()`。

### UI 基础组件盘点
- **Sources Consulted**: `packages/ui/src/ui/`。
- **Findings**: 有 `popover.tsx`、`dialog.tsx`、`input.tsx`、`button.tsx`、`command.tsx`、`select.tsx`；**无 dropdown-menu**。
- **Implications**: `⋯` 操作菜单基于 `popover` 构建；二次确认复用 `dialog`；内联重命名复用 `input`。无需引入新第三方原语。

### 前端接线现状
- **Sources Consulted**: `components/chat-app.tsx:220-590`、`packages/react/src/client/pi-client.ts:80-170,206-303`。
- **Findings**: 会话列表有两条渲染路径——旧 `SessionListPanel`（默认）与 `LAUNCHER_RAIL_ENABLED` 的 `LauncherRail`（已接 `listFavorites/setFavorites/listSessions/onResume`）。`piClient.listFavorites/setFavorites` 与 `deleteSession(id)` **均服务于既有语义**（前者 = agent source 收藏；后者 = DELETE /sessions/:id 停会话），**不可复用**于本特性。
- **Implications**: 需**新增**独立 client 方法（session 维度收藏 + 物理删除 + 重命名），前端两条路径都要接新回调 + 门控开关。

## Design Decisions

### Decision: 写端点绕过 `:id` 门控，统一 POST、复用 /sessions 转发器
- **Alternatives Considered**:
  1. 复用 `DELETE /sessions/:id` —— 被内存门控挡死（历史会话不在内存），且语义是「停会话」。否决。
  2. 用 `:sessionId` 参数名规避门控（门控键为字面 `"id"`）—— 依赖脆弱的命名巧合，reviewer 易误改。否决。
  3. 新顶层段 `/session-management/**` —— 需新增 catch-all 转发器（记忆坑）。否决。
  4. **无 `:id` 参数、body/query 携带 sessionId、统一 POST、挂 `/sessions/**`**。选定。
- **Selected Approach**: `POST /sessions/delete`、`POST /sessions/rename`、`GET|POST /sessions/favorites`，经 `createSessionActionsRoutes()`（与 `createSessionListRoutes` 并列）注入 `routes:` 接缝。
- **Trade-offs**: 删除用 POST 非纯 REST，但与本仓命令端点（steer/abort/model 皆 POST）idiom 一致；换来零门控风险、零路由冲突、零转发器改动。

### Decision: session 收藏独立存储，全量替换语义
- **Selected Approach**: 复用 `createFavoritesStore` 的原子写 JSON 范式，新建 `<agentDir>/session-favorites.json`，形态 `{ "sessionIds": string[] }`；读 `GET /sessions/favorites`、写 `POST /sessions/favorites`（全量替换，幂等，回显落盘结果）。
- **Rationale**: 与 agent-source 收藏同范式、同容错（缺失/坏 JSON → 空集，不使请求失败）；全量替换与前端「读→算→写」既有 dance 一致。
- **Trade-offs**: 收藏项失效（会话已删）时列表侧需容错跳过；不做级联清理（删除会话不主动摘收藏，靠展示侧按 sessionId 求交跳过失效项）。

### Decision: 写操作部署门控 `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE`
- **Selected Approach**: 默认**启用**；`=false`/`=0` 时前端隐藏写入口、服务端三个写端点返回 403 且不改存储；收藏**读**不受门控（仍可置顶展示）。与 `SESSIONS_GLOBAL` 双重门控范式一致（构建期内联 + 服务端权威）。

## Risks & Mitigations
- **out-of-band append 破坏会话树** — `session_info` 不参与 message 树（`parentId` 可为 null，类比 header 注释「不参与 id/parentId 树结构」）；append 仅追加不重写，幂等键 `(sessionId, entry.id)`，用新 UUID 规避碰撞。集成测试验证 append 后 `read()` 仍可完整回放 + `displayName` 更新。
- **删除误挡于门控 / 命中 stop 语义** — 端点无 `:id` 参数（不进门控）、用 POST（不撞 DELETE /sessions/:id）；单测覆盖历史会话（未运行）删除成功。
- **两条前端渲染路径漏接** — 设计显式要求 `SessionListPanel` 与 `LauncherRail` 两路都接新回调；e2e 覆盖默认路径。
- **收藏与既有 agent-source 收藏混淆** — 新 client 方法命名区分（`listSessionFavorites`/`setSessionFavorites`），新存储文件独立。

## References
- 项目手册 `docs/product/21-sessions-list.md` — 会话列表能力边界（本特性把其 Out-of-scope 的删/改/收藏纳入）。
- 记忆 `[[sidebar-launcher-rail-spec]]`、`[[agent-sources-list-spec]]`、`[[auto-session-title-extension]]`、`[[pi-web-session-list-refresh]]` — 收藏存储、转发器坑、显示名机制、列表重拉信号。
