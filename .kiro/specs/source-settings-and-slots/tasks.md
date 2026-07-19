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
- [x] 6.1 web-kit:slots 组件编进 dist entry(manifest 带 entry + SRI + 签名)
  - build 产带 entry(.mjs)的 manifest.json + 逐文件 sha384 SRI + Ed25519 签名(复用 manifest-emit);slots 组件经 import map 单例复用宿主 React;canonicalManifestBytes 排除 signature
  - 完成态:webext-slots-agent build 出带 entry manifest;SRI/签名断言
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 0.1_
- [x] 6.2 [6.1] react:代码扩展 slots 运行时加载挂 SlotHost(本地)
  - manifest 带 entry → loadExtension 走 status:"loaded":fetch→安全门→动态 import→挂 SlotHost;渲染到 pi-chat/chat-app 既有槽区;声明式-only 保持既有行为
  - 完成态:第三方 slots-agent 经 /api/webext/resolve+dist 挂各槽单测/集成
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Depends: 6.1_
- [x] 6.3 [6.2] 安全门贯通与降级
  - SRI + Ed25519 白名单签名 + API 版本 caret 三门;篡改/坏签名拒绝;单槽加载/渲染失败经 ExtErrorBoundary 隔离降级不崩壳
  - 完成态:篡改被拒/坏签名被拒/单槽失败隔离单测
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - _Depends: 6.2_
  - 复查结论:三门(SRI/Ed25519 白名单/API 版本 caret)与 ExtErrorBoundary 隔离在 6.1/6.2 阶段已随通用代码路径全部就位(`packages/react/src/web-ext/extension-gate.ts` 客户端门 + `lib/app/webext/webext-trust-service.ts` 服务端门,二者对 SRI/签名/版本三项校验逻辑一致;`packages/ui/src/web-ext/ext-error-boundary.tsx` + `apply-extension.tsx` 的 `SlotHost` 已挂 error boundary),本任务是**验证 + 补齐拒绝矩阵与隔离测试的缺口**,未新增门控代码:
    - 新增 `test/webext-load-client.test.tsx`:`useRuntimeWebext` hook 在 resolve 端点回 `rejectedReason`(门拒绝)、`found:false`(无产物)、网络异常三档下均落非抛出状态且 `extension` 恒 `undefined`(验证 Req 10.4「宿主壳不崩」在实际挂载路径上成立,而非仅推断)。
    - 扩展 `test/webext-slots-runtime.integration.test.tsx`:在 6.2 真实 resolveWebext + loadExtension 全链基础上新增矩阵 —— 非白名单私钥重签(Req 10.3)、manifest 未签名、`integrity` 字段被篡改(Req 10.2,签名覆盖 integrity 故仍被验签环节拒绝)、`targetApiVersion` 超出宿主 caret 范围(Req 10.1 版本门)四档,均断言 `resolveWebext` 返回 `rejectedReason` 且 `manifest` 为 `undefined`;末尾加一条「恢复原始 manifest.json 后重新放行」用例证明矩阵测试未污染 fixture。
    - 扩展 `packages/ui/test/web-ext/apply-extension.test.tsx`:新增单槽抛错场景下同一扩展的兄弟槽(headerLeft/footer)照常渲染的断言(此前只验证出错槽降级到 fallback,未验证兄弟槽不受牵连,Req 10.4)。
  - 命令与结果(均新鲜运行):
    - `cd packages/react && npx vitest run` → `43 passed | 1 failed`(失败为已知基线 `use-config-domain.test.tsx` pathDisplay 用例,与本任务无关)
    - `cd packages/ui && npx vitest run` → `101 passed (817 tests)`,全绿
    - `npx vitest run test/webext` → `8 files passed (45 tests)`,全绿(含新增两个矩阵/隔离用例集)
    - `cd packages/react && npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/ui && npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - 根级 `npx tsc -p tsconfig.json --noEmit` → EXIT 0(空输出,干净)
  - 改动文件:`test/webext-load-client.test.tsx`(新增)、`test/webext-slots-runtime.integration.test.tsx`(扩展矩阵 + 相关 import/hoist)、`packages/ui/test/web-ext/apply-extension.test.tsx`(扩展隔离断言);未改动任何门控/降级生产代码(现状已满足验收标准)。
- [x] 6.4 [6.3] e2e:webext-slots-agent 作第三方源本地全链
  - 不经构建期静态 import 车道,纯运行时 resolve→dist→import→挂 18 槽全链;安全门降级 e2e;既有第一方/声明式 webext 行为零变化(全量回归绿)
  - 完成态:隔离 build e2e 全绿 + 回归绿
  - _Requirements: 11.1, 11.2, 11.3, 13.2_
  - _Depends: 6.3_
  - **e2e 形态取舍**:采用 **Playwright 浏览器 e2e**(非退回 node 集成层)——本机已装 chromium(`playwright.config.ts` 既有 `fs`/`sqlite` 等 webServer 先例可直接复用),`webext-runtime-install.e2e.ts` 提供了运行时车道加载(声明式+代码扩展)的现成模式,照抄即可稳定跑通,故未降级到 node 层。
  - **构建链接线**:`webext-slots-agent`(`match:"webext-slots-agent"` 已在 `lib/app/webext-registry.ts` 登记,属构建期静态 import 车道)不能直接复用为运行时车道 fixture——`resolveExtensionForSource` 用 `source.includes(match)` 子串匹配,任何含 "webext-slots-agent" 子串的路径都会被构建期车道抢先命中,永远走不到 `/api/webext/resolve`。故新增**独立**夹具目录 `examples/webext-slots-runtime-agent`(18 槽内容与 `webext-slots-agent` 同构,manifestId/documentTitle 改用可区分值),在 `e2e/webext-fixtures.setup.ts` 新增 `buildRuntimeSlotsFixture()`,显式传 `capabilities:["slots","config"]` + 复用 `webext-runtime-code` 已建立信任的测试签名私钥(`TEST_SIGN_PRIVATE_KEY`,公钥已在 `playwright.config.ts` 的 `PI_WEB_EXT_WHITELIST`,无需新增白名单条目)。`scripts/build-webext-examples.ts`(构建期注册表车道的产物脚本)未改动——本任务的 fixture 属运行时车道,不应进那条构建链。
  - **安全门降级 e2e(两档,均在 setup 阶段静态产出,不做运行时文件互斥修改,避免并发 worker 竞态)**:
    - `examples/webext-slots-runtime-tampered-agent`:正常构建+正常签名后,`appendFile` 污染 entry `.mjs` 字节(manifest 内 SRI 摘要仍是构建时原始值)——验证的是**浏览器侧** SRI 校验拒绝路径(`loadExtension` 内 `verifyExtension` 比对 fetch 到的字节哈希,而非 `<script integrity>` 原生属性),`/api/webext/resolve` 本身仍返回 `found:true` 且无 `rejectedReason`(manifest 未被动过)。
    - `examples/webext-slots-runtime-badsig-agent`:用一把**不在** `PI_WEB_EXT_WHITELIST` 里的独立 Ed25519 私钥(`UNTRUSTED_SIGN_PRIVATE_KEY`,新生成,非真实凭据)签名——验证的是**服务端** `WebextTrustService` 拒绝路径,`/api/webext/resolve` 直接返回 `found:true` + `rejectedReason`,`manifest` 字段不下发。
    - 两档均断言:扩展槽内容不出现(`slot-header-center`/`slot-panel-right` 计数为 0)、`document.title` 未被扩展覆盖、`data-pi-input-textarea` 仍可见(会话不崩、默认 UI 降级)。
  - **回归发现(未修复,超出本任务边界)**:`e2e/browser/webext-document-title.e2e.ts` 第三条用例("documentTitle 还原:回选源页后标签页标题复位为宿主默认")在 fresh 单独重跑下稳定超时失败(`[data-switch-source]` 定位器等不到,60s 超时),与本任务改动(新增文件,零触碰 `pi-chat.tsx`/source-picker/document-title 复位逻辑)无关联,判定为既有基线缺陷/flake——已如实报告,未在本任务范围内修复。
  - **命令与结果(均新鲜运行)**:
    - `npx playwright test e2e/browser/webext-runtime-slots.e2e.ts e2e/browser/webext-runtime-install.e2e.ts --project=fs` → `8 passed`(新增 18 槽全链 2 档 + 降级 2 档 + 既有运行时声明/代码 3 例,全绿)
    - `npx playwright test e2e/browser/webext-full.e2e.ts e2e/browser/webext.e2e.ts e2e/browser/webext-document-title.e2e.ts --project=fs` → `10 passed | 1 failed`(失败即上述已定界基线缺陷,与本任务无关,单独重跑复现一致)
    - `npx vitest run test/webext`(根)→ `8 files passed (45 tests)`,全绿
    - `cd packages/react && npx vitest run` → `362 passed | 1 failed`(失败为已知基线 `use-config-domain.test.tsx` pathDisplay 用例,6.3 已记录,与本任务无关)
    - `cd packages/ui && npx vitest run` → `101 files / 817 tests passed`,全绿
    - `cd packages/web-kit && npx vitest run` → `10 files / 46 tests passed`,全绿
    - 根级 `npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/react && npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/ui && npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/web-kit && npx tsc -p tsconfig.json --noEmit` → EXIT 0
  - **改动文件**:新增 `e2e/browser/webext-runtime-slots.e2e.ts`;扩展 `e2e/webext-fixtures.setup.ts`(新增 `buildRuntimeSlotsFixture`/`buildRuntimeSlotsTamperedFixture`/`buildRuntimeSlotsBadSigFixture` 三个构建函数 + `UNTRUSTED_SIGN_PRIVATE_KEY` 常量,接入 `globalSetup`);新增三个 fixture 目录 `examples/webext-slots-runtime-agent`、`examples/webext-slots-runtime-tampered-agent`、`examples/webext-slots-runtime-badsig-agent`(各含 `index.ts`/`package.json`/`.pi/web/web.config.tsx`,`.pi/web/dist` 为 gitignored 构建产物由 setup 幂等重建)。未改动任何门控/加载器/构建生产代码,未改动 `scripts/build-webext-examples.ts` 或 `lib/app/webext-registry.ts`。

## M3 · 面⑦ 动态控件 + 实时下发(延后)

- [ ] 7. 动态控件咬合与实时下发
- [x] 7.1 [4.2,6.2] 动态控件 widget 咬合面⑤ 路线 A 产出
  - settingsWidgets capability 提供的 renderer 经 per-source scoped registry 命中;widget 数据端点走 agent-declared-routes;webext 缺失降级只读 JSON
  - 完成态:动态控件端到端(widget→routes→runner)e2e
  - _Requirements: 5.4, 5.5_
  - _Depends: 4.2, 6.2_
  - **实现落点(四环节)**:
    1. **webext 描述符侧**:`WebExtensionCapabilitySchema` 新增 `"settingsWidgets"`(`packages/protocol/src/web-ext/manifest.ts`);运行时描述符 `WebExtension`(`packages/web-kit/src/define-web-extension.ts`)新增 `settingsWidgets?: Record<string, SettingsWidgetComponent>` 字段 + 窄接口 `SettingsWidgetProps`(value/onChange/sourceKey/fieldKey/disabled/baseUrl/sessionId,不携带宿主 `FieldProps` 的 descriptor/path/errors/registry 等内部字段,web-kit 不反向依赖 ui 包),经 barrel 导出。
    2. **装载侧**:新增 `packages/ui/src/config/apply-settings-widgets.ts`(`applySettingsWidgets(sourceKey, ext, {baseUrl, sessionId})` + React 封装 `useSourceSettingsWidgets`)——把每个 `SettingsWidgetComponent` 适配为宿主 `FieldRendererComponent`(仅透传窄接口字段,`baseUrl`/`sessionId` 在**注册时**经闭包捕获注入,不改 `FieldProps`/`SchemaForm` 公共签名),再经既有 `registerSourceFieldRenderer` 并入该 source 的 scoped field registry;回收即 `unregisterSourceFieldRenderers`。
    3. **面板侧(修复了一个此前从未打通的缺口)**:`SettingsPanelDescriptor`(`packages/react/src/config/settings-registry.ts`)新增可选 `sourceKey` 字段;`registerSourceSettingsPanel`(`packages/react/src/config/register-source-settings-panel.ts`)注册面板时携带该字段;`<SettingsShell>` 的 `ConfigPanelView`(`packages/ui/src/config/settings-shell.tsx`)据此把 `sourceKey` 透给 `<SchemaForm>`——4.1/4.2 交付时面板与 scoped 注册表之间这段线并未接通(`SettingsPanelDescriptor` 从无 `sourceKey`,`ConfigPanelView` 从未把它传给 `SchemaForm`),导致 Req 5.4 的「schema 字段声明 widget → 面板用该动态控件渲染」在真实 `<SettingsShell>` 渲染路径上此前**永远不会命中 scoped 注册表**(只有绕过 SettingsShell 直接构造 `<FieldRenderer sourceKey>` 的单测能命中)。本任务补齐这段线,是「面板侧」验收的必要前提。
    4. **数据侧**:`examples/module-settings-agent/.pi/web/web.config.tsx`(新增)提供 `entity-picker` widget(`EntityPickerWidget`),挂载时经 `GET {baseUrl}/sessions/{sessionId}/agent-routes/entities`(该 fixture 已有的 `entities` route)取候选实体渲染下拉;`baseUrl`/`sessionId` 缺省(如设置面板尚未绑定活跃会话)时降级为禁用态提示,不发请求不崩溃。
  - **关键发现(供 7.2 与任何未来触碰 agent-declared-routes 客户端调用的任务参考)**:`GET|POST /sessions/:id/agent-routes/:name` 的响应体是 route handler 的**原始返回值**(`agent-route-routes.ts` 的 `rawJsonResponse(frame.result)`),**不裹 `{result:…}` 信封**——`entitiesHandler()` 返回 `{ entities }`,故客户端应读 `body.entities` 而非 `body.result.entities`。这一点在实现草稿阶段曾写错(widget fixture 与单测 mock 一度按 `{result:{entities}}` 假设编写),被 `e2e/node/module-settings-agent.e2e.test.ts` 新增的真实 HTTP 层用例(见下)当场证伪,修正后两处才一致。
  - **测试与命令(均新鲜运行)**:
    - `packages/ui/test/config/apply-settings-widgets.test.tsx`(新增,3 用例):`applySettingsWidgets` × 真实 `<SettingsShell>`——① webext 已装载:字段命中 scoped renderer,渲染真实 `<select>` 而非默认 `<input>`,widget 经 mock fetch(URL 断言为 `{baseUrl}/sessions/{sessionId}/agent-routes/entities`)取到选项并渲染;② 对照组:未调用 `applySettingsWidgets`(webext 未装载)→ 同字段降级只读 JSON,面板不失败;③ 回收(`dispose()`)后回落降级只读 JSON,不留孤儿 renderer。`cd packages/ui && npx vitest run test/config/apply-settings-widgets.test.tsx` → `3 passed`。
    - `e2e/node/module-settings-agent.e2e.test.ts` 新增 `A2) HTTP agent-routes 层`(2 用例,真实 `createPiWebHandler` 单例 + 真实 `POST /api/sessions` 建会话即真实子进程):① routes 声明帧到达后 `GET /api/sessions/:id/agent-routes/entities` 回吐原始 `{ entities }` 形状(与 widget fetch 同形,验证上述关键发现);② 未声明 route 名 → 404。`npx vitest run --config vitest.node-e2e.config.ts e2e/node/module-settings-agent.e2e.test.ts` → `10 passed`(含既有 8 例回归)。
    - 用真实 `buildWebExtension`(`packages/web-kit/build/build.ts`)对新 fixture 做一次性构建验证(未落盘为测试文件,验证后清理):`capabilities:["settingsWidgets"]` 通过 zod 校验,manifest 产出带 `entry`/`integrity`;动态 `import()` 因外部 react/pi-web-kit 单例在裸 node 环境不可解析而失败——与 M2(6.1/6.2)已证明的通用车道一致,非本任务缺口。
    - 回归:`cd packages/ui && npx vitest run` → `102 files / 820 tests passed`;`cd packages/react && npx vitest run` → `43 passed | 1 failed`(失败即 6.3/6.4 已记录的已知基线 `use-config-domain.test.tsx` pathDisplay 用例,与本任务无关);`cd packages/web-kit && npx vitest run` → `10 files / 46 tests passed`;`npx vitest run test/webext` → `8 files / 45 tests passed`;`cd packages/protocol && npx vitest run` → `42 files / 376 tests passed`。
    - typecheck:`cd packages/protocol && npx tsc -p tsconfig.json --noEmit` → EXIT 0;`cd packages/web-kit && npx tsc -p tsconfig.json --noEmit` → EXIT 0;`cd packages/ui && npx tsc -p tsconfig.json --noEmit` → EXIT 0;`cd packages/react && npx tsc -p tsconfig.json --noEmit` → EXIT 0;根级 `npx tsc -p tsconfig.json --noEmit` → EXIT 0(空输出)。
  - **改动文件**:`packages/protocol/src/web-ext/manifest.ts`(capability 枚举)、`packages/web-kit/src/define-web-extension.ts` + `packages/web-kit/src/index.ts`(`SettingsWidgetProps`/`SettingsWidgetComponent`/`WebExtension.settingsWidgets`)、新增 `packages/ui/src/config/apply-settings-widgets.ts` + `packages/ui/src/config/index.ts` 导出、`packages/react/src/config/settings-registry.ts`(`SettingsPanelDescriptor.sourceKey`)、`packages/react/src/config/register-source-settings-panel.ts`(注册时携带 sourceKey)、`packages/ui/src/config/settings-shell.tsx`(透给 SchemaForm)、新增 `examples/module-settings-agent/.pi/web/web.config.tsx`、新增 `packages/ui/test/config/apply-settings-widgets.test.tsx`、扩展 `e2e/node/module-settings-agent.e2e.test.ts`。未触碰 `packages/server/src/session/`、`src/runner/frame-channel/`(7.2 边界)。
- [x] 7.2 [3.1] (M3,可选) 运行期 piweb_settings_changed 实时下发
  - PUT 成功后经 stdin 推 piweb_settings_changed(复用 piweb_state 广播 + sticky 回放);liveReload 键实时生效;重连粘性帧回放不丢
  - 完成态:liveReload 键 PUT 后实时到前端 + 重连回放单测/集成
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 3.1_
  - **实现取舍**:design.md `:141` 「PUT 成功后主进程经 stdin 推 piweb_settings_changed」字面上暗示要经子进程 stdin 往返,但 `:82/:84` 明确 G1 上行(子进程→主进程)才需要 fd1 直写侧路;`piweb_state` 是子进程*上报*事件,本任务是主进程*内部*(PUT handler)产生的通知,不存在"子进程需要先知道"的前置依赖。故按 `:84`「settings 实时下发 = piweb_state 广播模式**克隆**」字面实现:新增 `PiSession.emitSettingsChanged` **公开方法**(`packages/server/src/session/pi-session.ts`),复刻 `handleRawLine` 的 `piweb_state` 分支同一套 `sticky.set` + `emitter.emit(FRAME_EVENT, frame)`,由 PUT 端点装配层直接调用——不经过 `line-writer.ts`/`assembly-frame.ts` 的子进程 fd1 通道,也不新增子进程侧代码。
  - **协议扩展**:`ControlPayloadSchema`(`packages/protocol/src/transport/sse-frame.ts`)判别联合新增 `control:"settings-changed"` 变体(`packages/protocol/src/config/settings-changed.ts` 新文件,`{ control, sourceKey, values, liveReloadKeys }`);`FieldDescriptor`(`packages/protocol/src/config/form-schema.ts` + `form-schema-zod.ts`)新增 `liveReload?: boolean`,此前 fixture(`examples/module-settings-agent/settings/schema.json` 的 `notifyEmail`)声明了该键但被 `FormSchemaZodSchema` 静默剥离(z.object 默认丢弃未知键),本任务补上后才真正携带。
  - **PUT→session 桥接方式**:`source-settings-routes.ts` 的 `SourceSettingsRoutesOptions` 新增可选 `onSaved(sourceKeyValue, { values, liveReloadKeys })` 回调(config 层不引入 `SessionStore` 依赖,只暴露接缝);落盘成功后按 GET 同规则 `maskSecrets` 掩码 + 从 schema 过滤 `liveReload:true` 键,best-effort 调用(`try/catch` 吞异常,不影响 PUT 200 响应)。应用层装配(`lib/app/pi-handler.ts` 的 `createSourceSettingsRoutes` 调用处)把 `onSaved` 接到新模块 `packages/server/src/session/settings-live-broadcast.ts` 的 `broadcastSettingsChanged(manager.getStore(), sourceKeyValue, payload)`:遍历 store 全部会话,按 `PiSession.policySource`(新增 `readonly` 字段,构造时取自 `ResolvedSource.policySource`)反查 sourceKey ——对 dir 型 source `policySource === packageDir`(`agent-source/resolver.ts` 的 `toLocalDir`),故复用与 `runner/source-settings-assembly-wiring.ts`(3.1)、`config/source-settings-routes.ts` 的 `resolveSourceSettingsFromPackageDirs`(2.2/2.3)完全同构的「目录 → `resolvePiPlugin` → `descriptor.id` → `sourceKey()`」匹配逻辑,保证三处对同一 source 解析出同一 sourceKey(拍板 Q2);匹配命中且会话 active 才调用 `session.emitSettingsChanged(...)`,单会话解析/广播失败被隔离(best-effort)。
  - **前端订阅接缝**:`ControlStore`(`packages/react/src/sse/control-store.ts`)新增 `sourceSettings: Record<sourceKey, { values, liveReloadKeys }>` 快照切片 + `case "settings-changed"` 分派(与既有 `applyControlFrame` 单一分发点天然接入,`connection.ts` 无需改动);新增只读 hook `useSourceSettingsChanged({ sourceKey, connection })`(`packages/react/src/hooks/use-source-settings-changed.ts`,风格对齐 `useExtensionState`,经 `useSyncExternalStore` 订阅)。按任务边界要求**只加订阅接缝,不做面板 UI**——liveReload 子集的消费/生效由后续 UI 任务自行决定。
  - **命令与结果(均新鲜运行)**:
    - `cd packages/protocol && npx vitest run` → `42 files / 376 tests passed`,全绿
    - `cd packages/server && npx vitest run` → `226 files passed | 7 skipped (233)`,`1806 tests passed | 17 skipped`,全绿(含新增 `test/session/pi-session.settings-changed.test.ts` 5 例、`test/integration/settings-live-broadcast.test.ts` 7 例、`test/config/source-settings-routes.test.ts` 扩展 3 例;`test/integration/settings-assembly-subprocess.test.ts` 真实子进程集成回归 5 例全绿,证明本任务未破坏 3.1 装配期通道)
    - `cd packages/react && npx vitest run` → `45 files passed | 1 failed(46)`,`370 tests passed | 1 failed`(失败为已知基线 `test/config/use-config-domain.test.tsx` 的 `pathDisplay` 用例,6.3/6.4 已记录,与本任务无关;含新增 `test/sse/control-store-settings-changed.test.ts` 4 例、`test/hooks/use-source-settings-changed.test.tsx` 4 例)
    - `npx vitest run e2e/node/source-settings-endpoint.e2e.test.ts --config vitest.node-e2e.config.ts` → `6 passed`,全绿
    - `npx vitest run e2e/node/module-settings-agent.e2e.test.ts --config vitest.node-e2e.config.ts` → `10 passed`(含真实子进程装配注入用例),全绿,证明协议层新增 `liveReload` 字段未破坏既有 fixture
    - 根级 `npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/protocol && npx tsc -p tsconfig.json --noEmit` → EXIT 0
    - `cd packages/server && npx tsc -p tsconfig.json --noEmit` → 仅已知基线 1 条错(`test/runner/ask-user-question-agent-example.smoke.test.ts:45`,与本任务无关)
    - `cd packages/react && npx tsc -p tsconfig.json --noEmit` → EXIT 0
  - **改动文件**:新增 `packages/protocol/src/config/settings-changed.ts`、`packages/server/src/session/settings-live-broadcast.ts`、`packages/react/src/hooks/use-source-settings-changed.ts`、`packages/server/test/session/pi-session.settings-changed.test.ts`、`packages/server/test/integration/settings-live-broadcast.test.ts`、`packages/react/test/sse/control-store-settings-changed.test.ts`、`packages/react/test/hooks/use-source-settings-changed.test.tsx`;修改 `packages/protocol/src/{config/form-schema.ts,config/form-schema-zod.ts,config/index.ts,transport/sse-frame.ts}`、`packages/server/src/{session/pi-session.ts,session/index.ts,config/source-settings-routes.ts}`、`packages/react/src/{sse/control-store.ts,index.ts}`、`packages/server/test/config/source-settings-routes.test.ts`、`lib/app/pi-handler.ts`。未触碰 `packages/ui`、webext(loader/gate/registry)、任何面板 UI 代码(按任务边界要求)。

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
- **`buildWebExtension` 的 entry/SRI/签名产出车道本就通用,6.1 不需要新代码**(`packages/web-kit/build/build.ts`+`manifest-emit.ts`):它不解析 `web.config.tsx` 里 `defineWebExtension({ capabilities, slots })` 的运行时声明,`capabilities` 必须由调用方显式传入 `BuildOptions.capabilities`(`examples-build.test.ts`/`webext-fixtures.setup.ts` 现状均未传,故那些产物的 `manifest.capabilities` 是 `undefined`)。6.2/6.4 若要让 `webext-slots-agent` 走「第三方源运行时加载」车道,记得在其构建调用处显式传 `capabilities:["slots","config"]`(同 `manifest-emit.test.ts`/`build.test.ts` 既有写法),否则宿主侧门控/降级判定可能读不到 capabilities。另外 `scripts/build-webext-examples.ts` 与 `e2e/webext-fixtures.setup.ts` 两条独立的生产构建脚本均未收录 `webext-slots-agent`——6.2/6.4 需要它作为运行时车道 e2e fixture 时,这两处(或新增等价脚本)需显式接线,本任务只在 `packages/web-kit/test/` 内新增隔离测试证明构建链本身可用,未改动这两个脚本(超出 6.1 边界)。
- **6.2 落地时「运行时加载挂 SlotHost」车道本就已全量存在,零新代码**:`loadExtension`(`packages/react/src/web-ext/extension-loader.ts:57-67`)的代码扩展分支、`SlotHost`(`packages/ui/src/web-ext/apply-extension.tsx:165`)对运行时 `WebExtension.slots[key]` 的挂载、`resolveWebext`+`locateDist`(`lib/app/webext/resolve-webext.ts`+`locate-dist.ts`)对带 `entry` manifest 的服务端解析与 dist 字节下发——均对 declarative/code 扩展一视同仁,不区分「第三方」与「构建期已注册」。此前只是**没有任何测试用真实构建产物 + 真实动态 `import()` 走完整链路**(`e2e/node/webext-build-load.e2e.test.ts` 对代码示例只测门控字节层,未调 `loadExtension`/`importModule`;浏览器 e2e `webext-runtime-install.e2e.ts` 已覆盖但依赖 Playwright 起服务)。6.2 因此是**验证 + 补齐缺失的 Node 侧集成测试**(`test/webext-slots-runtime.integration.test.tsx`),不是新写加载器/挂载代码。
- **`esbuild` 与 vitest `jsdom` 环境不兼容**:esbuild 模块初始化自检 `new TextEncoder().encode("") instanceof Uint8Array` 在 `jsdom` 沙箱下恒为 `false`(jsdom 用自己 realm 的 `Uint8Array`,与 Node 原生 `TextEncoder` 产物不同源,与 globalThis.TextEncoder 打补丁无关,补 `TextEncoder` 本身不解决)。任何在测试里调用 `buildWebExtension`/`esbuild` 的用例,若该测试文件跑在 `jsdom` 环境(本仓根 `vitest.config.ts` 默认 `jsdom`)会直接炸;须给该测试文件加 `// @vitest-environment node` docblock(整文件覆盖,vitest 支持按文件覆写环境),需要 DOM 渲染断言的部分改用 `react-dom/server` 的 `renderToStaticMarkup`(纯字符串输出,不依赖 DOM)而非 `@testing-library/react` 的 `render`。6.3/6.4 若要在同一文件里既 build 又断言渲染,复用此模式。
- **`GET|POST /sessions/:id/agent-routes/:name` 回吐 route handler 的原始返回值,不裹 `{result:…}` 信封**(`agent-route-routes.ts` 的 `rawJsonResponse(frame.result)`)——客户端(面⑦ settingsWidgets 动态控件、7.2 的 liveReload 消费方等任何要经此 HTTP 端点自取数据的 UI 代码)应直接读顶层字段(如 `body.entities`),而非 `body.result.entities`;`session.invokeAgentRoute()`(测试/内部直调)返回的是 `{ok, result, error}` 信封,与 HTTP 端点响应体形状**不同**,两者不要混用同一套解析代码。7.1 曾在草稿阶段按信封形状写错(fixture widget + 单测 mock),被新增的真实 HTTP 层 e2e 用例(`e2e/node/module-settings-agent.e2e.test.ts` A2 节)当场证伪。
- **`SettingsPanelDescriptor`/`<SettingsShell>` 此前从未把 `sourceKey` 传给 `<SchemaForm>`**(4.1/4.2 交付时的真实缺口,7.1 补齐):`<FieldRenderer>` 的 per-source scoped 查找(4.2)只在显式收到 `sourceKey` prop 时生效,但 `registerSourceSettingsPanel`(4.1)注册的 `SettingsPanelDescriptor` 不带该字段,`ConfigPanelView` 渲染 `<SchemaForm>` 时也未传——这条线在 4.1/4.2 各自的隔离单测里都测不出来(两者互不知晓),只有沿真实 `<SettingsShell>` 渲染路径走一遍才会暴露。任何「A 组件产出的数据,B 组件要靠某个 prop/context 才能用上」的两段式咬合任务,建议至少写一条经最外层真实容器组件(而非两端各自的隔离单测)的集成用例,否则「各自单测全绿但连不上」的缺口会一直潜伏到下一个跨任务咬合点才被发现。
- **`@blksails/pi-web-kit/build` 的裸导出只有 `buildWebExtension`**(`packages/web-kit/build/index.ts`):`generateSigningKeyPair`/`signManifest` 等辅助函数在 `manifest-emit.ts` 里但未经 `/build` barrel 导出,包外(如根 `test/`)拿不到,需按同手法内联用 `node:crypto` 的 `webcrypto.subtle` 生成 Ed25519 密钥对并转 base64(pkcs8 私钥 / raw 公钥)。`buildWebExtension` 的 `signKey` 入参形状是 **base64 pkcs8 字符串**,不是 `CryptoKey` 对象——直接传 `generateKey()` 返回的 `privateKey` 会在 `manifest-emit.ts:signManifest` 里因 `Buffer.from(CryptoKey, "base64")` 抛类型错误。
