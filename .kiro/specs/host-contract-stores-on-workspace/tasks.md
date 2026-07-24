# Implementation Plan

> M4:4 个 store 内部改建到 LocalWorkspace(M2 模式:保留类型化接口 + `createLocalWorkspaceNamespace` + 固定键 + catch corrupt 降级),行为零变化;trust 本期不迁(D0)。
> **范围铁律(R7)**:不改 M1 `workspace/*`、不改 attachment/session-store、不改各 store 业务逻辑(zod/去重/sourceKey)。遇必须破坏跨进程契约 → 停止回报。
> 任务 1–4 边界互斥(不同 store 文件),可并行 `(P)`。

- [x] 1. FavoritesStore 迁移到 workspace.user (P)
  - `favorites-store.ts`:工厂改接受 `root`(agentDir),内部 `createLocalWorkspaceNamespace(root)`;`list()` 经 `readJson("agent-source-favorites.json")` + catch `err.code==="corrupt"`→`[]`(保静默降级,按 code 不用 instanceof),其余 io rethrow;`set()` 经 `writeJson("agent-source-favorites.json", {favorites}, {merge:false})`。移除直接 `node:fs`。zod 逐条校验/坏条目跳过不变。
  - 消费方 `favorites-routes.ts` 从传 `filePath` 等价改写为传 `agentDir`(store 内部拼键)。
  - 观察性完成态:`favorites-store.test.ts`/`favorites-routes.test.ts` 既有断言全绿;新增守卫(损坏→`[]`、落盘字节 `JSON.stringify(x,null,2)` 无尾换行);store 内无 `node:fs`。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_
  - _Boundary: favorites-store_

- [x] 2. SessionFavoritesStore 迁移到 workspace.user (P)
  - `session-favorites-store.ts`:同任务 1 模式,键 `session-favorites.json`、形态 `{sessionIds}`;`list()` catch corrupt→`[]`;`set()` 全量替换 + 去重 + 丢空串不变,`writeJson(merge:false)`。
  - 消费方 `session-actions-routes.ts` 惰性单例改传 `agentDir`。
  - 观察性完成态:`session-favorites-store.test.ts` 等既有全绿 + 收紧守卫;store 内无 `node:fs`。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4_
  - _Boundary: session-favorites-store_

- [x] 3. per-source settings 迁移(双命名空间 + deepMerge 收敛) (P)
  - `source-settings-codec.ts`:scope="source"→`createLocalWorkspaceNamespace(agentDir)` 键 `sources/<sourceKey>/settings.json`;scope="project"→`createLocalWorkspaceNamespace(join(cwd,".pi"))` 键 `source-settings/<sourceKey>.json`(两键与现状落盘逐一致)。`load` catch corrupt→`{}`;`save` 本层 read-modify-write(复用 `deepMergeJson`)+ 底层 `writeJson(merge:false)`(避免损坏磁盘二次 read 抛 corrupt,同 M2 D3)。
  - **删除内部第三份私有 `deepMerge`**(`:45-69`),收敛到 `deepMergeJson`(R4.2);`isSourceKey` 校验保留。
  - 消费方 `source-settings-routes.ts` + `runner/source-settings-assembly-wiring.ts` 等价改写(传 agentDir/cwd)。
  - 观察性完成态:`source-settings-codec.test.ts`/`source-settings-routes.test.ts`/`source-settings-endpoint.e2e` 全绿;私有 deepMerge 已删;merge 结果逐项等价。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: source-settings-codec_
  - _Depends: 无(与 1/2/4 并行)_

- [x] 4. sources 注册表迁移(只读 + env 覆盖处置) (P)
  - `registry-provider.ts`:`list()` 默认经 `createLocalWorkspaceNamespace(agentDir).readJson("sources.json")`(=`<agentDir>/sources.json`,与现状默认等价)+ catch corrupt→`[]`;坏条目逐条跳过不变。
  - **env 覆盖(D5/R5.3)**:工厂保留可选 `registryPath` 覆盖——设 `PI_WEB_SOURCES_REGISTRY` 时沿用旧 fs 直读该任意路径(逃生舱,非 workspace 键),未设时经 workspace user 键 `sources.json`。装配层判定不变。
  - 消费方 `agent-sources-routes.ts` 构造等价改写(传 agentDir + 可选 env 覆盖)。
  - 观察性完成态:`registry-provider.test.ts` 全绿 + 收紧守卫(损坏→`[]`);env 覆盖两态(设/未设)各有用例。
  - _Requirements: 1.1, 1.2, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: registry-provider_

- [x] 5. trust store 不迁决策记录(D0,无代码迁移) (P)
  - 确认 `trust/trust-store.ts` 及 `project-trust-policy.ts` **零改动**(git 核对)。
  - 在契约 `docs/pi-web-host-contract-v1.md` 记录 trust 张力 errata(§7.5):trust store 因与 pi CLI 共享 `~/.pi/agent/trust.json` 字节契约(排序+`\n`)+ 同步 API + Workspace 不可定制序列化,本期不迁;§3.7 表「七项」中 trust 待契约层面重新决策(云端是否需要 trust、是否值得引入可定制序列化的 Workspace 变体)。
  - 观察性完成态:契约文档含 trust 张力记录;trust 代码 git diff 为空。
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: docs_

- [x] 6. 垂直验证(回归 + fresh-evidence)
  - `packages/server` 全量单测全绿(真实计数;防假绿:`no tests`/`Errors N error` 不算过);各 store 既有单测不改断言全通过(R8.1)。
  - `packages/server` typecheck rc=0(R8.2)。
  - 受影响 e2e:`source-settings-endpoint.e2e` + 相关,全绿或既有失败基线对照(R8.3;goal 的 e2e 环节)。
  - 观察性完成态:三项命令真实计数 + 时间戳落 `verification/`。
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 1, 2, 3, 4, 5_

## Implementation Notes

- **★ 错误分区两种模式(行为零变化关键)**:favorites/session/registry 现状对**所有**读错误 `catch → []`(含 io,`favorites-store.ts:52` 等),迁移**保持全 catch**(不是 ConfigCodec 的 corrupt-catch+io-rethrow)——否则 io 错误从静默变抛错,破坏零变化。per-source(`SourceSettingsCodec`)现状与 ConfigCodec 同(ENOENT→{}/坏→{}/**io→throw**),迁移用 M2 模式(catch `err.code==="corrupt"`→{}、io rethrow,按 code 不用 instanceof)。design 的 Error Handling 初稿统一按 corrupt-catch+io-rethrow 描述,favorites 那三个按现状修正为全 catch。

- **sources 迁移比 D5 原方案更简**:D5 原写「默认 workspace 键 + env 逃生舱 fs 直读」需改装配层三层传参。实际用**把 `registryPath` 拆 `dirname`(namespace root)+ `basename`(key)经 `createLocalWorkspaceNamespace(dir).readJson(basename)`**——落盘文件不变(含 `PI_WEB_SOURCES_REGISTRY` 覆盖的任意路径),只是读经 workspace;**options/装配/测试零改动**、env 覆盖天然支持、全 catch→[] 保持。basename 是单段符合键空间。

- **消费方改动面**:favorites/session 工厂参数 `filePath`→`root`(agentDir),消费方(favorites-routes/session-actions-routes)+ 测试等价改写 + 删 unused `path`/`FAVORITES_FILE`。per-source(`SourceSettingsCodec` 构造 `agentDir` 不变)与 sources(`registryPath` 不变)**消费方零改动**。

- **per-source deepMerge 收敛(R4.2)**:删 `source-settings-codec.ts:45-69` 私有 `deepMerge`,收敛到 `deepMergeJson`(全仓 merge 副本从 3(config M2 已删 1)→ 现 1(仅 source-settings 这份),M4 后 → 0 独立副本,全用 `deepMergeJson`)。save 本层 read-modify-write + 底层 `writeJson(merge:false)`(同 M2 D3)。

- **trust=B(勘误⑭)**:trust 代码零改动;契约 §3.7 表下记录三处张力(同步 API / pi CLI 字节契约 / 损坏抛+键名),§8.3「五个」收敛为「四个 + trust 悬置」。

- **★ 复核 REJECT → 修(守卫充分性)**:reviewer 亲手变异证实 per-source 的 corrupt→{} 分支**无守卫**——删 corrupt catch(裸 readJson)后 38 例全绿零反应;而 favorites/session/registry 同款「删 catch」变异都被既有坏 JSON 用例抓住,**唯独 per-source 测试从无损坏 JSON 断言**。这是迁移**新引入**的代码路径(此前 `JSON.parse` try/catch 吞一切 → 现按 `err.code` 判别再降级),既有测试不覆盖新分支。修:`source-settings-codec.test.ts` 补 source+project 两条「损坏 JSON→load 返回 {}」守卫,亲手禁用 corrupt 降级验证两条**均转红**,还原后 20 passed。教训:迁移引入的新代码路径(哪怕是等价降级)必须配新守卫,「既有测试全绿」只证明未破坏旧路径、不证明新分支正确。

- **验证**:server 全量 **2174** passed/17 skip(2172 + 2 守卫;各 store 既有单测 favorites 9/session 8/source-settings 20/registry 6 全绿=行为零变化);双侧 typecheck 0;source-settings-endpoint.e2e 6/6(per-source 端到端经真实路由)。
