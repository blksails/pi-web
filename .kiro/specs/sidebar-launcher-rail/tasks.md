# Implementation Plan

- [x] 1. 协议契约:搜索入参 + favorites DTO + SlotKey
- [x] 1.1 rest-dto 加 q 与 favorites DTO;descriptor 加 launcherRail SlotKey
  - `rest-dto.ts`:`ListSessionsRequestSchema` 加 `q: z.string().max(100).optional()`;新增 `AgentSourceFavorite / ListFavoritesResponse / SetFavoritesRequest` schema+类型
  - `web-ext/descriptor.ts`:`SlotKeySchema` 枚举加 `"launcherRail"`
  - 观测完成:protocol typecheck 通过,新符号可被其它包 import,无 any
  - _Requirements: 3.2, 4.1, 5.1_

- [x] 2. 后端(favorites 读写 + sessions 搜索 + 转发器)
- [x] 2.1 实现 FavoritesStore(原子读写 + 容错) (P)
  - 新建 `packages/server/src/agent-source-list/favorites-store.ts`:`list()`(缺失→[]、坏JSON→[]、坏条目逐条跳过)、`set()`(原子 tmp+rename 全量替换),仅写该偏好文件
  - 观测完成:`favorites-store.test.ts` 覆盖 缺失→[]、坏JSON→[]、坏条目跳过、set→list 回读一致、set 只写该文件(目录其余不变),全绿
  - _Requirements: 4.1, 4.2, 4.7, 6.3_
  - _Boundary: FavoritesStore_

- [x] 2.2 实现 createFavoritesRoutes(GET/PUT /agent-sources/favorites)
  - 新建 `packages/server/src/agent-source-list/favorites-routes.ts`:GET 返回 `ListFavoritesResponse`;PUT 校验 body(zod,非法→400)、set 后回读回显;惰性单例 store;从 index 导出;filePath=`<agentDir>/agent-source-favorites.json`
  - 观测完成:`favorites-routes.test.ts` 覆盖 GET 空→[]、PUT 合法→回显+落盘、PUT 坏 body→400、GET 反映 PUT,全绿
  - _Requirements: 4.1, 4.2, 4.6_
  - _Boundary: createFavoritesRoutes_
  - _Depends: 1.1, 2.1_

- [x] 2.3 session-list-routes 加 q 名称过滤(向后兼容) (P)
  - 改 `session-list-routes.ts`:解析 `q`,排序前按 `(name??"")+" "+sessionId` 大小写不敏感子串过滤;无 q / 空 q 行为不变;可回显 searchQuery
  - 观测完成:`session-list-routes.test.ts` 增 q 命中/未命中/大小写不敏感、无 q 与既有一致(向后兼容)、q+分页组合,全绿
  - _Requirements: 3.2, 3.6, 6.2_
  - _Boundary: session-list-routes_
  - _Depends: 1.1_

- [x] 3. 前端 client
- [x] 3.1 PiClient:listSessions 拼 q + listFavorites/setFavorites (P)
  - `pi-client.ts`:`listSessions` 拼 `q`;新增 `listFavorites()` / `setFavorites(req)`(GET/PUT /agent-sources/favorites,schema.parse);接口声明+导出类型
  - 观测完成:`pi-client-favorites.test.ts` 断言 listSessions 拼 q、listFavorites/setFavorites 拼串+parse(mock fetch),全绿
  - _Requirements: 3.2, 4.1_
  - _Boundary: PiClient_
  - _Depends: 1.1_

- [x] 4. UI 组件
- [x] 4.1 实现 LauncherRail 组件(四分区 + error boundary)
  - 新建 `packages/ui/src/elements/launcher-rail.tsx`,从 ui index 导出;注入式 props(onNewChat/onResume/onLaunchSource/listSessions/currentCwd/listFavorites/setFavorites/favoritesRefreshSignal/webextSlot)
  - 固定容器;新建聊天恒显+点击 onNewChat;搜索展开输入→listSessions({q,cwd})→结果(三态+竞态守卫+空态+清空复位)→点击 onResume;收藏锚点(mount 拉 listFavorites,点击 onLaunchSource,取消收藏经 setFavorites,无收藏不占位);webext 槽 error boundary 隔离、无则不占位;各分区 data-* 属性
  - 观测完成:`launcher-rail.test.tsx` 覆盖 新建恒显+回调、搜索结果+onResume+空态+清空复位、收藏锚点渲染+onLaunchSource+无收藏不占位、webext 槽抛错被隔离(其余分区仍在),全绿
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.3, 3.4, 3.5, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4_
  - _Boundary: LauncherRail_
  - _Depends: 1.1, 3.1_

- [x] 4.2 AgentSourcePicker 源列表项加收藏星标 (P)
  - 改 `components/agent-source-picker.tsx`:可选 props `favoriteSources?: Set<string>` + `onToggleFavorite?(item)`;列表项渲染星标切换(`data-launcher-favorite-toggle`),未注入不显示(向后兼容 agent-sources-list)
  - 观测完成:组件测试覆盖 注入时星标渲染+点击 toggle 回调、已收藏项高亮态、未注入不显示星标,全绿
  - _Requirements: 4.1, 4.2_
  - _Boundary: AgentSourcePicker_
  - _Depends: 1.1_

- [x] 5. 集成装配
- [x] 5.1 后端装配:favorites 路由 + 转发器补 PUT
  - `lib/app/pi-handler.ts`:`routes:` 追加 `...createFavoritesRoutes({ agentDir: config.agentDir })`
  - `app/api/agent-sources/[[...path]]/route.ts`:补 `export function PUT(req){return getHandler()(req)}`,使 `/api/agent-sources/favorites` GET+PUT 均可达
  - 观测完成:`curl -X PUT /api/agent-sources/favorites` 落盘、`GET` 反映(手动/集成验证)
  - _Requirements: 4.1, 4.6_
  - _Depends: 2.2_

- [x] 5.2 前端装配:chat-app 门控组装 sidebar + 注入
  - `components/chat-app.tsx`:门控 `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL`;启用时 sidebar 槽=`<div>{LauncherRail}{可滚动 SessionListPanel}</div>`,未启用=现状;注入 onNewChat=onReset、onLaunchSource=onSubmit、onResume、listSessions、listFavorites/setFavorites、favoritesRefreshSignal;`resolveSlotContribution(ext,"launcherRail")` 传 webextSlot;给 AgentSourcePicker 注入 favoriteSources+onToggleFavorite
  - 观测完成:启用门控后侧栏出现导航区且列表在其下;关闭门控仅列表(dev/e2e 验证)
  - _Requirements: 1.1, 1.4, 2.2, 4.4, 5.1, 6.1, 6.4_
  - _Depends: 4.1, 4.2, 5.1_

- [x] 6. 验证与文档
- [x] 6.1 浏览器 e2e:导航区闭环
  - 新建 `e2e/browser/sidebar-launcher-rail.e2e.ts`,隔离 build(`NEXT_DIST_DIR=.next-e2e` + `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1` + `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1`)+ external server:`data-launcher-rail` 出现;点新建聊天→回选择器;在 picker 收藏一个源→侧栏锚点出现→点击→会话激活;搜索键入→结果过滤;门控关闭态由组件/单测覆盖(skip)
  - 观测完成:e2e 本地跑绿,输出留存
  - _Requirements: 1.1, 2.2, 3.2, 4.4_
  - _Depends: 5.2_

- [x] 6.2 文档:搜索入参 + favorites 端点 + launcherRail 槽 + 门控(中英双份)
  - `docs/product/13-http-api-reference.md`(GET /sessions 加 q、favorites GET/PUT)、`05-configuration.md`(`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL`)、`10-web-ui-extension.md`(launcherRail SlotKey),及 `docs/product/en/` 镜像
  - 观测完成:文档含 q 参数、favorites 契约、launcherRail 槽、门控说明,中英一致
  - _Requirements: 3.2, 4.1, 5.1_
  - _Depends: 5.1_
