# Implementation Plan

> M3:pi-web 装配改经 `defaultCapabilities()` + `composeCapabilities()`,行为零变化。
> **范围铁律(R7)**:不改 `host-manifest/{compose,types,capability-ids}.ts`(M1)、不改任一路由工厂签名、不删 aigc/vision、`host-assembly` **绝不进主 barrel** `src/index.ts`(D0,pi-SDK-free)。遇必须改 M1/工厂 → 停止回报。
> 强耦合装配改造,**串行为主**;3.1 与 4.1 在 2.1 后理论可并行(改文件不同),但为可控默认串行。

- [x] 1. host-assembly 基础设施(类型 + 子路径出口)

- [x] 1.1 建 `HostContribution` 联合、`HostDeps` 类型、子路径出口
  - `host-assembly/host-contribution.ts`:`HostContribution = {kind:"route";route:InjectedRoute} | {kind:"command";command:HostCommandHandler}`(D1);`asRoutes(rs)`/`asCommands(cs)` helper。`InjectedRoute`/`HostCommandHandler` 用 `import type`(不引值,守 D0)。
  - `host-assembly/host-deps.ts`:`HostDeps` 接口,容纳 Explore A3 表所列 15+1 工厂 deps 并集(D4);字段类型 `import type` 自各工厂/单例类型。
  - `host-assembly/index.ts`:导出 `HostContribution`/`HostDeps`/`defaultCapabilities`(2.1 补)/helper 的公开面。
  - `packages/server/package.json` `exports` 增 `"./host-assembly": "./src/host-assembly/index.ts"`。
  - **验证 D0**:`src/index.ts` 主 barrel **不**导出 host-assembly;`grep` 确认无新增主 barrel 行。
  - 观察性完成态:`pnpm --filter @blksails/pi-web-server typecheck` rc=0;`@blksails/pi-web-server/host-assembly` 子路径可解析(package.json exports 生效)。
  - _Requirements: 1.1, 3.2, 5.1, 5.2, 7.1_
  - _Boundary: host-assembly_

- [x] 2. defaultCapabilities 绑定 16 能力面

- [x] 2.1 实现 `defaultCapabilities(deps): CapabilityDescriptor<HostDeps, HostContribution>[]`
  - 按 `HOST_CAPABILITY_IDS_V1` 顺序返回 16 个 descriptor,各 `id` 绑定契约 §5.3 对应工厂(D2):`config.domains`→`createConfigRoutes`、…、`extension.manage`→`createExtensionRoutes`、`host.commands`→`asCommands(deps.hostCommandHandlers)`。
  - 15 路由能力面 factory 产 `asRoutes(createX(...))`;双位置参数工厂(attachment/bash)内部适配 `(d)=>createAttachmentRoutes(d.attachmentStore,{...})`(R5.2,不改工厂签名)。
  - **条件挂载(D3)**:`gateway.llm`/`gateway.ai`/`auth.session` 的 factory 内部读 `deps` 条件,未配置返回 `[]`、已配置返回对应工厂路由(等价现状三元 `cond?createX(...):[]`)。
  - 不含 `aigc.models`/`vision.models`(R1.3)。
  - 观察性完成态:`defaultCapabilities(deps).map(d=>d.id)` 排序 === `HOST_CAPABILITY_IDS_V1` 排序;typecheck rc=0(TDeps 收敛后类型自洽)。
  - _Requirements: 1.1, 1.2, 1.3, 2.5, 3.1, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2_
  - _Depends: 1.1_
  - _Boundary: host-assembly_

- [x] 3. pi-handler 装配改造

- [x] 3.1 `buildSingleton()` 改经 composeCapabilities 装配 + 分拣
  - 在 `buildSingleton()` 内构造 `HostDeps`(一次构造,复用现有单例 store/manager/attachmentStore/aiGwConfig/authSessionState/扩展接缝等,D4/R5.3)。
  - 构造 pi-web 静态 `decisions`:16 id 各 `{kind:"use"}`(D3;R2.2)。
  - `const contributions = composeCapabilities({ descriptors: defaultCapabilities(deps), decisions, deps, onDecline })`;`onDecline` 接 `createLogger({namespace:"server:host-assembly"}).info`(D7/R2.4)。
  - 分拣:`composedRoutes = contributions.filter(kind==="route")`、`composedCommands = filter(kind==="command")`(D5)。
  - `createPiWebHandler({ routes: [...composedRoutes, ...createAigcModelsRoute({...}), ...createVisionModelsRoute({...})], hostCommands: createHostCommandRegistry(composedCommands), ... })`(D6:aigc/vision 维持 compose 外;R6.5)。
  - 移除原 15 工厂的裸 spread 与原 `hostCommands: createHostCommandRegistry([...])` 内联;**net import 面不变**(pi-handler 改 import `defaultCapabilities`)。
  - 观察性完成态:`buildSingleton` 不再裸 spread 15 工厂;pi-handler typecheck rc=0;dev 启动后五类端点(config/session/gateway/attachment/bash)与命令(clear/install)均可达(经既有 http e2e 佐证)。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3, 5.3, 6.5, 7.2, 7.3_
  - _Depends: 2.1_
  - _Boundary: pi-handler_

- [x] 4. 装配级等价测试(行为零变化核心守卫)

- [x] 4.1 `test/host-assembly/default-capabilities.test.ts`
  - ① id 集 === 名册(杀多/少 descriptor);② 路由集等价:全 use compose 的 `route` 贡献 `{method,path}` 集 === 直接调 15 工厂并集(杀漏绑/绑错工厂);③ 命令集等价:`command` 贡献 registry 命令名集 === 现状 `[clear, install]`(杀 host.commands 漏绑);④ 条件两态:llm/ai/auth 未配置产空、已配置产对应路由(杀条件映射错,等价三元);⑤ 强制表态:漏一个 id→抛 `CapabilityCompositionError` code `missing-decision`(杀表态不全被放过);⑥ host.commands decline(带 reason)→命令贡献空、不抛、onDecline 收到 (id,reason)(杀非路由不能弃用)。
  - 每条附变异判据(括注的错误实现应让对应用例转红)。
  - 观察性完成态:`pnpm exec vitest run test/host-assembly/default-capabilities.test.ts` 真实计数全绿(非 `no tests`/非 `Errors N error`),6 组守卫齐备。
  - _Requirements: 6.1, 6.2, 6.4, 1.4, 3.4_
  - _Depends: 2.1_
  - _Boundary: host-assembly-test_

- [x] 5. 垂直验证(回归 + fresh-evidence)

- [x] 5.1 全量回归 + typecheck + http e2e,证据落盘
  - `packages/server` 全量单测全绿(真实计数;防假绿:`no tests`/`Errors N error` 不算过);既有各工厂单测不改断言全通过(R6.3)。
  - `packages/server` typecheck rc=0(R8.2)。
  - node e2e 受影响面:`e2e/node/http.e2e.test.ts`(装配级)+ 相关,全绿或对既有失败做基线对照证明与本 spec 无关(R8.3;goal 的 e2e 环节)。
  - `aigc-models-routes.test.ts` / vision 相关全绿(维持现状,R6.5)。
  - 观察性完成态:三项命令真实计数 + 时间戳记于 `verification/`(命令原文 + pass/fail 数),不以「应当通过」替代实际运行。
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 3.1, 4.1_

## Implementation Notes

- **★ 关键 bug:Router 顺序敏感,M3 按名册顺序引入 mcp 回归(基线对照才抓到)**。Router `route()` 按注册顺序匹配、首个 `method+path` 命中即 `break`(`router.ts:163`);`/config/:domain` 会匹配 GET /config/mcp(`:domain`="mcp")。现状 pi-handler 让 `createMcpConfigRoutes` 排 `createConfigRoutes` **之前**(原注释明警"MCP 必须排在 /config/:domain 之前")。M3 的 `defaultCapabilities` 最初**按 `HOST_CAPABILITY_IDS_V1` 名册顺序**产出(config.domains 在 config.mcp 前)→ GET /config/mcp 被抢 → DOMAIN_NOT_FOUND。**此 bug 逃过守卫①②(用 sort 比集合,不看顺序)与全部既有 e2e(无一覆盖 GET /config/mcp 经装配)**;靠 `git stash` 回 HEAD 的**基线对照**发现「M3 全量 e2e 比基线多 1 处失败」才追出。修复:`default-capabilities.ts` 把 config.mcp 排 config.domains 前 + 新增装配级守卫⑦(索引断言 mcpIdx<domainIdx)。**教训**:装配重构的「行为零变化」必须含**路由注册顺序**这一隐藏语义;design 原稿"Router 对 injected 顺序不敏感"是错的,已更正。

- **HostDeps 与 defaultCapabilities 合并一文件**(design 分文件是建议):二者紧密耦合,合并免去跨文件重复借用 15 个工厂 opts 类型。用 `Parameters<typeof createX>` 借 opts 类型,`HostDeps` 字段一次 typecheck 收敛(rc=0)。

- **条件挂载(llm/ai/auth)映射(D3)**:HostDeps 用**可选字段**(`llmGateway?`/`aiGateway?`/`authState?`),buildSingleton 在条件内构造(未配置为 undefined)——secret 等惰性求值只在配置时发生,规避 `resolveLlmGatewaySecret` 未配置抛错。factory 内 `d.x !== undefined ? asRoutes(...) : []`,等价现状三元。decisions 恒 use、静态可读。

- **D0 barrel 铁律**:`defaultCapabilities` factory import 真实工厂(含 pi SDK 传递依赖),经独立子路径出口 `@blksails/pi-web-server/host-assembly`,**未并入主 barrel** `src/index.ts`(grep 验证)。既跨仓可引用(pi-clouds C2/desktop D4)又不污染 routes bundle。

- **host.commands 非路由统一(D1)**:`HostContribution = {kind:"route"} | {kind:"command"}` 可判别联合作 compose 的 `TRoute`,16 id 同一次 compose、同一份 decisions 强制表态,装配层按 kind 分拣回 routes/hostCommands。M1 compose 引擎泛型,零改动。

- **import 清理**:noUnusedLocals 未开,但仍移除 pi-handler 里 15 个已移走的路由工厂 import(保留 aigc/vision/hostCommandRegistry 及 HostDeps 构造用的 resolve* 辅助)。pi-handler 净减 54 行。

- **既有 e2e 失败(基线对照证明与本 spec 无关)**:`auto-retry-402`(Theme A session/translate,M3 不碰)、`module-settings-agent`(agent-routes 握手超时,M2 已证既有)——stash M3 改动回 HEAD 跑,二者同样失败。

- **★ 守卫②重言式(复核 REJECT → 修复)**:4.1 守卫②初版用 `descriptors.flatMap(d.factory)` 作「直调工厂」基线——那是 defaultCapabilities 自己的 factory 自我对比、**恒等**,对「绑错工厂」零反应(reviewer 亲手把 config.sandboxProject 绑错成 createConfigRoutes,守卫② 7/7 仍绿、全量 2172 仍绿,只有 config-domains.e2e 抓到)。这正是 [[pi-web-subpackage-test-faces]] 那批(M2)遇过的「伪装成守卫的恒真断言」,我审查 4.1 时又漏了(以为 5 个特征端点样本补足,实则其余 10 能力面绑错不被抓)。修复:重写守卫②为**独立基线**(测试直接 import 15 真实工厂各调一次作第二份真相);亲手同一变异验证 → 守卫② **转红**(compose 36 vs 独立基线 35),还原后 7/7。**教训重申**:自己造的守卫总倾向于验证「自己想到的」,独立 reviewer 的价值是不同搜索空间。

- **验证真实性**:server 全量 **2172** passed/17 skip(2165 + 7);root/server typecheck rc=0;config-domains.e2e 6/6 经 buildSingleton;**node e2e 串行 vs 并发对照**确认 `attachment-completion` 是并发资源竞争 flaky 非 M3 回归(串行过、并发挂、单独 3/3);串行剩 `auto-retry-402`+`module-settings-agent` 既有失败。证据落 `verification/README.md`。
