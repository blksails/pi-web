# Research Log — agent-sources-list

## Discovery 范围与类型

- **特性类型**:Extension(扩展既有系统)。沿用 pi-web 成熟的注入式端点模式与既有源探测语义,不引入新架构。
- **Discovery 强度**:Light(集成聚焦)。主要工作是精确对齐既有接口签名。

## 关键调查与结论

### 1. 现状:AgentSourcePicker 只能手输
- `components/agent-source-picker.tsx`:纯受控文本框 + submit,props 为 `{ onSubmit(source), defaultSource?, loading?, error? }`。**无任何源枚举能力**。
- 结论:本特性在此组件基础上**增量扩展**(在手输框之上加一个可选源列表),不重写、不改 `onSubmit` 语义。选中列表项 = 把该项 `source` 交给既有 `onSubmit`,后续会话创建路径零改动。

### 2. 复用既有源探测,勿重造
- `packages/server/src/agent-source/entry-probe.ts` 的 `probeEntry(dir): Promise<EntryProbe>`:纯读、无副作用;含 `package.json#pi-web.entry` 覆盖 + `index.ts>index.js>index.mjs` 优先级。返回 `{kind:"entry",path}` 或 `{kind:"none"}`。
- `packages/server/src/agent-source/source-type.ts` 的 `identify(source, opts): IdentifiedSource`:判定 dir/git/plugin/default,含 Windows 盘符等边角。
- 结论:扫描发现的"有效源"判据 = `probeEntry` 命中 `entry` → custom;`none` → cli(与真正建会话时的 `mode-decide` 一致)。git 元数据用 `identify` 派生 `kind`。**枚举阶段绝不调用 `AgentSourceResolver.resolve()`**(那会 clone/装配子进程)。

### 3. 注入式端点模板:createSessionListRoutes
- `packages/server/src/session-list/session-list-routes.ts`:`createSessionListRoutes(opts): ReadonlyArray<InjectedRoute>`。含惰性单例、`errorResponse/jsonResponse`、参数校验、base64url 不透明游标 keyset 分页、有界并发富集(`enrichDisplayNames`,`Promise.all` + 逐项 try/catch)。
- `InjectedRoute = { method, path, handler(ctx: RequestContext): Promise<Response> }`;`ctx.url.searchParams` 取查询参数。
- 装配:`lib/app/pi-handler.ts` 的 `routes: [...]` 数组内追加一行 `...createAgentSourcesRoutes({...})`,与 `createSessionListRoutes` 并列。**改注入路由后需重启 dev**(handler 是 globalThis 单例)。

### 4. 协议层
- `packages/protocol/src/transport/rest-dto.ts`:`ListSessions*` schema 为镜像模板。新增 `AgentSourceItemSchema / ListAgentSourcesRequestSchema / ListAgentSourcesResponseSchema`,zod 推导类型,零运行时,isomorphic。

### 5. 前端 client 与接线
- `packages/react/src/client/pi-client.ts`:`listSessions` 用 `URLSearchParams` 拼查询串 + `get<unknown>()` + `Schema.parse()`。新增 `listAgentSources` 照抄。
- `components/chat-app.tsx`:已 `createPiClient("/api")` 并把 `piClient.listSessions` 注入 `SessionListPanel`(注入式,面板不持接线,便于测试)。AgentSourcePicker 渲染于 `session === undefined` 分支、`<PiProvider>` 内。结论:在 ChatApp 层 `useMemo` 一个 `piClient`,把 `piClient.listAgentSources` 作为 prop 注入 AgentSourcePicker(与 SessionListPanel 同构注入式,组件保持纯/可测)。

## Synthesis(build vs adopt / 简化)

- **Adopt**:probeEntry / identify / InjectedRoute / errorResponse-jsonResponse / URLSearchParams+parse / 有界并发富集 —— 全部复用,不新造。
- **Build(最小新增)**:三个 provider(Scan/Registry/Composite)+ 一个只读路由 + 三个 zod schema + client 方法 + picker 列表 UI。
- **简化**:源数量通常很少(个位到几十),分页保留契约字段(limit/cursor)以对齐 sessions-list,但默认单页上限足够容纳,前端不强制"加载更多"。
- **id 稳定策略**:dir → 规范化(realpath)绝对路径;git → `url@ref`。Composite 按 id 去重,registry 覆盖 scan。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 路径遍历(符号链接逃逸扫描根) | 候选目录 `fs.realpath` 后校验仍以 `realpath(root)+sep` 为前缀;越界剔除(Req 2.5/6.2) |
| 大目录逐个读 package.json 卡顿 | 有界并发(信号量/分批 Promise.all),照 enrichDisplayNames(Req 6.3) |
| registry 文件损坏使整表失败 | 解析 try/catch,跳过坏条目/坏文件,其余照常返回(Req 3.2/3.3) |
| 误把无效目录报为可用源 | 判据严格走 probeEntry;none 目录按既有 mode 语义纳入 cli 或排除,与建会话一致(Req 2.3) |
| 改注入路由后 dev 不生效 | 重启 dev(globalThis 单例);e2e 用隔离 build + external server |
