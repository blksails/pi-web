# Implementation Plan

- [x] 1. 协议契约:agent source 列表 DTO
- [x] 1.1 在 rest-dto 新增 AgentSourceItem / ListAgentSourcesRequest / ListAgentSourcesResponse schema
  - 在 `packages/protocol/src/transport/rest-dto.ts` 追加三个 zod schema 与推导类型,字段:id/source/name/kind(dir|git)/origin(scan|registry)/mode(custom|cli)/description?;请求 limit?(正整数)cursor?;响应 sources[] + nextCursor?
  - 从 protocol 包入口导出新符号,`pnpm --filter @blksails/pi-web-protocol typecheck` 通过
  - 观测完成:新增 `AgentSourceItemSchema` 等可被其它包 import,类型推导无 any
  - _Requirements: 1.1_

- [x] 2. 后端只读枚举(provider + 端点)
- [x] 2.1 实现 ScanSourceProvider(扫描根一级子目录 + realpath 门控) (P)
  - 新建 `packages/server/src/agent-source-list/{types.ts,scan-provider.ts}`;`list()` 枚举每个 root 一级子目录,复用 `agent-source/entry-probe.ts` 的 `probeEntry` 判定 custom(entry)/cli(none)
  - 对每个候选目录 `fs.realpath` 后校验前缀落在 `realpath(root)+sep` 之内,越界/解析失败剔除;root 不存在跳过;非目录项忽略
  - id/source=候选目录 realpath 绝对路径;name=package.json name ?? 目录末段
  - 观测完成:`scan-provider.test.ts` 覆盖 含 index.ts→custom、空目录→cli、非目录忽略、符号链接逃逸根被剔除,全绿
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.2_
  - _Boundary: ScanSourceProvider_

- [x] 2.2 实现 RegistrySourceProvider(读 JSON manifest,容错) (P)
  - 新建 `packages/server/src/agent-source-list/registry-provider.ts`;`list()` 读 `registryPath`,解析 `{ sources: [...] }`,逐条 zod 校验,kind 由 `agent-source/source-type.ts` 的 `identify` 派生
  - 文件不存在→返回 [];JSON 解析失败→[];个别坏条目跳过其余保留;git 条目标 kind=git 且**不 clone/不 resolve**
  - id:dir→realpath(存在时)否则规范化路径;git→`url@ref`;origin=registry
  - 观测完成:`registry-provider.test.ts` 覆盖 合法读取、缺失→[]、坏 JSON→[]、坏条目跳过、git 条目不触发任何 clone,全绿
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: RegistrySourceProvider_

- [x] 2.3 实现 CompositeSourceProvider(去重合并 + 稳定排序)
  - 新建 `packages/server/src/agent-source-list/composite-provider.ts`;合并 Scan 与 Registry 结果,按 `id` 去重,registry 记录覆盖 scan 元数据;稳定排序(registry 优先,其后按 name)
  - 任一子 provider 抛错退化为空贡献,不使整体失败
  - 观测完成:`composite-provider.test.ts` 覆盖 同源去重为一、registry 覆盖元数据、排序稳定、子 provider 失败被吞,全绿
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: CompositeSourceProvider_
  - _Depends: 2.1, 2.2_

- [x] 2.4 实现 createAgentSourcesRoutes(GET /agent-sources)
  - 新建 `packages/server/src/agent-source-list/agent-sources-routes.ts` 与 `index.ts`;返回 `ReadonlyArray<InjectedRoute>`,复用 `http` 的 `errorResponse/jsonResponse`
  - 校验 limit(非整/≤0→400)、cursor(base64url 解码失败→400);惰性单例构造 Composite;有界并发(默认 8)富集 description;`{name,id}` keyset 游标切片分页;未配来源→200 空列表
  - 从 server 包入口导出 `createAgentSourcesRoutes` 及选项类型
  - 观测完成:`agent-sources-routes.test.ts` 覆盖 200 结构、空来源→200 空表、limit=0/坏 cursor→400、超页带 nextCursor 续取不重复、扫描仅限根内,全绿
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.3_
  - _Boundary: createAgentSourcesRoutes_
  - _Depends: 1.1, 2.3_

- [x] 3. 前端(client + 选择器列表)
- [x] 3.1 PiClient 新增 listAgentSources (P)
  - 在 `packages/react/src/client/pi-client.ts` 增接口声明与实现:URLSearchParams(limit,cursor)→ `GET /agent-sources` → `ListAgentSourcesResponseSchema.parse`;从 react 包入口导出相关类型
  - 观测完成:`pi-client-agent-sources.test.ts` 断言正确拼串且对响应 parse(mock fetch),全绿
  - _Requirements: 1.1_
  - _Boundary: PiClient_
  - _Depends: 1.1_

- [x] 3.2 扩展 AgentSourcePicker:源列表子视图 + 选取 (P)
  - 改 `components/agent-source-picker.tsx`:新增可选 props `listAgentSources?`、`enableSourceList?`;启用且注入时 mount 拉首页,三态(idle/loading/error)+ 竞态守卫(reqId ref)
  - 列表项显示 name + mode 徽标 + 可选 description,`data-agent-source-list`/`data-agent-source-item`;点击项调 `onSubmit(item.source)`;加载失败不阻断手输框;空列表显示空态且保留手输框;`loading` 时禁用列表点击
  - 观测完成:组件测试覆盖 列表渲染、点击项以其 source 触发 onSubmit、错误态保留手输、空态、创建中禁点,全绿
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.4_
  - _Boundary: AgentSourcePicker_
  - _Depends: 1.1_

- [x] 4. 集成装配
- [x] 4.1 pi-handler 装配端点 + Next 转发器 + 解析来源环境变量
  - 改 `lib/app/pi-handler.ts`:`routes:` 追加 `...createAgentSourcesRoutes({...})`;解析 `PI_WEB_SOURCES_ROOT`(path.delimiter 分隔、相对以 config.defaultCwd 绝对化)与 `PI_WEB_SOURCES_REGISTRY`(默认 `<agentDir>/sources.json`)
  - 新增 `app/api/agent-sources/[[...path]]/route.ts` catch-all 转发器(GET → getHandler),否则 `/api/agent-sources` 落 Next 404 到不了 handler
  - 观测完成:配 `PI_WEB_SOURCES_ROOT=examples` 后 `curl /api/agent-sources` 返回非空 JSON 列表;未配时返回 200 空表
  - _Requirements: 1.2, 6.4_
  - _Depends: 2.4_

- [x] 4.2 chat-app 接线:注入 listAgentSources + 门控开关
  - 改 `components/chat-app.tsx`:ChatApp 层 useMemo 一个 piClient,把 `piClient.listAgentSources` 与 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` 门控作为 props 注入 `AgentSourcePicker`
  - 观测完成:开启门控并配来源后,新建界面渲染源列表;关闭门控时仅显示手输框(dev 手动验证)
  - _Requirements: 5.1, 6.4_
  - _Depends: 3.1, 3.2, 4.1_

- [x] 5. 验证与文档
- [x] 5.1 端点只读性集成断言
  - 在端点集成测试中新增:一次枚举请求前后,fixture 扫描目录与 registry 文件字节+mtime 不变,且无子进程创建
  - 观测完成:只读断言测试通过,证明无写/无 clone/无 spawn
  - _Requirements: 6.1_
  - _Depends: 2.4_

- [x] 5.2 浏览器 e2e:选源建会话闭环
  - 隔离 build(`NEXT_DIST_DIR=.next-e2e`)+ external server,配 `PI_WEB_SOURCES_ROOT=examples` 与开启门控;脚本:新建界面出现 `data-agent-source-list` → 点击某项 → 会话创建 → 收到流式回复;并验空态(未配来源时列表空、手输框可用)
  - 观测完成:e2e 用例本地跑绿,输出留存
  - _Requirements: 5.1, 5.2, 5.4_
  - _Depends: 4.2_

- [x] 5.3 文档:端点契约与环境变量(中英双份)
  - 更新 `docs/product/13-http-api-reference.md`(GET /agent-sources 契约)、`docs/product/05-configuration.md`(三个环境变量)与 `docs/product/07-agent-development.md` 相关小节,及 `docs/product/en/` 对应镜像
  - 观测完成:文档含端点请求/响应/错误码表与 `PI_WEB_SOURCES_ROOT`/`PI_WEB_SOURCES_REGISTRY`/`NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` 说明,中英一致
  - _Requirements: 1.1, 6.4_
  - _Depends: 4.1_
