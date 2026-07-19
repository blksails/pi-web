# Implementation Plan

> 分期:M1(面⑦ 静态主体)→ M2(面⑤ 路线 A)→ M3(面⑦ 动态控件 + 实时下发)→ M4(云上)。
> 依赖标注:`(P)` 可并行;`[cloud]` 需 pi-clouds 侧配合;`[npm]` 需 pi-web 发 npm 版云上才能接线。
> `sourceKey` 对齐 registry sourceId(拍板 Q2);`scope:"project"` 用独立 `.pi/source-settings/`(拍板 Q5)。
> 面⑤ 路线 B(云上 iframe 隔离车道 5B.*)不列入本 spec —— 见文末备注,属 pi-clouds 阶段3 另立 spec(拍板 Q1)。

## M1 · 面⑦ per-source settings 静态主体(本地)

- [ ] 0. 共享地基
- [x] 0.1 sourceKey 工具(sha256 散列 + 路径安全,输入对齐 registry sourceId)
  - 新增 `sourceKey(source)`:以 registry sourceId 为稳定输入(不含版本/channel),sha256 短散列(同 template-name.ts 现成模式),仅含文件系统安全字符
  - 供面⑦ 配置目录/DB 主键、面⑤ dist 寻址/源匹配复用(单一事实来源)
  - 完成态:单测覆盖碰撞/注入用例 + 升版(version/channel 变、sourceId 不变)散列不变;typecheck 绿
  - _Requirements: 0.1, 0.2, 0.3, 0.4_
  - _Boundary: sourceKey 工具(共享地基 G3)_

- [ ] 1. 清单声明面与解析
- [x] 1.1 protocol:PiWebManifestSchema 新增 settings 段 + zod 校验
  - 新增 `PluginSettingsSchema`(schema/title/icon/scope/widgets),挂 PiWebManifestSchema;未声明 settings 的清单零变化
  - 完成态:合法/非法 settings 段解析单测;typecheck 绿
  - _Requirements: 1.1, 1.5, 13.1, 13.2_
  - _Boundary: 清单 settings 段(protocol)_
- [x] 1.2 server:PluginDescriptor 加 settings 切片 + resolvePiPlugin 产出
  - resolve-plugin 解析 settings 段进 PluginDescriptor(文件存在即启用回退;schema 非法/缺失降级 diagnostics 不 fail 整模块)
  - 完成态:有清单/无清单回退/非法三档单测
  - _Requirements: 1.2, 1.3, 1.4_
  - _Depends: 1.1_

- [ ] 2. 持久化与端点
- [x] 2.1 [0.1] server:per-source config codec(source/project 双作用域)
  - 落盘 source→`<agentDir>/sources/<sourceKey>/settings.json`、project→`<cwd>/.pi/source-settings/<sourceKey>.json`(独立目录,不并入 .pi/settings.json);0700/0600;缺文件回 {};复用既有 config-codec 范式
  - 完成态:双作用域落盘 + 缺文件回 {} + secret 存密文/掩码引用单测
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Depends: 0.1_
- [x] 2.2 [1.2,2.1] server:GET|PUT /api/config/source/:sourceKey 端点(挂 config 段)
  - GET 回 {schema, values(masked), version};PUT 按 schema 校验→mergeSecrets→按 scope 落盘;secret 永不回读明文;挂 config 段不开顶层段;门控/body-limit/error-map 抄 agent-route-routes
  - create-handler 注册 builtin 端点
  - 完成态:200/400(校验失败)/404/门控/secret 掩码全档单测;整站部署形态无静默 404(测试证明)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Depends: 1.2, 2.1_
  - 生产 resolveSettings 接线已补(补task 2.3):`lib/app/pi-handler.ts` 的 `makeSourceSettingsResolver` 替换过渡态占位实现,候选包根目录 = `config.defaultCwd` ∪ 内置 default-agent ∪「已安装/已登记本地目录源」(与 `GET /agent-sources` 同一 provider 组合),逐个 `resolvePiPlugin → descriptor.id → sourceKey` 命中匹配;新增 `resolveSourceSettingsFromPackageDirs`(`packages/server/src/config/source-settings-routes.ts`)承载该匹配逻辑,经 config barrel 导出。真实 fixture(`settings-assembly-source-e2e-agent`)端到端验证 200/PUT 回读/未知 sourceKey 仍 404,见 `e2e/node/source-settings-endpoint.e2e.test.ts`。

- [ ] 3. 装配期注入
- [x] 3.1 [2.1] runner:AgentContext 加 settings + 装配期注入
  - agent-kit + server/runner 两处镜像加只读 settings;runner 装配期读对应作用域 per-source settings.json 注入 ctx.settings(无文件=空对象);secret 解掩码后仅经 spawn env/stdin 传子进程不落浏览器
  - 完成态:**真实子进程集成测试**证 ctx.settings 命中(stub 抓不到装配期注入回归);存量无 settings source ctx.settings 空对象且行为零变化
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Depends: 2.1_

- [ ] 4. 前端面板与动态控件挂载
- [x] 4.1 (P) react:registerSourceSettingsPanel 动态登记
  - source 激活时幂等登记 per-source 面板(按 id 覆盖 + bump,复刻 registerMcpPanelIfInstalled);菜单项标题取清单 settings.title;复用 SettingsShell + FormSchema 渲染器
  - 完成态:激活→面板长出 + 切源回收用例
  - _Requirements: 5.1, 5.2, 5.6_
  - _Depends: 2.2_
- [x] 4.2 (P) ui:per-source scoped field registry
  - registerFieldRendererByKey 之上加 registerSourceFieldRenderer(sourceKey,key,comp),查找 per-source→全局,切源/卸载回收;webext 缺失/验签失败字段降级只读 JSON
  - 完成态:scoped 命中/回收/降级只读单测
  - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [x] 5. 面⑦ 本地验收
- [x] 5.1 examples/module-settings-agent fixture + e2e
  - 清单含 settings 段 + settings/schema.json(含 secret + widget + liveReload)+ 工厂消费 ctx.settings;widget 数据端点走本模块 agent-declared-routes(面⑥⑦ 互为供给)
  - e2e:选源→出面板→存 apiBase→新会话 systemPrompt 含值→未 trust/验签失败降级矩阵
  - 完成态:隔离 build e2e 新鲜运行全绿
  - Req 5.2(GET 响应透出清单级 settings.title/icon;react 面板标题优先 manifest title → schema.title → fallbackTitle)已随本任务补齐,两侧测试同步(`source-settings-routes.test.ts`/`register-source-settings-panel.test.ts`)
  - _Requirements: 5.1, 5.4, 5.5, 13.3_
  - _Depends: 2.2, 3.1, 4.1, 4.2_

## M2 · 面⑤ 第三方 slots 路线 A(本地)

- [ ] 6. 第三方 slots 代码扩展本地全链
- [ ] 6.1 web-kit:slots 组件编进 dist entry(manifest 带 entry + SRI + 签名)
  - build 产带 entry(.mjs)的 manifest.json + 逐文件 sha384 SRI + Ed25519 签名(复用 manifest-emit);slots 组件经 import map 单例复用宿主 React;canonicalManifestBytes 排除 signature
  - 完成态:webext-slots-agent build 出带 entry manifest;SRI/签名断言
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 0.1_
- [ ] 6.2 [6.1] react:代码扩展 slots 运行时加载挂 SlotHost(本地)
  - manifest 带 entry → loadExtension 走 status:"loaded":fetch→安全门→动态 import→挂 SlotHost;渲染到 pi-chat/chat-app 既有槽区;声明式-only 保持既有行为
  - 完成态:第三方 slots-agent 经 /api/webext/resolve+dist 挂各槽单测/集成
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Depends: 6.1_
- [ ] 6.3 [6.2] 安全门贯通与降级
  - SRI + Ed25519 白名单签名 + API 版本 caret 三门;篡改/坏签名拒绝;单槽加载/渲染失败经 ExtErrorBoundary 隔离降级不崩壳
  - 完成态:篡改被拒/坏签名被拒/单槽失败隔离单测
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - _Depends: 6.2_
- [ ] 6.4 [6.3] e2e:webext-slots-agent 作第三方源本地全链
  - 不经构建期静态 import 车道,纯运行时 resolve→dist→import→挂 18 槽全链;安全门降级 e2e;既有第一方/声明式 webext 行为零变化(全量回归绿)
  - 完成态:隔离 build e2e 全绿 + 回归绿
  - _Requirements: 11.1, 11.2, 11.3, 13.2_
  - _Depends: 6.3_

## M3 · 面⑦ 动态控件 + 实时下发(延后)

- [ ] 7. 动态控件咬合与实时下发
- [ ] 7.1 [4.2,6.2] 动态控件 widget 咬合面⑤ 路线 A 产出
  - settingsWidgets capability 提供的 renderer 经 per-source scoped registry 命中;widget 数据端点走 agent-declared-routes;webext 缺失降级只读 JSON
  - 完成态:动态控件端到端(widget→routes→runner)e2e
  - _Requirements: 5.4, 5.5_
  - _Depends: 4.2, 6.2_
- [ ] 7.2 [3.1] (M3,可选) 运行期 piweb_settings_changed 实时下发
  - PUT 成功后经 stdin 推 piweb_settings_changed(复用 piweb_state 广播 + sticky 回放);liveReload 键实时生效;重连粘性帧回放不丢
  - 完成态:liveReload 键 PUT 后实时到前端 + 重连回放单测/集成
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 3.1_

## M4 · 云上(apps/cloud,依赖 npm 发版 + pi-clouds 配合 + 真机)

- [ ] 8. 面⑦ 云上落地
- [ ] 8.1 [cloud][2.2] pi-clouds:Supabase pi_clouds_source_settings 表 + 云侧落盘重写
  - 新建 pi_clouds_source_settings(company_id,user_id nullable,source_key,payload jsonb,unique(company_id,user_id,source_key)),复刻 provider_keys 分层;/api/config/source/* 云侧落盘重写到 Supabase;secret 走信封加密 + 三层解析(user→org→platform);auth 类 secret 不明文回吐
  - 完成态:分层生效 + secret 信封加密 + 静态字段云上与本地等价
  - _Requirements: 6.1, 6.2, 6.4, 6.5_
  - _Depends: 2.2_
- [ ] 8.2 [cloud][npm][3.1] pi-clouds:claim→configure 送达沙箱
  - per-source settings 经 bridge configure 写进沙箱 workspace(池化 claim 后 configure,不靠 create env),沙箱内同一 runner 装配期注入 ctx.settings
  - 完成态:池化 claim 后 configure 送达 + 沙箱内 ctx.settings 命中;真机 e2e(依赖用户环境)
  - _Requirements: 6.3, 13.4_
  - _Depends: 3.1_

- [ ] 9. 面⑤ 云上降级标注与阶段3 接口预留
- [ ] 9.1 [cloud] 云上第三方 slots 降级如实标注 + 阶段3 接口约束记录
  - 云上带 entry/含 slots 的第三方 webext 保持隔离门拒绝下发(webextNeedsIsolationLane),会话降级无感;字节托管链路(registryDistDeps + /api/webext/dist)保持就位;文档/parity 如实标注 MVP 缺口;记录阶段3 iframe 车道接口约束(独立 origin + postMessage + scoped token,panel 级优先)
  - 完成态:降级行为验证 + parity/docs 标注更新;阶段3 约束落文档
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

## Implementation Notes

- **面⑤ 路线 B(5B.*)不在本 spec**:云上 iframe 隔离车道(独立 origin + postMessage RPC + scoped token,承载第三方代码/组件槽)属 pi-clouds 阶段3,依赖本 spec 6.1 的 dist entry 产出 + baked-source 字节托管,由 pi-clouds 侧另立 spec(拍板 Q1)。本 spec 任务 9.1 只记录接口预留与 panel 级优先约束(拍板 Q3),不含实现。
- **面⑦ 与面⑤ 咬合点**:面⑦ 动态控件 widget(settingsWidgets)本质是第三方 webext 组件,任务 7.1 依赖 6.2(面⑤ 路线 A);但面⑦ 静态字段(M1)完全不依赖面⑤,可独立先行并在本地 + 云上两端工作。
- **装配期注入必须真实子进程集成测试**(3.1):stub 抓不到装配期注入类回归,与 state-injection-bridge 同教训。
- **端点不开顶层段**(2.2):挂既有 config 段,避免「可声明但静默 404」的挂载缺口(module-design §11 记的 agent-sources 404 坑)。
- **改装配注入路由后须重启 dev**(3.1):`lib/app/pi-handler.ts` handler 单例。
- **依赖上游/云侧**:8.x/9.x `[cloud]`/`[npm]` 需 pi-web 侧端点/类型定稿并发 npm 版后由 pi-clouds 升版接线;真机 e2e 依赖用户环境。
- **`RequestContext` 不透出通用 `:param`**(2.2):Router(`http/router.ts`)虽支持 `:param` 段匹配,但 `handler.types.ts` 的 `RequestContext` 只透出 `:id`→`sessionId`,其余动态段一律要从 `ctx.url.pathname` 手写解析(`agent-route-routes.ts` 的 `routeNameFromPath` 与本任务的 `extractSourceKeyFromPath` 同一手法)——后续任何新增 `/xxx/:param/...` 端点都会撞到同一限制,除非先改 Router 本体(design.md 若写了「直接用 ctx.params」之类的路径,均需先核实这一点)。
- **根级 `tsc -p tsconfig.json --noEmit` 会牵连并发任务**:仓库根 typecheck 把 `packages/agent-kit`/`packages/server/src/runner` 等其他任务的未提交改动一并编译进来;若同会话有其他 exec 在跑 runner/agent-kit 相关任务,根级 typecheck 报错未必是本任务引入的——应先用 `git status` 确认报错文件是否在自己改动范围内,再按包(`packages/<pkg> && npx tsc -p tsconfig.json --noEmit`)分别复验。
- **`e2e/node/**` 用独立 vitest 项目**:根 `vitest.config.ts` 不含 `e2e/node/**`,须显式 `--config vitest.node-e2e.config.ts` 才能跑到;`vitest run` 默认配置下会报 "No test files found"。
- **`e2e/node` 全量偶发跨文件失败,与被测改动无关**:`attachment-completion`/`config-domains`(扩展互映)/`webext-build-load`(layout 断言)三个文件在全量跑时偶发失败,单独/子集重跑仍失败且与本任务改动的文件无关(挪走本任务新增的 e2e 文件后复现依旧),疑似全局单例 handler 跨文件状态污染或既有 fixture 时序问题——遇到同类"改动不相关文件却全量测试失败"时,先隔离复现（去掉自己新增的文件重跑一次)判断是否为已存在的基线不稳定,不要盲目为此改动自己的代码。
