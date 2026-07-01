# Design Document — sidebar-launcher-rail

## Overview

**Purpose**:参考 Grok 侧栏,给 pi-web 侧栏在会话列表之上增设一个固定「启动导航区」(LauncherRail),集中提供:搜索历史会话、固定的新建聊天、收藏 agent source 的一键启动锚点、以及一个供 webext 贡献自定义渲染的具名槽。

**Users**:使用 pi-web 侧栏的终端用户(快速搜索/新建/启动常用 agent);扩展作者(在侧栏贡献入口)。

**Impact**:侧栏 sidebar 槽从"仅 SessionListPanel"变为"LauncherRail(固定)+ SessionListPanel(滚动)"。新增读写 favorites 后端、给 sessions 列表加可选 `q` 过滤、给 webext SlotKey 增 `launcherRail`。会话创建/恢复/流协议不变。

### Goals
- 侧栏顶部固定导航区外壳(搜索 / 新建聊天 / 收藏锚点 / webext 槽)。
- 会话名称搜索(向后兼容的 `q` 入参)。
- 收藏 agent source 读写持久化 + 一键启动锚点。
- webext `launcherRail` 具名槽复用既有 SlotContribution 机制,失败隔离。
- 全特性可门控;未启用时侧栏退化为现状。

### Non-Goals
- 不改 `/agent-sources` 只读枚举语义;收藏是独立读写偏好。
- 不改会话创建/恢复/流协议。
- 不做会话正文全文检索、跨设备同步、多用户账户。
- 不新增 webext 层级或改 5 层模型。

## Boundary Commitments

### This Spec Owns
- `LauncherRail` 组件及其四分区渲染与交互。
- favorites 读写:store(`<agentDir>/agent-source-favorites.json`)+ `GET/PUT /agent-sources/favorites` + 协议 DTO。
- sessions 列表 `q`(名称子串)过滤入参(schema + 路由过滤,向后兼容)。
- 新 `SlotKey = "launcherRail"` 及 chat-app 对该槽贡献的解析与传入。
- 门控 `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` 与 chat-app 侧栏组装。

### Out of Boundary
- 会话创建/恢复链路(复用 onReset/onResume/新建路径)。
- 只读源枚举 `/agent-sources`(agent-sources-list 所有)。
- webext 渲染/命名空间/错误隔离底座(复用 apply-extension)。

### Allowed Dependencies
- `@blksails/pi-web-server` http InjectedRoute/errorResponse/jsonResponse;`agent-sources` catch-all 转发器(补 PUT)。
- `@blksails/pi-web-protocol` rest-dto(加 q + favorites DTO)、web-ext descriptor(加 SlotKey)。
- `@blksails/pi-web-ui` PiChatSlots、`resolveSlotContribution`。
- Node `fs/promises`、`path`。

### Revalidation Triggers
- `SlotKey` 枚举变化(协议 semver;webext 作者面)。
- `ListSessionsRequest`/favorites DTO 形状变化。
- favorites 端点路径/语义变化。
- 门控 env 默认值变化。

## Architecture

### Existing Architecture Analysis
- **sidebar 槽**:`PiChatSlots.sidebar: ReactNode`,`pi-chat.tsx:1390` 渲染;chat-app `sessionListSlots()` 注入。可放 `<div>{Rail}{List}</div>`。
- **webext 具名槽**:`SlotKey` 枚举 + `SlotContribution = ReactNode|Component<SlotRenderProps>` + `resolveSlotContribution(ext, slot)`(apply-extension.tsx:48)。新增槽键即复用整套。
- **sessions 列表**:`session-list-routes.ts` 取 `SessionMeta[]` → 排序 → 分页;过滤点在排序前。
- **agent-sources 转发器**:`app/api/agent-sources/[[...path]]/route.ts` 现仅 GET;favorites 需补 PUT。

### 架构与边界图
```mermaid
flowchart TD
  subgraph FE[前端]
    Rail[LauncherRail\n搜索/新建/收藏锚点/webext槽]
    List[SessionListPanel]
    Client[PiClient: listSessions(q) / listFavorites / setFavorites]
  end
  subgraph BE[后端]
    SRoute[session-list-routes\n+q 名称过滤]
    FRoute[favorites-routes\nGET/PUT /agent-sources/favorites]
    FStore[FavoritesStore\n<agentDir>/agent-source-favorites.json 原子读写]
  end
  Proto[["protocol: q 入参 + Favorites DTO + SlotKey launcherRail"]]
  Ext[[webext SlotContribution\nresolveSlotContribution(ext,'launcherRail')]]

  Rail -->|新建聊天→onReset| Reset[(回 AgentSourcePicker)]
  Rail -->|收藏锚点点击→源 source| Create[(既有新建会话链路)]
  Rail -->|搜索/结果恢复→onResume| Resume[(既有恢复链路)]
  Rail --> Client --> SRoute
  Client --> FRoute --> FStore
  Rail -. 渲染(error boundary 隔离) .- Ext
  Client -. parse .- Proto
  Rail --- List
```

- **Pattern**:注入式组件(Rail 不持接线,数据/回调由 chat-app 注入,与 SessionListPanel 同构)+ 注入式读写路由 + 复用具名槽。
- **New components rationale**:LauncherRail(新 UI 外壳)、FavoritesStore/routes(唯一新增读写面)、其余全复用。

### Technology Stack
| Layer | Choice | Role | Notes |
|---|---|---|---|
| Frontend | React(`@blksails/pi-web-ui`) | LauncherRail + 搜索 overlay + 锚点 | 注入式 props |
| Backend | Node InjectedRoute | favorites GET/PUT + sessions q 过滤 | 复用 error/json response |
| Storage | fs/promises 原子写 | favorites JSON | tmp+rename |
| Contract | zod | q + Favorites DTO + SlotKey | semver |

## File Structure Plan

### 新增
```
packages/server/src/agent-source-list/
├── favorites-store.ts          # FavoritesStore:读/原子写 <agentDir>/agent-source-favorites.json,容错
└── favorites-routes.ts         # createFavoritesRoutes(opts): GET/PUT /agent-sources/favorites

packages/ui/src/elements/
└── launcher-rail.tsx           # LauncherRail 组件(搜索/新建/收藏锚点/webext槽 + error boundary)

packages/server/test/agent-source-list/favorites-store.test.ts
packages/server/test/agent-source-list/favorites-routes.test.ts
packages/ui/test/elements/launcher-rail.test.tsx
e2e/browser/sidebar-launcher-rail.e2e.ts
```

### 修改
- `packages/protocol/src/transport/rest-dto.ts` — `ListSessionsRequest` 加 `q?`;新增 `AgentSourceFavorite / ListFavoritesResponse / SetFavoritesRequest` DTO。
- `packages/protocol/src/web-ext/descriptor.ts` — `SlotKeySchema` 加 `"launcherRail"`。
- `packages/server/src/session-list/session-list-routes.ts` — 解析 `q`,排序前按 `(name??"")+sessionId` 子串过滤(向后兼容)。
- `packages/server/src/agent-source-list/index.ts` — 导出 favorites 工厂/类型。
- `packages/react/src/client/pi-client.ts` — `listSessions` 拼 `q`;新增 `listFavorites` / `setFavorites`。
- `packages/ui/src/index.ts` — 导出 `LauncherRail`。
- `components/agent-source-picker.tsx` — ①源列表项加**星标切换**(收藏/取消收藏的主入口,Req 4.1/4.2):可选 props `favoriteSources?: Set<string>` + `onToggleFavorite?(item)`;`data-launcher-favorite-toggle`。②新增 `variant: "page" | "dialog"` 与 `onClose`(Req 2.2–2.5):`page`(默认)整页居中(初始启动屏);`dialog` 悬浮遮罩层(`data-agent-source-dialog`)+ 关闭按钮(`data-agent-source-dialog-close`)+ 遮罩点击(`data-agent-source-dialog-backdrop`)+ Esc 关闭。内容(列表+表单)两形态共用。未注入相关 props 均向后兼容。
- `components/chat-app.tsx` — 门控组装 sidebar(Rail+List);注入 favorites/搜索/onReset/onResume;给 AgentSourcePicker 注入收藏集合+toggle;`resolveSlotContribution(ext,"launcherRail")` 传入 Rail。
- `lib/app/pi-handler.ts` — `routes:` 追加 `...createFavoritesRoutes({ agentDir })`。
- `app/api/agent-sources/[[...path]]/route.ts` — 补 `export function PUT`(转发 handler)。
- `docs/product/13-http-api-reference.md` / `05-configuration.md` / `10-web-ui-extension.md`(+ en 镜像)。

## Requirements Traceability
| Req | Components | Interfaces |
|---|---|---|
| 1.1–1.4 外壳/固定/空态/门控 | LauncherRail, chat-app | props, `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` |
| 2.1–2.3 新建聊天 | LauncherRail, chat-app onReset | onNewChat |
| 3.1–3.6 搜索会话 | LauncherRail 搜索, session-list `q` | `ListSessionsRequest.q` |
| 4.1–4.7 收藏锚点 | FavoritesStore, favorites-routes, LauncherRail, AgentSourcePicker 星标 | GET/PUT favorites DTO |
| 5.1–5.4 webext 槽 | SlotKey launcherRail, resolveSlotContribution, Rail error boundary | SlotContribution |
| 6.1–6.4 门控/边界/不回归 | chat-app 门控, 原子写, 复用链路 | env, atomic write |

## Components and Interfaces

### 协议(protocol)
```typescript
// rest-dto.ts
ListSessionsRequestSchema.q = z.string().max(100).optional();  // 名称子串,限长防 DOS

export const AgentSourceFavoriteSchema = z.object({
  source: z.string(),          // 提交给新建会话链路的 source 字符串
  name: z.string(),            // 展示名(锚点标签)
});
export const ListFavoritesResponseSchema = z.object({
  favorites: z.array(AgentSourceFavoriteSchema),
});
export const SetFavoritesRequestSchema = z.object({
  favorites: z.array(AgentSourceFavoriteSchema),  // 全量替换(幂等)
});

// descriptor.ts: SlotKeySchema 增 "launcherRail"
```

### FavoritesStore(server,读写)
```typescript
interface FavoritesStore {
  list(): Promise<AgentSourceFavorite[]>;         // 缺失→[];坏JSON→[];坏条目跳过(Req 4.7)
  set(favorites: AgentSourceFavorite[]): Promise<void>;  // 原子 tmp+rename 替换(Req 4.1/4.2)
}
function createFavoritesStore(opts: { filePath: string }): FavoritesStore;
```
- 只写该偏好文件,无其它副作用(Req 6.3)。逐条 zod 校验;非对象/缺 source 跳过。

### favorites-routes(server)
| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/agent-sources/favorites` | — | `ListFavoritesResponse` | 500 |
| PUT | `/agent-sources/favorites` | `SetFavoritesRequest`(body) | `ListFavoritesResponse`(回显) | 400(体非法), 500 |
- `createFavoritesRoutes({ agentDir })`:filePath = `<agentDir>/agent-source-favorites.json`。PUT 校验 body(zod),set 后回读返回。惰性单例 store。

### session-list-routes(改)
- 解析 `q = searchParams.get("q")`;若非空:**先** `enrichDisplayNames(store, metas)`(有界并发,仅搜索时付出 O(n) displayName 派生),再 `filter(m => `${m.name ?? ""} ${m.sessionId}`.toLowerCase().includes(q))`,置于排序前。匹配**名称/显示名**(header 未命名的 auto-title 会话其标题在 session_info,故须先富集)(Req 3.2/3.6)。空 q / 无 q → 不富集、行为不变(向后兼容 Req 6.2)。不检索正文。

### PiClient(react)
```typescript
listSessions(req)          // 拼 q(若有)
listFavorites(): Promise<ListFavoritesResponse>
setFavorites(req: SetFavoritesRequest): Promise<ListFavoritesResponse>
```

### LauncherRail(ui,注入式)
| Field | Detail |
|---|---|
| Intent | 侧栏固定导航区:搜索/新建/收藏锚点/webext槽 |
| Requirements | 1–5 |

```typescript
interface LauncherRailProps {
  readonly onNewChat: () => void;                 // 复用 chat-app onReset(Req 2.2)
  readonly onResume: (sessionId: string) => void; // 搜索结果恢复(Req 3.3)
  readonly onLaunchSource: (source: string) => void; // 收藏锚点点击新建(Req 4.4)
  readonly listSessions: (req: ListSessionsRequest) => Promise<ListSessionsResponse>; // 搜索(Req 3.2)
  readonly currentCwd: string;
  readonly listFavorites: () => Promise<ListFavoritesResponse>;
  readonly setFavorites: (req: SetFavoritesRequest) => Promise<ListFavoritesResponse>;
  readonly favoritesRefreshSignal?: unknown;
  readonly webextSlot?: React.ReactNode;          // resolveSlotContribution(ext,"launcherRail")(Req 5.1)
  readonly className?: string;
}
```

**行为与约束**
- 固定容器(`shrink-0`),会话列表在其下独立滚动(Req 1.2);`data-launcher-rail`。
- 新建聊天:恒显(Req 2.1),点击 `onNewChat()`(Req 2.2)。`data-launcher-new-chat`。
- 搜索:点击展开输入(`data-launcher-search`),键入 → `listSessions({ q, cwd })`,展示匹配项;三态 + 竞态守卫;无结果空态(Req 3.4);清空/退出复位(Req 3.5)。结果项点击 `onResume`(Req 3.3)。
- 收藏锚点:mount 拉 `listFavorites`;每项渲染可点击锚点(`data-launcher-favorite`,`data-source`),点击 `onLaunchSource(item.source)`(Req 4.4);取消收藏经 `setFavorites`(移除后重拉);无收藏不渲染分区(Req 4.5)。
- webext 槽:有 `webextSlot` 才渲染,包 **error boundary** 隔离失败(Req 5.4);无则不占位(Req 5.2)。`data-launcher-webext-slot`。

### chat-app 组装
- 门控 `LAUNCHER_RAIL_ENABLED = NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL ∈ {1,true}`。
- 启用时 sidebar 槽 = `<div class="flex h-full flex-col"><LauncherRail .../><div class="min-h-0 flex-1 overflow-auto"><SessionListPanel .../></div></div>`;未启用 = 现状(仅 List)(Req 1.4/6.1)。
- `onNewChat = onReset`;`onLaunchSource = (source) => onSubmit(source)`(既有新建路径,Req 6.4);`onResume` 同 List。
- webextSlot = `resolveSlotContribution(resolveExtensionForSource(create.source), "launcherRail")` 渲染节点(组件则 `<Comp extId=.../>`)。

## Data Models
- **favorites 文件**:`{ "favorites": [ { "source": "...", "name": "..." } ] }`,原子 tmp+rename 写。id 无需——source 即键;setFavorites 全量替换(去重由前端保证,后端按序存)。
- **DTO**:见协议小节。

## Error Handling
- favorites GET:store 内部 try/catch,缺失/坏文件 → `[]`;意外 → 500。PUT:body zod 失败 → 400 INVALID_REQUEST;写失败 → 500。
- sessions q:仅内存过滤,无新错误面。
- LauncherRail:搜索/收藏加载失败 → 分区级可识别错误,不拖垮其余分区或会话列表;webext 槽 error boundary 捕获渲染异常(Req 5.4)。

## Testing Strategy
### Unit
- `favorites-store`:缺失→[]、坏JSON→[]、坏条目跳过、set 原子替换后 list 回读一致、set 只写该文件(前后目录其余不变)。
- `session-list-routes`:`q` 命中/未命中/大小写不敏感;无 q 时结果与既有一致(向后兼容);q 与 scope/分页组合。
- `pi-client`:listSessions 拼 q;listFavorites/setFavorites 拼串 + parse。
### Integration
- `favorites-routes`:GET 空→[];PUT 合法 body → 回显且落盘;PUT 坏 body → 400;GET 反映 PUT 结果;经 `/api/agent-sources/favorites` 转发器(GET+PUT)可达。
### Component
- `launcher-rail`:新建聊天恒显+点击回调;搜索键入→结果→点击 onResume+空态+清空复位;收藏锚点渲染+点击 onLaunchSource+无收藏不占位;webext 槽渲染+抛错被 error boundary 隔离(其余分区仍在)。
### E2E(隔离 build + external server,`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1`)
- 侧栏出现 `data-launcher-rail`;点新建聊天→回选择器;收藏一个源→锚点出现→点击→会话激活;搜索键入→结果过滤。门控关闭态由组件/单测覆盖。

## 配置(环境变量)
| 变量 | 作用 | 默认 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | 前端门控(构建期内联):是否渲染启动导航区 | 关(仅会话列表) |

> favorites 文件路径固定 `<agentDir>/agent-source-favorites.json`(`agentDir` = `PI_CODING_AGENT_DIR ?? PI_WEB_AGENT_DIR`)。收藏锚点的候选源来自既有 `/agent-sources` 枚举(用户在源列表/picker 处收藏);本特性只负责收藏的读写与锚点渲染。
