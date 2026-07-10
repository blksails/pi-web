# 13 · HTTP API 参考

pi-web 通过四个 Next.js catch-all Route Handler 将所有会话、配置、附件操作统一暴露为标准 REST + SSE 接口，底层由框架无关的 `createPiWebHandler` 工厂驱动。

---

## 架构概览

```
Next.js Route Handler (app/api/*/route.ts)
         │
         ▼
  getHandler()  ← lib/app/pi-handler.ts 单例
         │
         ▼
  createPiWebHandler(opts)
  packages/server/src/http/create-handler.ts
         │
         ├── Router  (方法 + 路径分发)
         ├── 内置端点处理器  (sessions / config / attachments)
         └── 注入端点  (config-routes / attachment-routes)
```

**四个 catch-all 路由**：

| 路由文件 | 覆盖路径前缀 | 支持方法 |
|---|---|---|
| `app/api/sessions/[[...path]]/route.ts` | `/api/sessions/**` | GET、POST、DELETE |
| `app/api/config/[[...path]]/route.ts` | `/api/config/**` | GET、PUT |
| `app/api/attachments/[[...path]]/route.ts` | `/api/attachments/**` | GET |
| `app/api/session-source/route.ts` | `/api/session-source` | POST |

所有路由均强制 `runtime = "nodejs"`（子进程驻留 + SSE 长连接，不支持 Edge/Serverless）。

**端点速查**（按用途分组，详见对应小节）：

| 用途 | 端点 |
|---|---|
| 会话生命周期 | `POST /sessions`、`DELETE /sessions/:id` |
| 会话列表 | `GET /sessions`（列出历史会话，分页） |
| 事件订阅 | `GET /sessions/:id/stream`（SSE） |
| 发消息 / 引导 | `POST /sessions/:id/messages`、`/steer`、`/follow_up`、`/abort` |
| 会话控制 | `POST /sessions/:id/model`、`/thinking`、`/fork`、`/ui-response`、`/ui-rpc` |
| 会话查询 | `GET /sessions/:id/state`、`/stats`、`/messages`、`/commands`、`/models`、`/fork-messages`、`/completion` |
| Agent 声明式 routes | `GET /sessions/:id/agent-routes`、`GET·POST /sessions/:id/agent-routes/:name` |
| 配置 | `GET·PUT /config/:domain`、`GET /config/models` |
| 附件 | `POST /sessions/:id/attachments`、`GET /attachments/:id/raw` |
| 来源映射 | `POST /session-source` |

---

## 通用约定

### 响应结构

成功响应返回 JSON 对象，HTTP 状态码视端点而定（见下文）。  
所有响应（成功与错误）均携带协议版本响应头与响应体字段（当前协议版本为 `0.1.0`，定义于 `packages/protocol/src/version.ts`）：

```
X-Pi-Protocol-Version: 0.1.0
```

成功响应体也会注入 `protocolVersion` 字段（由 `jsonResponse` 统一附加）。

错误响应统一结构：

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session \"abc\" not found.",
    "fields": ["source"]
  },
  "protocolVersion": "0.1.0"
}
```

`fields` 仅在请求体校验失败（400）时出现，值为出错字段路径列表。

### 错误码映射

| 场景 | HTTP 状态 | code |
|---|---|---|
| `SessionNotFoundError` / `:id` 不存在 | 404 | `SESSION_NOT_FOUND` |
| `SessionStoppedError` | 409 | `SESSION_STOPPED` |
| `UnknownExtensionUIError` | 409 | `UNKNOWN_EXTENSION_UI` |
| `MissingInputError` | 400 | `MISSING_INPUT` |
| body 非 JSON | 400 | `INVALID_JSON` |
| body DTO 校验失败 | 400 | `VALIDATION_FAILED`（带 `fields`） |
| 停机中（不再接受新会话） | 503 | `SHUTTING_DOWN` |
| 上游 RPC 命令失败 | 502 | `UPSTREAM_ERROR` |
| 路径无匹配 | 404 | `NOT_FOUND` |
| 路径匹配但方法不符 | 405 | `METHOD_NOT_ALLOWED` |
| 未知异常 | 500 | `INTERNAL` |

> code 字面量来源：会话引擎错误码见 `packages/server/src/session/session.errors.ts:7`（`SESSION_STOPPED` / `SESSION_NOT_FOUND` / `UNKNOWN_EXTENSION_UI` / `MISSING_INPUT`）；HTTP 层 code 见 `packages/server/src/http/error-map.ts` 与各 route handler。

版本不兼容（客户端声明 `X-Pi-Protocol-Version` 主版本与服务端 `0` 不符；未声明则放行）：  
→ 426 `PROTOCOL_VERSION_MISMATCH`

鉴权接缝（默认放行）：  
→ `authResolver` 拒绝：401 `UNAUTHORIZED`；`authorizeSession` 返回 false：403 `FORBIDDEN`

---

## Sessions API — `/api/sessions/**`

### POST /api/sessions — 创建会话

建立新的 agent 会话，返回服务端生成的 `sessionId`（由主进程 `randomUUID()` 主导，下传给 agent 以对齐持久化文件 id）。

**请求体** (`CreateSessionRequestSchema`，见 `packages/protocol/src/transport/rest-dto.ts:38`)：

```json
{
  "source": "/path/to/agent",
  "cwd": "/working/dir",
  "model": "claude-opus-4-5",
  "env": { "MY_VAR": "value" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source` | string | 是 | agent 源路径或标识 |
| `cwd` | string | 否 | 工作目录 |
| `model` | string | 否 | 覆盖默认模型 |
| `env` | object（string→string） | 否 | 额外环境变量 |
| `trust` | boolean | 否 | 显式项目信任意图，门控 `.pi/` 扩展/子代理/技能加载；缺省由服务端信任策略决定 |
| `resumeId` | string | 否 | 给定即"恢复已有会话"而非新建；服务端据持久化元数据恢复，缺失即新建 |

**成功响应** 201：

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "protocolVersion": "0.1.0" }
```

> `sessionId` 是 UUID（示例中其他端点用 `sess_abc` 仅为占位）。

**错误**：400（缺 `source` 或 DTO 校验失败）、503（服务停机中）

**curl 示例**：

```bash
curl -X POST http://localhost:3010/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"source": "/path/to/.pi", "cwd": "/workspace"}'
```

---

### GET /api/sessions — 列出历史会话

列出本机持久化的历史会话（仅会话头部轻量元数据，不读正文），用于会话列表面板的浏览与恢复。经 `routes:` 注入接缝挂载（`createSessionListRoutes()`），与内置 sessions 端点共存。按 `updatedAt ?? createdAt` 倒序、keyset 游标分页。

**查询参数** (`ListSessionsRequestSchema`，见 `packages/protocol/src/transport/rest-dto.ts:177`)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `scope` | `"cwd"` \| `"all"` | 否 | 缺省 `cwd`（当前目录）；`all`（系统/全机器）受全局门控 |
| `cwd` | string | 否 | `scope=cwd` 的目标目录（`sessionId` 不可用时的回退） |
| `sessionId` | string | 否 | `scope=cwd` 时优先以该会话的持久化 cwd 为目标目录 |
| `limit` | 正整数 | 否 | 单页上限，默认 50，硬 clamp 到 200 |
| `cursor` | string | 否 | 不透明 keyset 游标（`base64url(JSON.stringify({ ts, id }))`），续取下一页 |
| `q` | string | 否 | 名称搜索关键字（sidebar-launcher-rail）：非空时按会话名称/标识子串（大小写不敏感）过滤，置于排序/分页前；缺省/空串行为不变（向后兼容）。限长 100。仅匹配名称，不检索正文 |

**成功响应** 200（`ListSessionsResponse`，见 `rest-dto.ts:207`）：

```jsonc
{
  "sessions": [
    {
      "sessionId": "550e8400-...",
      "name": "重构 auth 模块",   // 可选
      "cwd": "/workspace",
      "createdAt": "2025-06-01T08:00:00.000Z",
      "updatedAt": "2025-06-01T09:30:00.000Z"  // 可选（部分存储后端无此值）
    }
  ],
  "nextCursor": "eyJ0cyI6...",  // 缺省表示无更多页
  "scope": "cwd",                // 回显生效的 scope
  "globalEnabled": true,         // 系统视图是否启用，供前端确认入口可用性
  "protocolVersion": "0.1.0"
}
```

**错误**：

| 状态 | code | 触发 |
|---|---|---|
| 400 | `INVALID_REQUEST` | `scope` / `limit` / `cursor` 非法（响应含出错字段） |
| 403 | `SESSIONS_GLOBAL_DISABLED` | `scope=all` 但系统视图未启用（不触达存储，不返回任何会话数据） |
| 500 | `INTERNAL` | 存储读取异常 |

```bash
curl "http://localhost:3010/api/sessions?scope=cwd&limit=50"
```

> 系统视图（`scope=all`）默认关闭，需部署方设 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true`。分页、门控、前端三态与重定位等完整机制详见 [14 · 会话列表](14-sessions-list.md)。
>
> **实现参考**：`packages/server/src/session-list/session-list-routes.ts`

### GET /api/agent-sources — 列出可用的 agent source

只读枚举「当前环境下可用的 agent source」，供新建会话选择器（`AgentSourcePicker`）浏览、点选后以其 `source` 直接创建会话（等价手输）。数据来源为**两路合并**：目录扫描（`PI_WEB_SOURCES_ROOT` 下的一级子目录，复用源探测语义判定 custom/cli）∪ 注册表文件（`PI_WEB_SOURCES_REGISTRY` JSON），按 `id` 去重（注册表覆盖扫描）。经 `routes:` 注入接缝挂载（`createAgentSourcesRoutes()`）。

**严格只读**：处理请求时不写文件、不 clone git、不 resolve/spawn 会话子进程。未配任何来源时返回空列表（成功）。

**查询参数** (`ListAgentSourcesRequestSchema`，见 `packages/protocol/src/transport/rest-dto.ts`)：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `limit` | 正整数 | 否 | 单页上限，默认 100，硬 clamp 到 500 |
| `cursor` | string | 否 | 不透明 keyset 游标（`base64url(JSON.stringify({ id }))`），续取下一页 |

**成功响应** 200（`ListAgentSourcesResponse`）：

```jsonc
{
  "sources": [
    {
      "id": "/abs/examples/hello-agent",   // 稳定标识：dir→realpath；git→url@ref
      "source": "/abs/examples/hello-agent", // 直接提交给 POST /sessions 的 source
      "name": "hello-agent",                // 技术名：package.json name > 目录/repo 末段
      "kind": "dir",                        // "dir" | "git"
      "origin": "scan",                     // "scan" | "registry"
      "mode": "custom",                     // "custom"（含入口）| "cli"
      "title": "Hello Agent",               // 可选展示标题（pi-web.title / registry.title）；列表用 title ?? name
      "description": "…",                   // 可选（pi-web.description / registry.description / package.json description）
      "avatar": "🤖"                        // 可选头像：图片 URL/data-URI→<img>；否则短文本/emoji；缺省用标题首字母
    }
  ],
  "nextCursor": "eyJpZCI6...",  // 缺省表示无更多页
  "protocolVersion": "0.1.0"
}
```

**展示元数据来源**：目录扫描的源从其 `package.json` 的 `pi-web` 字段(与 `pi-web.entry` 同处)取 `title` / `description` / `avatar`,`name` 仍取 `package.json` 顶层 name,`description` 回退顶层 description。注册表登记项可直接声明 `title` / `description` / `avatar`。前端源列表以宽屏卡片网格展示,每卡片含头像 + `title ?? name` + 模式徽标 + 描述 + 收藏星标。

```jsonc
// 示例源的 package.json 片段
{
  "name": "hello-agent",
  "pi-web": {
    "entry": "index.ts",
    "title": "Hello Agent",
    "description": "最简回声 agent,用于上手演示",
    "avatar": "🤖"
  }
}
```

**错误**：

| 状态 | code | 触发 |
|---|---|---|
| 400 | `INVALID_REQUEST` | `limit` / `cursor` 非法（响应含出错字段） |
| 500 | `INTERNAL` | 装配/序列化等意外失败（来源缺失/损坏不算，退化为空贡献） |

```bash
curl "http://localhost:3010/api/agent-sources?limit=100"
```

> 前端是否展示源列表由构建期 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1` 门控；后端来源由 `PI_WEB_SOURCES_ROOT`（`path.delimiter` 分隔多个）与 `PI_WEB_SOURCES_REGISTRY`（默认 `<agentDir>/sources.json`）配置。三者详见 [06 · 配置](06-configuration.md)。
>
> **实现参考**：`packages/server/src/agent-source-list/`

### GET·PUT /api/agent-sources/favorites — agent source 收藏（读写）

收藏是**用户偏好**（sidebar-launcher-rail），独立于只读源枚举 `/agent-sources`；持久化在 `<agentDir>/agent-source-favorites.json`，供侧栏启动导航区渲染一键启动锚点。经 `createFavoritesRoutes()` 注入，挂在 `/api/agent-sources/**` catch-all 转发器下（GET+PUT）。收藏/取消收藏**不修改**源枚举来源（扫描目录/注册表）。

- **GET** → `ListFavoritesResponse`：`{ "favorites": [ { "source": "...", "name": "..." } ] }`。文件缺失/损坏容错返回其余可用项。
- **PUT** `{ favorites }` → `ListFavoritesResponse`（回显落盘结果）：**全量替换**（幂等），原子 tmp+rename 写。body 非法 → `400 INVALID_REQUEST`。

```bash
curl -X PUT "http://localhost:3010/api/agent-sources/favorites" \
  -H "Content-Type: application/json" \
  -d '{"favorites":[{"source":"./examples/hello-agent","name":"hello-agent"}]}'
```

| 状态 | code | 触发 |
|---|---|---|
| 400 | `INVALID_REQUEST` | PUT body 非法 JSON / 结构不符 |
| 500 | `INTERNAL` | 读/写偏好文件异常 |

> **实现参考**：`packages/server/src/agent-source-list/favorites-store.ts`、`favorites-routes.ts`

---

### GET /api/sessions/:id/stream — SSE 事件流

建立长连接，实时接收会话事件（文本增量、工具调用、控制帧等）。该订阅是**按轮（per-turn）**建立的：每轮回复由客户端为该轮新开一条 `/stream` 连接来承接，并非一条会话级常驻连接；空闲期没有流是正常的。

**调用顺序约定（重要）**：客户端必须先创建会话、**先打开本轮 `/stream` 订阅，再** `POST /messages` 提交 prompt——该轮回复帧经这条已建立的流回来。顺序不可颠倒：回复帧经服务端 EventEmitter 瞬时广播、无缓冲，若流尚未连上，连接窗口之前广播的帧会永久丢失（见下文"竞态注意"）。

**响应头**：

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Content-Encoding: identity
X-Pi-Protocol-Version: <semver>
```

**SSE 帧格式**：

```
event: uiMessageChunk
id: 42
data: {"kind":"uiMessageChunk","protocolVersion":"0.1.0","chunk":{"type":"text-delta","id":"t1","delta":"Hello"}}

event: control
id: 43
data: {"kind":"control","protocolVersion":"0.1.0","payload":{"control":"error","message":"session ended: stopped","code":"stopped"}}

: keep-alive

```

- `event:` 行 = 帧种类（`uiMessageChunk` 或 `control`，即帧的 `kind` 字段）
- `id:` 行 = 单调帧序号，供断线重连时携带 `Last-Event-ID`
- 心跳帧（`: keep-alive`）每 15 秒发送一次（`DEFAULT_HEARTBEAT_MS = 15_000`），防止代理超时
- control 帧负载在 `payload` 字段内，以 `payload.control` 判别（**不是** `type`）；会话结束时服务端发一帧 `payload.control = "error"`（`message` 描述原因、`code` 为结束 reason）后关闭连接

**断线重连与回放边界**：携带 `Last-Event-ID` 头重新 GET 此端点，服务端重新订阅并续推后续帧。`Last-Event-ID` 仅作续推的**续号起点**（`startSeq`），网关**不缓存历史帧、也不按序号回放历史消息帧**。迟到订阅者（含重连）能"补回"的仅有：日志 ring-buffer，以及 `session-status` / `session-state` 两类**粘性（sticky）**帧；**本轮已广播的 `uiMessageChunk` 回复帧不会重放**——它们经 EventEmitter 瞬时广播、无缓冲。要取回错过的回复正文，须走历史接口 `GET /sessions/:id/messages`。

```bash
curl -N "http://localhost:3010/api/sessions/sess_abc/stream" \
  -H "Last-Event-ID: 42"
```

**错误**：404（会话不存在）、409 `SESSION_ENDED`（会话已结束，返回明确响应而非空流挂起）

> **重要**：会话 stats（用量统计）**不通过 SSE 推送**。SSE control 帧的 schema 虽定义了 `stats` 类型，但 `pi-session` 实际从不发送 `payload.control = "stats"` 帧（实测仅发出 `error` 与 `ui-rpc` 两类 control 帧）。用量数据须通过 `GET /sessions/:id/stats` REST 端点主动拉取。

> **竞态注意**：`POST /messages` 触发 agent 产出首帧可能极快（实测 ~32ms），而同轮 `/stream` 在 dev 冷编译或高负载下可能数秒才连上（实测冷态 ~3237ms、热态仅 ~79ms）。若 `POST` 早于流连上，连接窗口之前广播的 `uiMessageChunk` 因服务端无缓冲而永久丢失，该轮回复只有刷新（走 `GET /sessions/:id/messages` 历史接口）后才可见——表现为"发送消息后需手动刷新才看到回复"，且因取决于流是否抢在 agent 首帧前连上而呈间歇性。规避方式即严格遵守上文的调用顺序约定：先建立本轮 `/stream` 订阅，再 `POST /messages`。

---

### POST /api/sessions/:id/messages — 发送消息

向会话发送用户消息，触发 agent 推理。推理结果通过**本轮已建立的** `/stream` 连接异步推送。**必须先为本轮打开 `/stream` 订阅，再调用本端点**：回复帧经服务端 EventEmitter 瞬时广播、不缓冲，若本端点早于 `/stream` 连上，连接窗口之前的回复帧会永久丢失，只能刷新经 `GET /sessions/:id/messages` 历史接口恢复（详见 `GET /sessions/:id/stream` 的"竞态注意"）。

**请求体** (`PromptRequestSchema`，见 `packages/protocol/src/transport/rest-dto.ts:67`)：

```json
{
  "message": "请帮我分析这段代码",
  "images": [],
  "attachmentIds": ["att_xyz789"],
  "streamingBehavior": "steer"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | 是 | 用户消息文本（注意字段名是 `message`，不是 `prompt`） |
| `images` | array | 否 | vision 图像内容（base64） |
| `attachmentIds` | string[] | 否 | 已落库附件公开 id（`att_<nanoid>`），服务端注入结构化文本引用 |
| `streamingBehavior` | `"steer"` \| `"followUp"` | 否 | 推理进行中提交时的行为 |

**成功响应** 200：`{ "ok": true }`（消息已转发给 agent）

**错误**：400（校验失败）、404（会话不存在）、409（会话已停止）

```bash
curl -X POST http://localhost:3010/api/sessions/sess_abc/messages \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, agent!"}'
```

---

### POST /api/sessions/:id/steer — 引导输出

在推理进行中注入引导文本。

**请求体** (`SteerRequestSchema`)：`{ "message": "请用中文回答", "images": [] }`（`images` 可选；字段名是 `message`，不是 `text`）

**成功响应** 200：`{ "ok": true }`  
**错误**：400、404、409

---

### POST /api/sessions/:id/follow_up — 追问

**请求体**：与 steer 同构（`SteerRequestSchema`）：`{ "message": "继续" }`

**成功响应** 200：`{ "ok": true }`  
**错误**：400、404、409

---

### POST /api/sessions/:id/abort — 中止推理

中止当前进行中的推理轮次。

**请求体**：无（空体）

**成功响应** 200：`{ "ok": true }`

**错误**：404、409

---

### POST /api/sessions/:id/model — 切换模型

**请求体** (`SetModelRequestSchema`)：`{ "provider": "anthropic", "modelId": "claude-sonnet-4-5" }`（两字段均必填；注意是 `provider` + `modelId`，不是单字段 `model`）

**成功响应** 200：`{ "ok": true }`  
**错误**：400、404、409

---

### POST /api/sessions/:id/thinking — 设置扩展思考

**请求体** (`SetThinkingRequestSchema`)：`{ "level": "high" }`

`level` 取值为 `ThinkingLevel` 枚举：`"minimal"` | `"low"` | `"medium"` | `"high"` | `"xhigh"`（见 `packages/protocol/src/rpc/model.ts:19`）。**没有** `enabled` / `budget` 字段。

**成功响应** 200：`{ "ok": true }`  
**错误**：400、404、409

---

### POST /api/sessions/:id/ui-response — 扩展 UI 响应

将用户在扩展 UI 交互中产生的响应回传给 agent。请求体即 pi 的 `RpcExtensionUIResponse`（`UiResponseRequestSchema` 别名，见 `rest-dto.ts:118`），其中的 `id` 字段标识对应的 UI 请求。

**成功响应** 200：`{ "ok": true }`  
**错误**：400（校验失败）、404（会话不存在）、409（未知 UI 请求 id 或会话已停止）

---

### POST /api/sessions/:id/ui-rpc — Tier3 UI↔agent RPC

Web UI 扩展（Tier3）的上行 RPC 请求（`UiRpcRequestSchema`）。响应不在此端点返回，而是经 SSE control 帧（`payload.control = "ui-rpc"`）按 `correlationId` 配对回流。

**成功响应** 200：`{ "ok": true }`  
**错误**：400、404、409

---

### POST /api/sessions/:id/fork — 分叉会话

从指定历史条目分叉。**请求体** (`ForkRequestSchema`)：`{ "entryId": "..." }`

**成功响应** 200：`{ "text"?: string, "cancelled"?: boolean }`  
**错误**：400、404、409、502（上游命令失败）

---

### GET /api/sessions/:id/state — 查询会话状态

**成功响应** 200（`state` 为 `RpcSessionState`，见 `session-state.ts:18`）：

```json
{
  "state": {
    "sessionId": "550e8400-...",
    "thinkingLevel": "high",
    "isStreaming": false,
    "isCompacting": false,
    "steeringMode": "...",
    "followUpMode": "...",
    "autoCompactionEnabled": true,
    "messageCount": 12,
    "pendingMessageCount": 0,
    "model": { "...": "..." }
  },
  "protocolVersion": "0.1.0"
}
```

**错误**：404、502（上游命令失败）

---

### GET /api/sessions/:id/stats — 查询用量统计

> 注意：stats 数据仅通过此端点拉取，SSE 流不推送用量帧。

**成功响应** 200（`stats` 为 `SessionStats`，见 `session-state.ts:54`）：

```json
{
  "stats": {
    "sessionId": "550e8400-...",
    "userMessages": 6,
    "assistantMessages": 6,
    "toolCalls": 5,
    "toolResults": 5,
    "totalMessages": 12,
    "tokens": { "input": 3200, "output": 800, "cacheRead": 0, "cacheWrite": 0, "total": 4000 },
    "cost": 0.0042
  },
  "protocolVersion": "0.1.0"
}
```

**错误**：404、502（上游命令失败）

```bash
curl http://localhost:3010/api/sessions/sess_abc/stats
```

---

### GET /api/sessions/:id/messages — 查询消息历史

**成功响应** 200：`{ "messages": [...] }`  
**错误**：404、502

---

### GET /api/sessions/:id/commands — 查询可用命令

返回会话当前可用命令列表（纯查询，无安装/信任语义）。

**成功响应** 200：`{ "commands": [...] }`  
**错误**：404、502

---

### GET /api/sessions/:id/models — 查询可用模型

返回会话 agent 可用的模型列表（`{ models: Model[] }`，元素为 pi 的 `Model` 形状），受 `PI_WEB_HIDE_PROVIDERS` 环境变量过滤（剔除被隐藏 provider 的模型；与设置页 `/config/models` 用同一名单）。

**成功响应** 200：`{ "models": [...] }`  
**错误**：404、502

---

### GET /api/sessions/:id/fork-messages — 查询可分叉条目

返回可作为 fork 起点的历史条目列表。

**成功响应** 200：`{ "messages": [{ "entryId": "...", "text": "..." }] }`  
**错误**：404、502

---

### GET /api/sessions/:id/completion — 触发符补全

触发符补全框架（如 `@file:` 引文件）的查询端点。配套 `GET /api/sessions/:id/completion/triggers` 返回已注册的触发符。详见 [02 · 核心概念](02-core-concepts.md)。

**成功响应** 200：补全结果 JSON  
**错误**：404

---

### GET /api/sessions/:id/agent-routes — agent 声明式 route 清单

agent 在 `AgentDefinition.routes` 中声明的 HTTP routes（声明面契约见 [08 · 自定义 Agent 开发指南](08-agent-development.md)）随会话创建自动挂载到会话命名空间。本端点返回该会话声明的 route 清单——**纯数据投影**（`name` / `methods` / `description`），handler 函数只存在于 agent 子进程、从不跨进程。

**成功响应** 200（无声明返回空数组，是成功不是错误）：

```json
{
  "routes": [
    {
      "name": "gallery-stats",
      "methods": ["GET"],
      "description": "Canvas 画廊统计（资产计数/来源分布/是否生成中）"
    }
  ],
  "protocolVersion": "0.1.0"
}
```

**错误**：404（会话不存在）、401/403（既有 `:id` 鉴权接缝拒绝）。运维关断时（`PI_WEB_AGENT_ROUTES_DISABLED=1`，见下文 env 表）返回通用 404 `NOT_FOUND`，不泄露端点存在性。

```bash
curl -s http://localhost:3010/api/sessions/sess_abc/agent-routes
```

---

### GET·POST /api/sessions/:id/agent-routes/:name — 调用声明 route

将一次 HTTP 调用转发进该会话的 agent 子进程，由声明绑定的 handler 处理，并在**同一 HTTP 请求-响应周期**内同步返回结果——外部系统（curl / webhook / 第三方服务）无需订阅 SSE 流即可调用 agent 能力。底层为声明帧 + 专用请求/结果帧，骑既有 stdin/stdout JSONL 通道，不新增 SSE 帧。

**调用语义**：

- handler 只在 agent 子进程内执行；调用**不触发 LLM 推理、不进对话历史、不产生任何 UI 变化**。
- 会话推理进行中（busy）照常受理，与对话互不干扰。
- GET 调用忽略请求体（不读）；POST 空体宽松放行（`body` 以 undefined 传入 handler），非空但非法 JSON → 400。
- **成功响应体 = handler 返回的原始 JSON**（对象/数组/标量皆可，`undefined` 归一为 `null`），**不包** `protocolVersion` 信封；协议版本仅经响应头 `X-Pi-Protocol-Version` 承载。

**错误**（检查顺序：门控 → 会话/鉴权 → 名称 → 方法 → 体积 → JSON → 转发）：

| 状态 | code | 触发 |
|---|---|---|
| 404 | `NOT_FOUND` | `PI_WEB_AGENT_ROUTES_DISABLED=1` 运维关断（不泄露端点存在性） |
| 404 | `SESSION_NOT_FOUND` | 会话不存在 |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | 既有 `:id` 鉴权接缝拒绝 |
| 404 | `ROUTE_NOT_FOUND` | route 名未在该会话的 agent 定义中声明 |
| 405 | `METHOD_NOT_ALLOWED` | 方法不在该 route 声明的 `methods` 白名单（缺省 `["GET"]`） |
| 413 | `PAYLOAD_TOO_LARGE` | POST 请求体超上限（默认 1 MiB；先按 `Content-Length` 头提前拒，头缺失/不可信时读后按实际字节兜底复核） |
| 400 | `INVALID_BODY` | POST 非空请求体不是合法 JSON |
| 502 | `ROUTE_HANDLER_ERROR` | handler 抛错（错误消息带 handler 侧 message） |
| 504 | `ROUTE_TIMEOUT` | 子进程应答超时（默认 20000 ms） |
| 409 | `SESSION_STOPPED` | 会话已停止 |

**环境变量**：

| env | 默认 | 说明 |
|---|---|---|
| `PI_WEB_AGENT_ROUTES_DISABLED` | 未设置（功能开启） | `=1` 服务端权威关断，全部 agent-routes 端点返回通用 404；按请求时读取 |
| `PI_WEB_AGENT_ROUTE_TIMEOUT_MS` | `20000` | 转发进子进程的应答超时（毫秒），超时 → 504 |
| `PI_WEB_AGENT_ROUTE_BODY_LIMIT` | `1048576`（1 MiB） | POST 请求体上限（字节），超限 → 413 |

```bash
# 调用（GET；查询参数拍平为单值传给 handler）
curl -s "http://localhost:3010/api/sessions/sess_abc/agent-routes/gallery-stats?verbose=1"

# 调用（POST；须该 route 声明 methods 含 "POST"）
curl -s -X POST http://localhost:3010/api/sessions/sess_abc/agent-routes/my-route \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

> 可跑演示见 `examples/aigc-canvas-agent`（README「Agent Routes 演示（`gallery-stats`）」小节：声明只读统计 route，curl 直调拿结构化 JSON）；声明面契约（名称格式、缺省 methods、handler 约束、装配期校验）详见 [08 · 自定义 Agent 开发指南](08-agent-development.md)。
>
> **实现参考**：`packages/server/src/http/routes/agent-route-routes.ts`

---

### DELETE /api/sessions/:id — 删除会话

停止并移除会话。handler 返回后，sessions catch-all 路由（`app/api/sessions/[[...path]]/route.ts:34`）在响应 `res.ok` 时额外清除 `sessionId → source` 的 app 级映射（best-effort，不改写 handler 响应；防止映射表无限累积）。

**成功响应** 200：`{ "ok": true }`  
**错误**：404

```bash
curl -X DELETE http://localhost:3010/api/sessions/sess_abc
```

---

## Config API — `/api/config/**`

配置域（domain）读写接口。支持 `auth`、`settings`、`sandbox` 三个已知域；`models` 是特殊端点。

### GET /api/config/:domain — 读取配置

**路径参数**：`domain` = `auth` | `settings` | `sandbox`

**成功响应** 200：

```json
{
  "formSchema": { "...": "..." },
  "values": { "apiKey": "sk-***", "model": "claude-opus-4-5" },
  "protocolVersion": "0.1.0"
}
```

`values` 中的 secret 字段返回掩码值（`sk-***`），不回传明文。

**错误**：404 `DOMAIN_NOT_FOUND`（未知域）、401 `UNAUTHORIZED` / 403 `FORBIDDEN`（管理员鉴权接缝拒绝）

---

### PUT /api/config/:domain — 写入配置

**请求体**：

```json
{ "values": { "apiKey": "sk-new-key", "model": "claude-opus-4-5" } }
```

掩码值（`sk-***`）在写入时自动合并为磁盘原值（不覆盖未改动的 secret）。

**成功响应** 200：`{ "ok": true }`  
**错误**：400 `INVALID_JSON`（JSON 解析失败）/ `VALIDATION_FAILED`（DTO 校验失败）、422 `SCHEMA_VALIDATION_FAILED`（域 schema 校验失败，含 `fields`）、404 `DOMAIN_NOT_FOUND`、401/403

---

### GET /api/config/models — 列出可用模型（配置侧）

为设置页 provider/model 下拉控件提供数据。受 `PI_WEB_HIDE_PROVIDERS` 环境变量过滤（逗号分隔的 provider 名，大小写敏感）。

**成功响应** 200：

```json
{
  "providers": ["anthropic", "openai"],
  "models": [
    { "id": "claude-opus-4-5", "provider": "anthropic" },
    { "id": "gpt-4o", "provider": "openai" }
  ]
}
```

未配置 `listModelOptions` 接缝时返回 `{ "providers": [], "models": [] }`，前端回退到自由文本输入。

> `PI_WEB_HIDE_PROVIDERS=anthropic` 时，`anthropic` 的全部 provider 与模型从结果中剔除。此过滤与聊天区的 `GET /sessions/:id/models` 使用相同名单。

**实现参考**：`packages/server/src/config/config-routes.ts`、`packages/server/src/config/model-options-filter.ts`

---

## Attachments API — `/api/attachments/**`

### POST /api/sessions/:id/attachments — 上传附件

> 此端点由 **sessions** catch-all 路由服务（不是 attachments 路由），复用 Router 的 `:id` 会话门控（会话不存在→404、未授权→401/403）。

**请求**：`multipart/form-data`，文件字段名 `file`

**大小限制**：默认 25 MiB（`DEFAULT_MAX_UPLOAD_BYTES`）。超限在读取 body 前通过 `Content-Length` 头预检拒绝（413）。

**成功响应** 200：

```json
{
  "attachment": {
    "id": "att_xyz789",
    "name": "screenshot.png",
    "mimeType": "image/png",
    "size": 102400,
    "origin": "upload",
    "sessionId": "550e8400-..."
  },
  "displayUrl": "/api/attachments/att_xyz789/raw?exp=1750000000000&sig=abc...",
  "protocolVersion": "0.1.0"
}
```

`attachment` 为 `Attachment` 形状（`id`/`name`/`mimeType`/`size`/`origin`/`sessionId`，见 `packages/protocol/src/attachment/attachment-dto.ts`）。`displayUrl` 是即时签名的分发 URL（`presignUrl`），有效期有限。附件 id 形如 `att_<base64url>`。

**错误**：400 `NO_FILE`（无文件部分或文件为空）、413 `PAYLOAD_TOO_LARGE`（超大小限制）、404（会话不存在）、401/403（鉴权接缝拒绝）

```bash
curl -X POST http://localhost:3010/api/sessions/sess_abc/attachments \
  -F "file=@/path/to/image.png"
```

---

### GET /api/attachments/:id/raw?exp=&sig= — 下载附件

签名自洽鉴权，**不绑会话**，可直接在浏览器中访问（`<img src="...">` 等）。

**查询参数**：

| 参数 | 说明 |
|---|---|
| `exp` | 过期时刻（epoch ms） |
| `sig` | HMAC-SHA256 签名（hex），通过 `PI_WEB_ATTACHMENT_SECRET` 生成 |

**安全策略**（防枚举）：**先校验签名**，签名缺失/无效/过期一律 401（不查存在性，攻击者无法据响应判断 id 是否存在）。仅签名有效才读取并流式返回字节。

**成功响应** 200：字节流  
响应头：`Content-Type: <附件 mime>`、`Cache-Control: private, max-age=300`

**错误**：401 `INVALID_SIGNATURE`（签名缺失/无效/过期）、404 `ATTACHMENT_NOT_FOUND`（附件不存在，仅签名有效时才可能返回此码）

**实现参考**：`packages/server/src/http/routes/attachment-routes.ts`

---

## Session Source API — `/api/session-source`

### POST /api/session-source — 记录会话来源映射

客户端在会话创建（收到 `onSessionId` 回调）后调用，将 `sessionId → agent source` 的映射持久化到 app 层。冷加载（直接访问 `/session/:id`）时据此恢复 `.pi/web` UI 扩展配置。

**请求体**：

```json
{ "id": "sess_abc123", "source": "/path/to/agent" }
```

**成功响应** 204：无内容（best-effort，映射写入失败不影响会话本身，仍返回 204）

**错误**：400（请求体非 JSON，或 `id`/`source` 非字符串）

> 注意：此路由是独立的 Next.js handler（不经 `createPiWebHandler`），其 400 响应为纯文本（如 `"id and source must be strings"`），**不**采用统一的 `{ error, protocolVersion }` JSON 错误结构。

**实现参考**：`app/api/session-source/route.ts:14`

---

## createPiWebHandler — 框架无关集成

框架无关工厂，返回标准 Web Fetch 处理器 `(Request) => Promise<Response>`，可挂载到任意兼容框架。

```typescript
import {
  createPiWebHandler,
  createConfigRoutes,
  createAttachmentRoutes,
} from "@blksails/pi-web-server";

// Next.js Route Handler
const handler = createPiWebHandler({
  manager,          // SessionManager（来自 session-engine）
  store,            // SessionStore
  authResolver,     // 可选，默认放行
  authorizeSession, // 可选，默认放行
  routes: [         // 可选，注入外部路由（如 config-routes）
    ...createConfigRoutes({ listModelOptions }),
    ...createAttachmentRoutes(attachmentStore),
  ],
  sse: {
    heartbeatMs: 15_000,  // 心跳间隔（毫秒）
    basePath: "/api",     // 可选路由前缀
  },
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

**注入接缝说明**：

- `opts.routes` 中的外部路由与内置路由合并，内置路由优先（外部路由无法覆盖/遮蔽精确 `method`+`path` 冲突的内置端点）
- `authResolver(req)` 拒绝 → 401；`authorizeSession(ctx)` 返回 false → 403
- 需要在 `SIGTERM` 优雅停机时，改用 `createPiWebHandlerBundle(opts)`，它额外返回 `shutdown: () => Promise<void>`（透传 `manager.shutdown()`），handler 行为与 `createPiWebHandler` 一致

**实现参考**：`packages/server/src/http/create-handler.ts`

---

## SSE 帧完整参考

SSE 流包含两类顶层帧，由 `@blksails/pi-web-protocol` 的 `SseFrameSchema` 定义：

### kind: uiMessageChunk

增量内容帧，负载在 `chunk` 字段，`chunk.type` 为 AI SDK v5 标准块子类型（见 `packages/protocol/src/transport/ui-message-chunk.ts`），主要包括：

| chunk.type | 说明 |
|---|---|
| `text-start` / `text-delta` / `text-end` | 文本流（`text-delta` 用 `delta` 字段携带增量，配 `id`） |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | 思考过程流 |
| `tool-input-start` / `tool-input-delta` / `tool-input-available` | 工具调用输入 |
| `tool-output-available` / `tool-output-error` | 工具调用输出 |
| `start` / `finish` / `start-step` / `finish-step` / `error` / `abort` | 消息生命周期标记 |
| `data-${string}`（如 `data-pi-queue`） | 自定义结构化 data-part（见 `data-part.ts`） |

> 注意：`finish` 是 **uiMessageChunk** 的一个 `chunk.type`（消息流结束标记），不是 control 帧类型。

### kind: control

控制帧，负载在 `payload` 字段，以 `payload.control` 判别（见 `transport/sse-frame.ts:17`）：

| payload.control | 说明 | 实际是否发送 |
|---|---|---|
| `extension-ui` | 扩展 UI 请求（需 `POST /ui-response` 回传） | 是 |
| `queue` | 排队状态（`steering` / `followUp` 数组） | schema 定义 |
| `stats` | 用量统计 | **从不发送**（用量走 REST，见上文） |
| `error` | 出错 / 会话结束（`message` + 可选 `code`） | 是 |
| `ui-rpc` | Tier3 UI↔agent RPC 下行响应（按 `correlationId` 配对） | 是 |

每帧 JSON 结构：

```json
{
  "kind": "uiMessageChunk",
  "protocolVersion": "0.1.0",
  "chunk": { "type": "text-delta", "id": "t1", "delta": "Hello" }
}
```

---

## 完整主链路示例

以下步骤演示从建会话到接收响应的完整流程：

1. **创建会话**：

   ```bash
   SESSION=$(curl -s -X POST http://localhost:3010/api/sessions \
     -H "Content-Type: application/json" \
     -d '{"source": "/path/to/.pi"}' | jq -r .sessionId)
   echo "Session: $SESSION"
   ```

2. **记录来源映射**（可选，用于冷加载恢复）：

   ```bash
   curl -X POST http://localhost:3010/api/session-source \
     -H "Content-Type: application/json" \
     -d "{\"id\": \"$SESSION\", \"source\": \"/path/to/.pi\"}"
   ```

3. **订阅 SSE 流**（后台运行）：

   ```bash
   curl -N "http://localhost:3010/api/sessions/$SESSION/stream" &
   STREAM_PID=$!
   ```

4. **发送消息**：

   ```bash
   curl -X POST "http://localhost:3010/api/sessions/$SESSION/messages" \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello, agent! What can you do?"}'
   ```

5. **查询用量**（推理结束后）：

   ```bash
   curl "http://localhost:3010/api/sessions/$SESSION/stats"
   ```

6. **删除会话**：

   ```bash
   kill $STREAM_PID
   curl -X DELETE "http://localhost:3010/api/sessions/$SESSION"
   ```

> 跑不通时的常见对策：连接被立即关闭并收到一帧 `payload.control = "error"` → 多为 source 路径不存在或 agent 启动失败；`/messages` 返回 409 → 会话已停止，需重建；SSE 流无任何帧 → 确认 `runtime = "nodejs"` 生效（Edge/Serverless 不支持）。更多见 [23 · 故障排查 FAQ](23-troubleshooting-faq.md)。

---

## 下一步 / 相关

- [02 · 核心概念](02-core-concepts.md) — 会话生命周期与 SSE 双连接模型
- [03 · 架构](03-architecture.md) — `createPiWebHandler` 在系统中的位置
- [06 · 配置](06-configuration.md) — `PI_WEB_HIDE_PROVIDERS`、`PI_WEB_ATTACHMENT_SECRET` 等环境变量
- [09 · 附件系统](09-attachment-system.md) — 附件存储、签名 URL 与 tool-bridge 完整机制
- [18 · CLI](18-cli.md) — 独立部署时的 bin/pi-web.mjs 用法
- [21 · 日志](21-logging.md) — 服务端日志与 SSE 帧可观测性
- [23 · 故障排查 FAQ](23-troubleshooting-faq.md) — 会话启动失败、SSE 无帧、409/426 等常见报错
