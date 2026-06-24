# 21 · 会话列表

会话列表（Sessions List）让用户在 Web UI 内**浏览历史会话**并**一键恢复**任意会话继续对话——无需手动记忆或输入会话 id。会话历史一直由底层持久化（每个会话按其工作目录 cwd 分桶，含 id / cwd / 创建·修改时间 / 可选名称等头部元数据），此前却从未在界面暴露；本特性把这份历史以一个可重定位的只读面板嵌入聊天界面，不占用、不替换既有对话区。

---

## 1. 它解决什么 / 能力边界

**In scope**

- 两类视图：**当前目录会话**（仅当前 cwd）与**系统会话**（本机全部目录），后者默认关闭、需部署方显式开启。
- 列表项展示足以区分会话的**轻量元数据**：名称或标识、时间（创建或最近修改）、所属工作目录。
- 从列表整行点击直接**恢复**某历史会话进入对话，回放历史上下文。
- 大规模会话集合下的**分页**（keyset 游标续取）与**倒序排序**。
- 展示位置由配置控制（默认左侧栏），并可重定位到其它界面区域。

**Out of scope**

- 会话的删除 / 重命名 / 归档 / 搜索·全文检索（本期不做，留待后续）。
- 列表项展示消息条数、首条消息摘要等需读取**会话正文**的重型字段——本期只用文件头部轻量元数据。
- 跨机器 / 远端会话聚合（仅限本机持久化的会话）。
- 新建会话入口（已由现有界面提供，不在本特性内重做）。

设计上：服务端只负责「读 + 排序 + 分页 + 门控」，前端只负责「展示 + 切换 + 触发恢复」，恢复本身复用既有的 `resumeId` 冷恢复链路，不改动会话运行 / 流式内核，不改动持久化存储 schema。

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

要开启系统视图，部署方需在构建期设置 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true`（或 `=1`）——该值在 client 端读取并构建期内联（`components/chat-app.tsx:172`）。

> **当前目录视图如何确定目标 cwd**：前端无从可靠推断「agent 解析后的真实 cwd」，故 `scope=cwd` 请求会带上当前活跃 `sessionId`，服务端以该会话的持久化 cwd 为准（`session-list-routes.ts:168-177`）；仅当 `sessionId` 缺失 / 无法解析时，才回退到 `cwd` 参数或服务端默认 cwd。

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

非法 / 缺省取值一律回退 `sidebar`（`components/chat-app.tsx:184-189`）。宿主据此把 `<SessionListPanel>` 放入对应 slot（`sessionListSlots()`，`components/chat-app.tsx:192-204`）。

> 接线集中在宿主 `chat-app.tsx`，UI 包内不读 env——`SessionListPanel` 的数据源与回调均由宿主注入，组件本身不持 pi 接线。

---

## 4. 整行点击恢复

列表项**整行可点击**（无独立「恢复」按钮）：

- 每项显示 `name ?? sessionId`（主标题）+ `时间 · cwd`（副标题，时间取 `updatedAt ?? createdAt`，`session-list-panel.tsx:52-56`）。
- 点击经 `onResume(sessionId)` 上抛宿主（`session-list-panel.tsx:208-211`）。
- 宿主以 `window.location.assign('/session/:id')` 导航至该会话路由（`components/chat-app.tsx:363-368`）。

冷恢复链路：`/session/:id` 路由把 `resumeId` 传入 `chat-app`，经 `usePiSession` 以 `resumeId` 重建会话——这条链路同时**回溯 agent source**（否则 `create.source` 会回退为 `"."`，扩展的 region slots / background 等失效），随后 `GET /sessions/:id/messages` 回放历史消息，使对话从中断处接续。恢复失败时不破坏当前正在进行的会话。

```
点击列表项
  → onResume(sessionId)                          [SessionListPanel]
  → window.location.assign('/session/:id')       [chat-app 宿主]
  → resumeId 进 chat-app → usePiSession 重建会话   [冷恢复 + 回溯 agent source]
  → GET /sessions/:id/messages 回放历史           [接续上下文]
```

---

## 5. HTTP 契约

只读列表端点经现有 `routes:` 注入接缝挂载（`createSessionListRoutes()`，与 `createConfigRoutes` 同构），与内置的 `POST /sessions`、`GET /sessions/:id/*` 共存。

```
GET /api/sessions?scope=&cwd=&sessionId=&limit=&cursor=
→ ListSessionsResponse
```

**请求参数**（query，`packages/protocol/src/transport/rest-dto.ts:177`）

| 参数 | 取值 | 说明 |
|---|---|---|
| `scope` | `cwd` \| `all` | 缺省 `cwd`；`all` 受全局门控 |
| `cwd` | string | `scope=cwd` 的目标目录（`sessionId` 不可用时的回退） |
| `sessionId` | string | `scope=cwd` 时优先以该会话的持久化 cwd 为目标目录 |
| `limit` | 正整数 | 单页上限，默认 50，硬 clamp 到 200 |
| `cursor` | string | 不透明 keyset 游标，续取下一页 |

**响应**（`rest-dto.ts:207`）

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

**分页（keyset）**：游标是 `base64url(JSON.stringify({ ts, id }))`，`ts = updatedAt ?? createdAt`、`id = sessionId`，取自上一页最后一项；服务端在排序序列中返回严格位于 `{ts,id}` 之后的项，保证续取**不重复**已返回会话，最终收敛（`session-list-routes.ts:60-89`、`181-187`）。分页在内存切片完成，store 仅提供 `list(cwd)` / `listAll()` 的轻量 header 元数据。

**错误**

| 状态 | code | 触发 |
|---|---|---|
| `400` | `INVALID_REQUEST` | `scope` / `limit` / `cursor` 非法（响应含出错字段） |
| `403` | `SESSIONS_GLOBAL_DISABLED` | `scope=all` 但系统视图未启用（不返回任何会话数据） |
| `500` | `INTERNAL` | 存储读取异常（前端展示可重试错误） |

> store 惰性单例：首次请求时 `await createSessionEntryStore(storeConfig)` 构造并缓存，配置与冷恢复同源（`sessionStoreConfigFromEnv()`），保证列表与恢复读到同一后端（`session-list-routes.ts:115-120`）。

---

## 6. 前端状态与交互

`SessionListPanel`（`packages/ui/src/elements/session-list-panel.tsx`）的三态可见：

- **加载中**：首屏加载显示 `loadingLabel`（默认「加载中…」）。
- **空态**：当前范围无会话时显示 `emptyLabel`（默认「暂无会话」），而非报错或空白。
- **错误**：加载失败显示 `errorLabel` + 可点击的**重试**按钮，而非静默空白。

视图切换仅在 `globalEnabled` 时出现「当前目录 / 全部」Tab；切 Tab 或数据源变化会重置并重新加载首页。`nextCursor` 存在时显示「加载更多」按钮续取并追加。组件内有**竞态守卫**（`reqIdRef`），快速切 Tab / 续取时丢弃过期响应（`session-list-panel.tsx:87`、`108`）。

> 列表项、Tab、三态、加载更多均带 `data-pi-session-list-*` 属性，供 e2e 与宿主定位。

---

## 7. 配置与环境变量小结

| 变量 | 默认 | 作用 | 读取处 |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `false` | `true`/`1` 开启系统（全机器）视图：显示「全部」Tab + 放行 `scope=all` | `chat-app.tsx:172`（前端）+ `pi-handler` 注入 `globalEnabled`（服务端门控） |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | 面板展示位置（`sidebar`/`header`/`footer`/`empty`） | `chat-app.tsx:184` |

两者均为 `NEXT_PUBLIC_*`，在 client 端读取、**构建期内联**——更改后需重新构建生效。会话存储后端由既有 `sessionStoreConfigFromEnv()` 决定，与冷恢复同源，本特性不引入新的存储配置。

---

## 8. 故障排查 / 注意事项

- **「全部」Tab 不出现 / 切到系统视图报 403**：`NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` 未开启，或开启后未重新构建（该值构建期内联）。服务端 403 与前端隐藏 Tab 是同一门控的双重保险，属预期行为。
- **当前目录视图列出的会话目录不符预期**：`scope=cwd` 以活跃 `sessionId` 的持久化 cwd 为准；若当前无活跃会话或该会话不可解析，会回退到 `cwd` 参数 / 服务端默认 cwd。
- **面板位置不对**：检查 `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` 取值是否落在 `sidebar`/`header`/`footer`/`empty` 之内；非法值静默回退 `sidebar`。
- **大量历史下首屏慢**：`scope=all` 走 `listAll` 全量扫桶 + 内存切片，开销随历史规模线性——默认关闭全局视图 + 分页（`limit` 默认 50、上限 200）是主要缓解手段。
- **点恢复后扩展 UI（region slots / background）失效**：恢复须经 `/session/:id` 冷恢复链路回溯 agent source；直接以 `resumeId` 之外的方式重挂会丢失 source。

---

## 下一步 / 相关

- 会话生命周期与 `/sessions/**` 其余端点 → [13 HTTP/SSE API 参考](./13-http-api-reference.md)
- 宿主 `slots` 与界面布局 → [10 Web UI 扩展](./10-web-ui-extension.md)
- 环境变量总览 → [05 配置参考](./05-configuration.md)
