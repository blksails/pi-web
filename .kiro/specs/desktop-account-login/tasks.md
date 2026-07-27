# Implementation Plan — desktop-account-login

> 依据 `design.md`。执行顺序按分组;组内 `(P)` 可并行(改不同文件)。
> 铁律:`getSourcesGrant()` 的 fail-soft 语义**不得**改动(D3);identity 模块**不得**引入 pi SDK。

## 1. P5 契约层

- [ ] 1.1 定义 `IdentityProvider` 端口类型
  - 新建 `packages/server/src/identity/types.ts`:`IdentityState`(判别联合)、`IdentityPasswordCredentials`、`IdentityCredentials`、`IdentityExchangeFailure`、`IdentityExchangeResult`、`IdentityProvider`
  - `contractVersion` 钉成 `typeof HOST_CONTRACT_VERSION`(沿用 P2 写法)
  - `current()` / `exchange()` **均不抛**;`exchange` / `revoke` 为可选方法(D2)
  - 纯类型、零运行期依赖;只从 `../capability/types.js` 取 `CapabilityTenant`,**不得**引入 pi SDK
  - 完成条件:`packages/server/src/identity/index.ts` barrel 建立,`tsc` 通过
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: packages/server/src/identity/_

- [ ] 1.2 类型层机械保证的编译期测 (P)
  - 新建 `packages/server/test/identity/types.test-d.ts`
  - 钉住:`{kind:"authenticated"}` 缺 `tenant` **编译不过**;`{kind:"anonymous", tenant:…}` 编译不过
  - 钉住:不提供 `exchange` 的实现可赋值给 `IdentityProvider`(Req 1.4 的类型证明)
  - 钉住:`contractVersion: 2` 编译不过
  - _Requirements: 1.2, 1.4_
  - _Depends: 1.1_

## 2. 服务端能力授予扩写

- [ ] 2.1 `DesktopCapabilitiesClient` 增 `loadStatic()`
  - 改 `packages/server/src/auth/desktop-capabilities-client.ts`
  - 新增 `loadStatic(): Promise<StaticCapabilitySnapshot>` —— 解析 `tenant`/`egress`/`sources` 三字段;逐项解析失败**只**使该字段缺失(Req 4.3)
  - HTTP 层失败(网络异常 / 非 2xx / JSON 损坏 / 无凭据)→ **抛**(Req 4.2,契约 §4.2.3)
  - `getSourcesGrant()` 改为复用 `loadStatic()` 并 `catch` 后返回 `undefined` —— **语义必须完全不变**,既有测试须全绿
  - 在 `getSourcesGrant()` 上写明纪律注释:为何它必须继续吞异常
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: packages/server/src/auth/desktop-capabilities-client.ts_

- [ ] 2.2 `loadStatic` / `getSourcesGrant` 双语义单测
  - 新建 `packages/server/test/auth/capabilities-load-static.test.ts`
  - 三字段解析、单项缺失不影响其他项、`expiresAt` 缺失时的默认
  - **同一失败注入**下:`loadStatic()` 抛 且 `getSourcesGrant()` 返回 `undefined`(D3 并存的核心断言)
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 2.1_

- [ ] 2.3 云端登录 URL 推导 (P)
  - 在 `desktop-capabilities-client.ts` 增 `deriveLoginUrlFromEgressBase(egressBase)`,规则同 `deriveCapabilitiesUrlFromEgressBase`(`…/api/desktop/egress[/vN]` → `…/api/desktop/login`)
  - 无法识别 → `undefined`;不新增任何配置项(设计约束)
  - 单测覆盖:带 `/v1`、不带、尾斜杠、非法输入
  - _Requirements: 2.1_

## 3. 云端登录客户端

- [ ] 3.1 `CloudLoginClient`
  - 新建 `packages/server/src/auth/cloud-login-client.ts`
  - `POST {loginUrl} {email,password}`;超时 **15s**(交互式,**不**复用 90s 的 egress 下限)
  - 状态映射:401/403→`invalid-credentials`;400→`invalid-request`;网络异常/超时/非 2xx/响应缺 `credential`→`cloud-unreachable`
  - **禁止**把 `password` 或响应体传入 logger 任何参数(Req 8.1)
  - `fetchImpl` / `now` 可注入(沿用 `DesktopCapabilitiesClient` 的可测形态)
  - _Requirements: 2.1, 2.3, 2.4, 8.1_
  - _Boundary: packages/server/src/auth/cloud-login-client.ts_

- [ ] 3.2 `CloudLoginClient` 单测
  - 新建 `packages/server/test/auth/cloud-login-client.test.ts`
  - 全部状态映射分支;超时;响应缺 `credential`
  - **断言 logger 未收到密码**:注入 logger 探针,检查所有调用参数序列化后不含密码串(Req 8.1)
  - _Requirements: 2.3, 2.4, 8.1_
  - _Depends: 3.1_

## 4. 身份实现

- [ ] 4.1 `DesktopPasswordIdentityProvider`
  - 新建 `packages/server/src/identity/desktop-password-identity-provider.ts`
  - `current()`:`AuthSessionState.isValid()` 为假 → `anonymous`;为真 → 用进程内缓存的 `tenant` 产出 `authenticated`
  - `exchange()` **顺序不可换**:登录 → `loadStatic()` → `AuthSessionState.set()`。`loadStatic()` 抛时返回 `{ok:false,reason:"capabilities-failed"}` 且**不写入**登录态
  - `revoke()`:`AuthSessionState.clear()` + `capabilitiesClient.clearCache()` + 清 `tenant` 缓存(三者缺一即残留)
  - 切号:`exchange()` 成功即整体替换凭据 + `tenant` + 清授予缓存(Req 7.2)
  - _Requirements: 2.1, 2.6, 4.1, 4.2, 5.1, 7.1, 7.2_
  - _Boundary: packages/server/src/identity/desktop-password-identity-provider.ts_
  - _Depends: 1.1, 2.1, 3.1_

- [ ] 4.2 `SessionIdentityProvider` (P)
  - 新建 `packages/server/src/identity/session-identity-provider.ts`
  - **只**实现 `current()`,不实现 `exchange` —— 它是 P5 支持「不支持交换」这条路径的活证明
  - 身份由注入的 `resolveTenant()` 产出;该回调抛错或返回 `undefined` → `anonymous`,**不上抛**(Req 1.6)
  - _Requirements: 1.2, 1.4, 6.1, 6.2, 6.3_
  - _Boundary: packages/server/src/identity/session-identity-provider.ts_
  - _Depends: 1.1_

- [ ] 4.3 两个实现的单测
  - 新建 `packages/server/test/identity/desktop-password-identity-provider.test.ts` 与 `session-identity-provider.test.ts`
  - 核心断言:`loadStatic` 抛 → `AuthSessionState.set` **未被调用**,`current()` 仍 `anonymous`(Req 4.2 的行为证明)
  - `revoke()` 后凭据与授予缓存**同时**为空;切号后不含前一账号的 token(Req 7.2)
  - `SessionIdentityProvider`:`resolveTenant` 抛 → `anonymous` 而非上抛
  - _Requirements: 1.2, 1.6, 4.2, 6.2, 7.1, 7.2_
  - _Depends: 4.1, 4.2_

## 5. HTTP 面

- [ ] 5.1 `identity-routes`
  - 新建 `packages/server/src/identity/identity-routes.ts`
  - `GET /identity` → `IdentityView`;`POST /identity/exchange` → 交换;`DELETE /identity` → revoke
  - `canExchange` **派生**自 `typeof provider.exchange === "function"`,实现不得自行声明(D2)
  - 失败映射:`invalid-request`→400 · `invalid-credentials`→401 · `cloud-unreachable`→502 · `capabilities-failed`→502
  - 不支持 `revoke` 的实现 → `DELETE` 返回 405
  - 入参校验:`email`/`password` 缺失或空 → 400 `invalid-request`
  - 响应体**永不**含 credential / password / token
  - _Requirements: 1.3, 1.4, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 7.1, 8.2_
  - _Boundary: packages/server/src/identity/identity-routes.ts_
  - _Depends: 1.1_

- [ ] 5.2 路由集成测
  - 新建 `packages/server/test/identity/identity-routes.test.ts`
  - `canExchange` 在两个实现下分别为 `true`/`false`(D2 派生正确性)
  - 四种失败 → 四种状态码;响应体不含敏感字段(逐字段扫描,Req 8.2)
  - `DELETE` 在无 `revoke` 实现下 405
  - _Requirements: 1.3, 1.4, 2.2, 2.3, 2.4, 8.2_
  - _Depends: 5.1_

- [ ] 5.3 能力面挂载 + 主 barrel 导出
  - 改 `packages/server/src/host-assembly/default-capabilities.ts`:新增能力面 `identity.session`,条件挂载于 `HostDeps.identityProvider`(未配置 → 空路由集 → `GET /api/identity` 404,Req 2.5)
  - 改 `packages/server/src/index.ts`:导出 identity 类型与路由工厂
  - 同步更新 `packages/server/test/host-assembly/default-capabilities.test.ts` 的能力面 id 清单断言
  - ★ 主 barrel 须保持 **pi-SDK-free**;新增导出后跑既有 barrel 纪律测确认未破
  - _Requirements: 2.5_
  - _Depends: 5.1_

## 6. 装配

- [ ] 6.1 egress 授予优先于 env 配置
  - 改 `lib/app/auth-egress-assembly.ts`:新增 `computeEgressSpawnEnvFromGrant(config, credential, grant?)`
  - 有 `egress` 授予 → 用授予的 `baseUrl`/`models`;无授予 → **完全退回**既有 `computeAuthEgressSpawnEnv` 行为(不得回归 `desktop-cloud-login`)
  - 单测覆盖两条路径 + 既有测试全绿
  - _Requirements: 4.5_
  - _Boundary: lib/app/auth-egress-assembly.ts_

- [ ] 6.2 `pi-handler` 接线
  - 改 `lib/app/pi-handler.ts`:装配 `CloudLoginClient`(URL 由 `deriveLoginUrlFromEgressBase(cloudLoginConfig.egressBaseUrl)` 得)+ `DesktopPasswordIdentityProvider`,注入 `hostDeps.identityProvider`
  - ★ 必须用 `cloudLoginConfig.egressBaseUrl` 而非 `process.env` —— 打包桌面版里 env 为空,配置来自 `<agentDir>/cloud.json`(此坑已由 `desktop-cloud-login` Req 8.3 实测记录)
  - 会话 spawn env 改走 6.1 的新函数
  - 未配置云端 → `identityProvider` 为 `undefined` → 能力面不挂载,链路与本特性引入前完全一致
  - _Requirements: 2.5, 2.6, 4.4, 4.5_
  - _Depends: 4.1, 5.3, 6.1_

## 7. 前端

- [ ] 7.1 `useIdentity` 状态投影
  - 新建 `components/auth/use-identity.tsx`:`IdentityStateProvider` + `useIdentity` + `identityListKey`
  - 四态 `disabled`(GET 404)/`loading`/`authenticated`/`anonymous`;**只**据 `kind` 与 `canExchange` 分支,不读任何宿主标识(Req 1.5)
  - `exchange(email,password)` / `revoke()` / `refresh()`;登录成功后经桌面壳桥持久化钥匙串(沿用既有 `storeCredential`)
  - _Requirements: 1.5, 1.6, 5.1, 5.2, 5.3, 7.1_
  - _Boundary: components/auth/use-identity.tsx_
  - _Depends: 5.1_

- [ ] 7.2 `LoginForm` 账号密码表单
  - 新建 `components/auth/login-form.tsx`:邮箱 + 掩码密码
  - 任一为空 → 禁用提交并提示必填(Req 3.2);提交中 → 禁用 + 进行中态;取消 → 清空两字段且**不发请求**(Req 3.3)
  - 失败文案按 `reason` 区分:`invalid-credentials`→「账号或密码错误」、`cloud-unreachable`→「无法连接云端,请重试」
  - 密码只存在于组件 state 与请求体;提交后立即清空
  - _Requirements: 3.1, 3.2, 3.3, 2.2, 2.3, 2.4_
  - _Boundary: components/auth/login-form.tsx_
  - _Depends: 7.1_

- [ ] 7.3 `LoginControl` 改用身份态 + 身份展示
  - 改 `components/auth/login-control.tsx`:`disabled` → 不渲染;`anonymous && canExchange` → `LoginForm`;`authenticated` → 展示 `tenant.userId`(+ `companyId`)+ 登出
  - 重新登录走**同一** `LoginForm`,不再要求粘贴凭据串(Req 3.5)
  - 粘贴凭据串降级为兜底入口(保留但非主路径,Req 3.4)
  - `tenant` 缺失 → 展示可得的最小身份信息,不空白不报错(Req 5.3)
  - 删除文件顶部关于「device 授权流」的过时注释
  - _Requirements: 3.4, 3.5, 5.1, 5.2, 5.3, 7.1_
  - _Depends: 7.1, 7.2_

- [ ] 7.4 消费方迁移 + 兼容 re-export
  - 改 `components/auth/use-desktop-auth.tsx` 为对 `use-identity` 的兼容 re-export(D5)
  - 改 `components/chat-app.tsx`:`DesktopAuthProvider`→`IdentityStateProvider`,`desktopAuthListIdentity`→`identityListKey`
  - 全仓 grep 确认无遗留直接消费方
  - _Requirements: 1.5_
  - _Depends: 7.1_

- [ ] 7.5 前端单测
  - 新建 `test/auth/use-identity.test.tsx` 与 `test/auth/login-form.test.tsx`
  - `identityListKey` 在登录/登出/切号下取值互异(驱动 agent-sources 刷新)
  - 空字段禁止提交;取消不发请求(用 fetch 探针断言调用次数为 0)
  - 404 → `disabled` 且不渲染任何入口(Req 2.5)
  - _Requirements: 1.5, 2.2, 2.5, 3.2, 3.3_
  - _Depends: 7.1, 7.2, 7.3_

## 8. 契约文档

- [ ] 8.1 契约文档同步
  - 改 `docs/pi-web-host-contract-v1.md`:§2 端口总览新增 P5 行(「云端与桌面**均须**实现 `current()`;`exchange` 可选」);新增 P5 章节含接口、语义保证、两类宿主实现义务
  - 写明 v1 兼容性:纯新增,不改既有端口签名与语义(Req 9.2)
  - 更正「device 授权流」表述,改以实测确认的账号密码形态描述(Req 9.3)
  - _Requirements: 9.1, 9.2, 9.3_
  - _Boundary: docs/pi-web-host-contract-v1.md_

## 9. 验收

- [ ] 9.1 全面跑测 + 类型检查
  - 根 `pnpm test:app`、`packages/server`、`packages/protocol`、`packages/tool-kit` 各测面全绿
  - `pnpm typecheck` 通过
  - ★ 只跑根 vitest 会漏子包红,四个测面都要跑
  - _Requirements: 全部_
  - _Depends: 7.5, 8.1_

- [ ] 9.2 真机烟雾(打包态之外的 dev 态)
  - `pnpm dev:server` 起服务,确认 `GET /api/identity` 在配置/未配置云端两种情形下的返回
  - 用真实账号打 `POST /api/identity/exchange`,确认 200 + `tenant` 且线上源随即可枚举
  - ★ 单测全绿 + typecheck ≠ 能跑 —— 本仓已有三次「只有真机烟雾能发现」的记录(@/ 别名、跨仓 alias、error-map 落 500)
  - _Requirements: 2.1, 2.6, 4.4, 5.1_
  - _Depends: 9.1_
