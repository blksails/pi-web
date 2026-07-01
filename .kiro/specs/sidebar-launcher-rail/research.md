# Research Log — sidebar-launcher-rail

## Discovery 类型
Extension(扩展既有系统)。四路集成:UI 外壳重构 + 读写 favorites 后端 + sessions 搜索入参 + webext 具名槽复用。Light 集成聚焦 discovery。

## 关键调查与结论

### A. 侧栏 slot 组装
- `PiChatSlots`(`packages/ui/src/chat/slots.ts:9`):`sidebar?: ReactNode` 等;sidebar 槽在 `pi-chat.tsx:1390` 渲染为 `<aside data-pi-chat-sidebar>{slots.sidebar}</aside>`。**接受任意 ReactNode**。
- chat-app `sessionListSlots(node)`(`components/chat-app.tsx:208`)把 `SessionListPanel` 包成 `PiChatSlots`。结论:同一 sidebar 槽内放 `<div>{LauncherRail}{SessionListPanel}</div>` 即可 rail 在列表之上。
- `onReset`(chat-app:279,清会话回选择器 + 重置 URL 为 `/`)= 新建聊天复用点。`onResume(sessionId)` = 搜索结果/恢复复用点。

### B. webext 具名槽(选定路径)
- `SlotKey`(`packages/protocol/src/web-ext/descriptor.ts:28`)枚举:background/headerLeft/headerCenter/headerRight/sidebarLeft/panelRight/empty/footer。
- `SlotContribution = ReactNode | ComponentType<SlotRenderProps>`(`packages/web-kit/src/define-web-extension.ts:22`)——**即"完整自定义渲染贡献到具名槽"**。扩展经 `defineWebExtension({ slots: { <key>: Comp } })` 声明。
- `apply-extension.tsx:48` `resolveSlotContribution(ext, slot): SlotContribution | undefined` 是宿主解析入口。
- **结论**:新增一个 `SlotKey` 值 `"launcherRail"`;chat-app 用 `resolveSlotContribution(ext, "launcherRail")` 取贡献,作为 prop 传入 `LauncherRail` 在导航区内渲染(不经 PiChat 顶层槽)。复用既有 Tier2 渲染贡献机制 + 命名空间/错误隔离,不新增层级。用户选择"Tier2 完整自定义渲染" ⇔ SlotContribution 组件贡献。

### C. sessions 搜索入参
- `ListSessionsRequest`(`rest-dto.ts:177`)加可选 `q: z.string().max(100).optional()`。
- `session-list-routes.ts:184-201`:`store.list/listAll` 取回 `SessionMeta[]` 后、排序(:203)前,若 `q` 非空按 `(m.name ?? "") + sessionId` 子串(大小写不敏感)过滤。**向后兼容**:无 q 时行为不变。
- `SessionMeta.name`(`session-store/types.ts:102`)= header.name;sqlite/pg 维护 name 列;fs 未命名靠 `displayName()` 派生。**决定(reviewer 复核后修正)**:q 非空时**先富集全量 displayName 再过滤**(复用 `enrichDisplayNames`,有界并发,O(n) 仅在搜索时),使匹配覆盖 header name 与 auto-title displayName(Req 3.2/3.6);空 q 不富集、行为不变(向后兼容 Req 6.2)。不检索正文。

### D. favorites 存储(新建,读写)
- 与只读枚举 `/agent-sources` **解耦**:独立 `<agentDir>/agent-source-favorites.json`。
- 形态 `{ favorites: [{ source, name }] }`;GET 读、PUT 全量替换(幂等、原子写 tmp+rename)。坏文件/坏条目容错跳过(Req 4.7)。
- 端点挂 `/api/agent-sources/**` catch-all 转发器(agent-sources-list 已建),路径 `/agent-sources/favorites`,router basePath `/api` strip 后匹配。**关键**:GET+PUT 都要走该转发器——现转发器只导出了 GET,需补 PUT。

## Synthesis
- Adopt:PiChatSlots.sidebar 任意 node、resolveSlotContribution、session-list-routes 过滤点、agent-sources catch-all 转发器、原子写模式。
- Build:LauncherRail 组件、favorites store+GET/PUT 路由、`q` 入参、`launcherRail` SlotKey、`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` 门控。
- 简化:favorites PUT 全量替换(非 toggle 端点),前端 read-modify-write;单用户本机偏好足够。

## 风险与缓解
| 风险 | 缓解 |
|---|---|
| favorites 是读写(区别于只读枚举) | 独立文件 + 原子 tmp+rename;坏文件容错;仅偏好文件写副作用(Req 6.3) |
| q 过滤 displayName 不完整(fs 未命名) | 明确限制:按 header name+sessionId;Req 3.6 仅名称;文档记 |
| webext 槽渲染失败拖垮导航区 | LauncherRail 内 error boundary 隔离 slot 渲染(Req 5.4) |
| 转发器只有 GET | 补 PUT 到 `app/api/agent-sources/[[...path]]/route.ts` |
| 改注入路由/新 SlotKey 后 dev 不生效 | 重启 dev(globalThis 单例);协议 semver |
