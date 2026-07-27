# Implementation Plan — desktop-account-login

> 依据 `design.md`。执行顺序按分组;组内 `(P)` 可并行(改不同文件)。
> 铁律:`getSourcesGrant()` 的 fail-soft 语义**不得**改动(D3);identity 模块**不得**引入 pi SDK。

## 1. P5 契约层

- [x] 1.1 定义 `IdentityProvider` 端口类型
  - 新建 `packages/server/src/identity/types.ts`:`IdentityState`(判别联合)、`IdentityPasswordCredentials`、`IdentityCredentials`、`IdentityExchangeFailure`、`IdentityExchangeResult`、`IdentityProvider`
  - `contractVersion` 钉成 `typeof HOST_CONTRACT_VERSION`(沿用 P2 写法)
  - `current()` / `exchange()` **均不抛**;`exchange` / `revoke` 为可选方法(D2)
  - 纯类型、零运行期依赖;只从 `../capability/types.js` 取 `CapabilityTenant`,**不得**引入 pi SDK
  - 完成条件:`packages/server/src/identity/index.ts` barrel 建立,`tsc` 通过
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: packages/server/src/identity/_

- [x] 1.2 类型层机械保证的编译期测 (P)
  - 新建 `packages/server/test/identity/types.test-d.ts`
  - 钉住:`{kind:"authenticated"}` 缺 `tenant` **编译不过**;`{kind:"anonymous", tenant:…}` 编译不过
  - 钉住:不提供 `exchange` 的实现可赋值给 `IdentityProvider`(Req 1.4 的类型证明)
  - 钉住:`contractVersion: 2` 编译不过
  - _Requirements: 1.2, 1.4_
  - _Depends: 1.1_

## 2. 服务端能力授予扩写

- [x] 2.1 `DesktopCapabilitiesClient` 增 `loadStatic()`
  - 改 `packages/server/src/auth/desktop-capabilities-client.ts`
  - 新增 `loadStatic(): Promise<StaticCapabilitySnapshot>` —— 解析 `tenant`/`egress`/`sources` 三字段;逐项解析失败**只**使该字段缺失(Req 4.3)
  - HTTP 层失败(网络异常 / 非 2xx / JSON 损坏 / 无凭据)→ **抛**(Req 4.2,契约 §4.2.3)
  - `getSourcesGrant()` 改为复用 `loadStatic()` 并 `catch` 后返回 `undefined` —— **语义必须完全不变**,既有测试须全绿
  - 在 `getSourcesGrant()` 上写明纪律注释:为何它必须继续吞异常
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: packages/server/src/auth/desktop-capabilities-client.ts_

- [x] 2.2 `loadStatic` / `getSourcesGrant` 双语义单测
  - 新建 `packages/server/test/auth/capabilities-load-static.test.ts`
  - 三字段解析、单项缺失不影响其他项、`expiresAt` 缺失时的默认
  - **同一失败注入**下:`loadStatic()` 抛 且 `getSourcesGrant()` 返回 `undefined`(D3 并存的核心断言)
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 2.1_

- [x] 2.3 云端登录 URL 推导 (P)
  - 在 `desktop-capabilities-client.ts` 增 `deriveLoginUrlFromEgressBase(egressBase)`,规则同 `deriveCapabilitiesUrlFromEgressBase`(`…/api/desktop/egress[/vN]` → `…/api/desktop/login`)
  - 无法识别 → `undefined`;不新增任何配置项(设计约束)
  - 单测覆盖:带 `/v1`、不带、尾斜杠、非法输入
  - _Requirements: 2.1_

## 3. 云端登录客户端

- [x] 3.1 `CloudLoginClient`
  - 新建 `packages/server/src/auth/cloud-login-client.ts`
  - `POST {loginUrl} {email,password}`;超时 **15s**(交互式,**不**复用 90s 的 egress 下限)
  - 状态映射:401/403→`invalid-credentials`;400→`invalid-request`;网络异常/超时/非 2xx/响应缺 `credential`→`cloud-unreachable`
  - **禁止**把 `password` 或响应体传入 logger 任何参数(Req 8.1)
  - `fetchImpl` / `now` 可注入(沿用 `DesktopCapabilitiesClient` 的可测形态)
  - _Requirements: 2.1, 2.3, 2.4, 8.1_
  - _Boundary: packages/server/src/auth/cloud-login-client.ts_

- [x] 3.2 `CloudLoginClient` 单测
  - 新建 `packages/server/test/auth/cloud-login-client.test.ts`
  - 全部状态映射分支;超时;响应缺 `credential`
  - **断言 logger 未收到密码**:注入 logger 探针,检查所有调用参数序列化后不含密码串(Req 8.1)
  - _Requirements: 2.3, 2.4, 8.1_
  - _Depends: 3.1_

## 4. 身份实现

- [x] 4.1 `DesktopPasswordIdentityProvider`
  - 新建 `packages/server/src/identity/desktop-password-identity-provider.ts`
  - `current()`:`AuthSessionState.isValid()` 为假 → `anonymous`;为真 → 用进程内缓存的 `tenant` 产出 `authenticated`
  - `exchange()` **顺序不可换**:登录 → `loadStatic()` → `AuthSessionState.set()`。`loadStatic()` 抛时返回 `{ok:false,reason:"capabilities-failed"}` 且**不写入**登录态
  - `revoke()`:`AuthSessionState.clear()` + `capabilitiesClient.clearCache()` + 清 `tenant` 缓存(三者缺一即残留)
  - 切号:`exchange()` 成功即整体替换凭据 + `tenant` + 清授予缓存(Req 7.2)
  - _Requirements: 2.1, 2.6, 4.1, 4.2, 5.1, 7.1, 7.2_
  - _Boundary: packages/server/src/identity/desktop-password-identity-provider.ts_
  - _Depends: 1.1, 2.1, 3.1_

- [x] 4.2 `SessionIdentityProvider` (P)
  - 新建 `packages/server/src/identity/session-identity-provider.ts`
  - **只**实现 `current()`,不实现 `exchange` —— 它是 P5 支持「不支持交换」这条路径的活证明
  - 身份由注入的 `resolveTenant()` 产出;该回调抛错或返回 `undefined` → `anonymous`,**不上抛**(Req 1.6)
  - _Requirements: 1.2, 1.4, 6.1, 6.2, 6.3_
  - _Boundary: packages/server/src/identity/session-identity-provider.ts_
  - _Depends: 1.1_

- [x] 4.3 两个实现的单测
  - 新建 `packages/server/test/identity/desktop-password-identity-provider.test.ts` 与 `session-identity-provider.test.ts`
  - 核心断言:`loadStatic` 抛 → `AuthSessionState.set` **未被调用**,`current()` 仍 `anonymous`(Req 4.2 的行为证明)
  - `revoke()` 后凭据与授予缓存**同时**为空;切号后不含前一账号的 token(Req 7.2)
  - `SessionIdentityProvider`:`resolveTenant` 抛 → `anonymous` 而非上抛
  - _Requirements: 1.2, 1.6, 4.2, 6.2, 7.1, 7.2_
  - _Depends: 4.1, 4.2_

## 5. HTTP 面

- [x] 5.1 `identity-routes`
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

- [x] 5.2 路由集成测
  - 新建 `packages/server/test/identity/identity-routes.test.ts`
  - `canExchange` 在两个实现下分别为 `true`/`false`(D2 派生正确性)
  - 四种失败 → 四种状态码;响应体不含敏感字段(逐字段扫描,Req 8.2)
  - `DELETE` 在无 `revoke` 实现下 405
  - _Requirements: 1.3, 1.4, 2.2, 2.3, 2.4, 8.2_
  - _Depends: 5.1_

- [x] 5.3 能力面挂载 + 主 barrel 导出
  - 改 `packages/server/src/host-assembly/default-capabilities.ts`:新增能力面 `identity.session`,条件挂载于 `HostDeps.identityProvider`(未配置 → 空路由集 → `GET /api/identity` 404,Req 2.5)
  - 改 `packages/server/src/index.ts`:导出 identity 类型与路由工厂
  - 同步更新 `packages/server/test/host-assembly/default-capabilities.test.ts` 的能力面 id 清单断言
  - ★ 主 barrel 须保持 **pi-SDK-free**;新增导出后跑既有 barrel 纪律测确认未破
  - _Requirements: 2.5_
  - _Depends: 5.1_

## 6. 装配

- [x] 6.1 egress 授予优先于 env 配置
  - 改 `lib/app/auth-egress-assembly.ts`:新增 `computeEgressSpawnEnvFromGrant(config, credential, grant?)`
  - 有 `egress` 授予 → 用授予的 `baseUrl`/`models`;无授予 → **完全退回**既有 `computeAuthEgressSpawnEnv` 行为(不得回归 `desktop-cloud-login`)
  - 单测覆盖两条路径 + 既有测试全绿
  - _Requirements: 4.5_
  - _Boundary: lib/app/auth-egress-assembly.ts_

- [x] 6.2 `pi-handler` 接线
  - 改 `lib/app/pi-handler.ts`:装配 `CloudLoginClient`(URL 由 `deriveLoginUrlFromEgressBase(cloudLoginConfig.egressBaseUrl)` 得)+ `DesktopPasswordIdentityProvider`,注入 `hostDeps.identityProvider`
  - ★ 必须用 `cloudLoginConfig.egressBaseUrl` 而非 `process.env` —— 打包桌面版里 env 为空,配置来自 `<agentDir>/cloud.json`(此坑已由 `desktop-cloud-login` Req 8.3 实测记录)
  - 会话 spawn env 改走 6.1 的新函数
  - 未配置云端 → `identityProvider` 为 `undefined` → 能力面不挂载,链路与本特性引入前完全一致
  - _Requirements: 2.5, 2.6, 4.4, 4.5_
  - _Depends: 4.1, 5.3, 6.1_

## 7. 前端

- [x] 7.1 `useIdentity` 状态投影
  - 新建 `components/auth/use-identity.tsx`:`IdentityStateProvider` + `useIdentity` + `identityListKey`
  - 四态 `disabled`(GET 404)/`loading`/`authenticated`/`anonymous`;**只**据 `kind` 与 `canExchange` 分支,不读任何宿主标识(Req 1.5)
  - `exchange(email,password)` / `revoke()` / `refresh()`;登录成功后经桌面壳桥持久化钥匙串(沿用既有 `storeCredential`)
  - _Requirements: 1.5, 1.6, 5.1, 5.2, 5.3, 7.1_
  - _Boundary: components/auth/use-identity.tsx_
  - _Depends: 5.1_

- [x] 7.2 `LoginForm` 账号密码表单
  - 新建 `components/auth/login-form.tsx`:邮箱 + 掩码密码
  - 任一为空 → 禁用提交并提示必填(Req 3.2);提交中 → 禁用 + 进行中态;取消 → 清空两字段且**不发请求**(Req 3.3)
  - 失败文案按 `reason` 区分:`invalid-credentials`→「账号或密码错误」、`cloud-unreachable`→「无法连接云端,请重试」
  - 密码只存在于组件 state 与请求体;提交后立即清空
  - _Requirements: 3.1, 3.2, 3.3, 2.2, 2.3, 2.4_
  - _Boundary: components/auth/login-form.tsx_
  - _Depends: 7.1_

- [x] 7.3 `LoginControl` 改用身份态 + 身份展示
  - 改 `components/auth/login-control.tsx`:`disabled` → 不渲染;`anonymous && canExchange` → `LoginForm`;`authenticated` → 展示 `tenant.userId`(+ `companyId`)+ 登出
  - 重新登录走**同一** `LoginForm`,不再要求粘贴凭据串(Req 3.5)
  - 粘贴凭据串降级为兜底入口(保留但非主路径,Req 3.4)
  - `tenant` 缺失 → 展示可得的最小身份信息,不空白不报错(Req 5.3)
  - 删除文件顶部关于「device 授权流」的过时注释
  - _Requirements: 3.4, 3.5, 5.1, 5.2, 5.3, 7.1_
  - _Depends: 7.1, 7.2_

- [x] 7.4 消费方迁移 + 兼容 re-export
  - 改 `components/auth/use-desktop-auth.tsx` 为对 `use-identity` 的兼容 re-export(D5)
  - 改 `components/chat-app.tsx`:`DesktopAuthProvider`→`IdentityStateProvider`,`desktopAuthListIdentity`→`identityListKey`
  - 全仓 grep 确认无遗留直接消费方
  - _Requirements: 1.5_
  - _Depends: 7.1_

- [x] 7.5 前端单测
  - 新建 `test/auth/use-identity.test.tsx` 与 `test/auth/login-form.test.tsx`
  - `identityListKey` 在登录/登出/切号下取值互异(驱动 agent-sources 刷新)
  - 空字段禁止提交;取消不发请求(用 fetch 探针断言调用次数为 0)
  - 404 → `disabled` 且不渲染任何入口(Req 2.5)
  - _Requirements: 1.5, 2.2, 2.5, 3.2, 3.3_
  - _Depends: 7.1, 7.2, 7.3_

## 8. 契约文档

- [x] 8.1 契约文档同步
  - 改 `docs/pi-web-host-contract-v1.md`:§2 端口总览新增 P5 行(「云端与桌面**均须**实现 `current()`;`exchange` 可选」);新增 P5 章节含接口、语义保证、两类宿主实现义务
  - 写明 v1 兼容性:纯新增,不改既有端口签名与语义(Req 9.2)
  - 更正「device 授权流」表述,改以实测确认的账号密码形态描述(Req 9.3)
  - _Requirements: 9.1, 9.2, 9.3_
  - _Boundary: docs/pi-web-host-contract-v1.md_

## 9. 验收

- [x] 9.1 全面跑测 + 类型检查
  - 根 `pnpm test:app`、`packages/server`、`packages/protocol`、`packages/tool-kit` 各测面全绿
  - `pnpm typecheck` 通过
  - ★ 只跑根 vitest 会漏子包红,四个测面都要跑
  - _Requirements: 全部_
  - _Depends: 7.5, 8.1_

- [x] 9.2 真机烟雾(打包态之外的 dev 态)
  - `pnpm dev:server` 起服务,确认 `GET /api/identity` 在配置/未配置云端两种情形下的返回
  - 用真实账号打 `POST /api/identity/exchange`,确认 200 + `tenant` 且线上源随即可枚举
  - ★ 单测全绿 + typecheck ≠ 能跑 —— 本仓已有三次「只有真机烟雾能发现」的记录(@/ 别名、跨仓 alias、error-map 落 500)
  - _Requirements: 2.1, 2.6, 4.4, 5.1_
  - _Depends: 9.1_

## Implementation Notes

### 与 design 的偏离(均为实现期发现,已在代码内写明理由)

1. **任务 5.3 —— 不新增能力 id,改挂既有 `auth.session`**
   design 原写「新增能力面 `identity.session`」。实现时发现 `HOST_CAPABILITY_IDS_V1` 是**冻结名册**,
   而 `composeCapabilities` 要求宿主对**每一个**描述符显式表态 —— 新增第 17 个 id 会让所有既有宿主
   (pi-clouds / 桌面)当场抛 `missing-decision`,那是实质破坏性变更,契约 §1 要求升 v2 才允许。
   改挂 `auth.session` 语义上也成立:它本就是「登录这件事」的能力面。已写入契约文档 §6.5.4。

2. **任务 7.4 —— `use-desktop-auth.tsx` 删除而非兼容 re-export**
   design 原写「收敛为兼容 re-export」。实现时确认新旧状态形状**不兼容**(判别联合 vs `loggedIn` 布尔),
   假装兼容只会骗下一个读代码的人。改为删除该文件,并把它的守卫测试
   (`test/auth/desktop-auth-shared-refresh.test.tsx`)**移植**为 `test/auth/use-identity.test.tsx` ——
   「共享 Provider → 身份变化驱动列表刷新」这条守卫一条没丢。

3. **新增 `DesktopCapabilitiesClient.cachedStatic()`(design 未列)**
   Req 4.5 要求 spawn env 采用 `egress` 授予,但 spawn spec 的构造是**同步**路径。
   为读一个已在内存里的值把整条 spawn 链改成异步不划算,故加一个同步的缓存读取器
   (从不打网络;凭据不符或已过期即返回 `undefined`,调用方按「退回本地默认」处置)。

4. **`loadStatic(credential?)` 接受显式凭据(design 未列)**
   交换流程需要用**尚未写入 `AuthSessionState`** 的新凭据取授予(先拿授予才落凭据)。
   初版实现曾用「临时把新凭据顶进 `AuthSessionState`、取完恢复」的写法 —— 那会让并发的
   `getSourcesGrant()` 在一瞬间用错身份,已改为显式参数。

### 任务 9.2 真机烟雾结果(dev 态,jiti 运行时)

| 用例 | 结果 |
|---|---|
| `GET /api/identity`(已配置云端) | 200 `{"state":"anonymous","canExchange":true}` |
| `POST /identity/exchange` 空字段 | 400 |
| `POST /identity/exchange` 错误账号密码(**真打 pi-cloud**) | 401 `invalid-credentials` —— 登录 URL 由 `cloud.json` 的 `egressBase` 推导正确 |
| `DELETE /api/identity` | 200 |
| `GET /api/auth/me`(既有面不回归) | 200 |
| **未配置云端**:`GET /api/identity` / `/api/auth/me` | **双 404**(能力面不挂载,Req 2.5) |
| dev 日志含密码? | **0 次命中** |

★ **未覆盖:登录成功路径**。需要一组真实云端账号密码,本轮无凭据可用,故 Req 2.6 / 4.4 / 5.1
的「登录成功后」分支只有单测与集成测覆盖,**没有真机证据**。这是本 spec 唯一的证据缺口,
须由持有账号的人补一次真机登录。

### 测试面结果(任务 9.1)

| 测面 | 结果 |
|---|---|
| 根 `pnpm test:app` | 878 passed / 2 skipped |
| `packages/server`(unit + integration) | 2334 + 32 passed / 18 skipped |
| `packages/protocol` | 415 passed |
| `packages/tool-kit` | 463 passed |
| `pnpm typecheck` | 通过(含 `test-d` 编译期契约断言) |

## 10. 真机测试反馈(2026-07-27,第二轮)

- [x] 10.1 修:成功响应字段名是 `token` 不是 `credential`
  - 用户实测报「无法连接云端,请重试」。打包态后端探测证明云端可达(错误账号正确回 401),
    故不是连通性问题 —— 是 2xx 但字段对不上,落进「响应形状非预期」分支
  - 事实源:被撤回的 `7c184ed:packages/server/src/auth/signin-endpoint.ts`(本仓唯一跑通过
    成功路径的实现)。★ **我本该先看它再写客户端**,这是本 spec 最该避免的一次疏忽
  - 改 `cloud-login-client.ts`:优先读 `token`,`credential` 作兼容读位
  - _Requirements: 2.1_

- [x] 10.2 修:403 从 `invalid-credentials` 拆出为 `no-membership`
  - 403 = 账号密码正确但无租户归属。归到「账号或密码错误」会让用户反复试同一个正确密码
  - 端口新增失败类别 + 路由映射 + UI 文案「该账号未加入任何组织,请更换账号或联系管理员开通」
  - _Requirements: 2.3_

- [x] 10.3 独立登录页 + 登录门禁(Req 10)
  - 新建 `components/auth/login-page.tsx`:`LoginPage`(整屏居中卡片)+ `IdentityGate`
  - `LoginForm` 加 `layout: "inline" | "page"` —— **只改排布,不改任何行为**,故既有表单测试
    对两种布局同样有效
  - ★ 门禁**不是**无条件的。`disabled` / `!canExchange` / 探测失败一律**放行** ——
    拦了会把纯本地用法与浏览器用法整个废掉。判定表见 `login-page.tsx` 顶部
  - `loading` 期间两者都不渲染(先闪登录页再跳走比空白更糟)
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - _Boundary: components/auth/login-page.tsx_

- [x] 10.4 测试
  - `test/auth/identity-gate.test.tsx`:**三条不拦的路径**是重点(云端未配置 / 探测失败 /
    canExchange=false),它们写错的故障形态最严重
  - `cloud-login-client.test.ts`:`token` / `credential` / 两者并存 / 403→no-membership
  - _Requirements: 2.1, 2.3, 10.1-10.7_

## 11. 展示名与随包默认配置(2026-07-27,第三轮)

- [x] 11.1 `tenant` 增可选 `displayName`,展示名字而非 UUID
  - 契约 `CapabilityTenant` 加可选成员(契约 §1 允许,不升版本);解析兼容 `displayName` / `name`
  - 展示优先用它、取不到退回 `userId`;UUID 保留在 `title` 属性(排查问题要的是权威标识)
  - ★ **不得**用于鉴权/配额归属:可重名、可为空、可被用户随时改
  - ⚠ 云端侧未做:pi-clouds 的 tenant 仍只有三字段,`profiles.name` 未读取也未下发
  - _Requirements: 5.1, 5.2_

- [x] 11.2 随包固化云端默认地址(Req 11)
  - 新建 `lib/app/cloud-defaults.ts`;装配次序改为 `env > 用户 cloud.json > 固化默认值`
  - ★ **只对桌面壳生效**。`dist/` 载荷同时随 npm 包与 `.app` 分发,无条件生效会让每个
    `pnpm dev` / npm CLI 用户开机撞上登录门禁 —— 他没有这个云端的账号,过不去,
    等于把本地用法整个废掉
  - 桌面标记 `PI_WEB_DESKTOP=1` 由壳在 `build_child_env` 写入 —— 只有壳知道自己是壳;
    这**不是**配置读取(那属 Node 的配置域机制,上一轮已明确)
  - 构建期可经 `PI_WEB_BAKED_CLOUD_EGRESS_BASE` 覆盖(私有化部署不必改源码)
  - Rust 侧加守卫测试:标记被删 → 转红(否则故障形态是「全新安装没有登录入口且无报错」)
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - _Boundary: lib/app/cloud-defaults.ts, desktop/src-tauri/src/server_supervisor.rs_

### 任务 11.2 真机验证结果(2026-07-27,打包态)

固化默认值此前只有单测,无真机证据。本轮补齐,三条都实测:

| 场景 | 结果 |
|---|---|
| 桌面壳 + **无** `cloud.json` → `GET /api/identity` | **200** `anonymous/canExchange:true` —— 固化默认值生效,全新安装即可登录(Req 11.1) |
| **非桌面**(`pnpm dev`)+ 无 `cloud.json` | **404** —— 云端登录整体关闭,本地用法不受影响(Req 11.4) |
| `pnpm dev` + `PI_WEB_DESKTOP=1` | **200** —— 判据确实是那个标记,不是别的巧合 |

第二条是这项改动存在的全部理由:少了它,每个 `pnpm dev` / npm CLI 用户开机就会
撞上一堵他过不去的登录墙。它现在有真机证据了。

★ 顺带记一个构建期的坑:`bundle_dmg.sh` 会被**上一次残留的挂载卷**卡死
(`/Volumes/dmg.XXXXXX` + `bundle/macos/rw.*.dmg`),报错只说 "failed to run
bundle_dmg.sh",不提挂载。解法:`hdiutil detach -force` 那个卷 + 删掉 `rw.*.dmg` 再构建。

## 12. 登录成功路径的证据补强(2026-07-27)

- [x] 12.1 端到端成功路径集成测(除云端外全真实组件)
  - 新建 `packages/server/test/identity/login-success-path.test.ts`(12 例)
  - 真 `createCloudLoginClient` + 真 `createDesktopCapabilitiesClient` + 真
    `createDesktopPasswordIdentityProvider` + 真 `createIdentityRoutes` + 真 `AuthSessionState`;
    **只**把 `fetch` 换成按实测云端契约应答的桩(`POST /login → {token}`、
    `POST /capabilities → {tenant,egress,sources}`)
  - 覆盖:200 + 已认证 + 展示名 / 凭据落登录态 / 能力端点带的是**刚签发的那个** token /
    响应体不含密码与任何 token / sources 与 egress 随即可用 / GET 与 exchange 同一身份 /
    一次登录只打一次云端 / 三条降级分支 / 登出清缓存
  - ★ **变异验证**:把当初那个 bug(按 `credential` 解而非 `token`)注回去,
    3 条断言立刻转红 —— 证明这组测试确实盯着那个缺口,不是摆设。验完已 `git checkout` 还原
  - ⚠ 它**证明不了**云端真实响应就是这个形状。那一条仍需持有账号的人重登一次 ——
    而这正是首版把 `token` 写成 `credential` 却全绿的那个缺口所在
  - _Requirements: 2.1, 2.6, 4.1, 4.3, 4.4, 4.5, 5.1, 5.3, 7.1, 8.1, 8.2_
  - _Boundary: packages/server/test/identity/login-success-path.test.ts_

### 当前证据状态

| 路径 | 真机 | 集成 | 单测 |
|---|---|---|---|
| 登录失败(401 真打 pi-cloud) | ✓ | ✓ | ✓ |
| 未配置云端 → 404 / 门禁放行 | ✓ | — | ✓ |
| 固化默认值三向 | ✓ | — | ✓ |
| **登录成功** | **✗** | ✓ | ✓ |

登录成功仍是唯一没有真机证据的路径。

## 13. Req 12 · 登录跨重启(方案 A:壳经受 token 保护的回环端点取回)

> 用户裁定「我们需要保存登陆的状态,每次开应用都重新登陆影响体验」→ 否决了此前倾向的
> 「不持久化」;并在 A(本地端点)与 A′(stdout 控制帧)之间选定 **A**。

- [x] 13.1 服务端取回端点
  - 新建 `packages/server/src/auth/shell-credential-route.ts`:`GET /desktop/credential`
  - **未配置 `PI_WEB_SHELL_TOKEN` 则整条路由不挂载** —— 不是「存在但拒绝」(Req 12.7)
  - token 比对用**定长时间**算法:朴素 `===` 会因短路泄漏前缀匹配长度,使 token 可被逐字节试探
  - ★ 未登录/已过期 → **200 + `credential: null`,不是 404**。壳据此清钥匙串;
    若用 404,壳分不清「没登录」与「端点不存在」,只能什么都不做 → 登出后钥匙串残留
  - _Requirements: 12.1, 12.4, 12.5, 12.7_

- [x] 13.2 端点测试(19 例)
  - 三条门:token 校验(含"前缀正确但被截断"这一逐字节试探形态)/ 未登录返回 null / 过期不下发
  - 401 响应体不含凭据与 token;响应字段集封闭
  - _Requirements: 12.1, 12.4, 12.6, 12.7_

- [x] 13.3 Rust:壳 token + 取回 + 落钥匙串
  - 新建 `shell_token.rs`:每次进程启动经 `getrandom` 生成 32 字节强随机;
    **拿不到 OS 熵源即 panic**,不退化成弱随机(那会让端点在用户不知情时变成敞开的)
  - 新建 `credential_sync.rs`:裸 `TcpStream` 手写回环 GET —— 固定明文单次小响应,
    引 `reqwest` 只会带进用不上的 TLS/连接池/重定向 API 面;解析单独成函数以便无网络单测
  - `build_child_env` 下发 `PI_WEB_SHELL_TOKEN`
  - `sync_credential` command:取回 → 有则写钥匙串、无则清条目
  - Rust 测试 84 全绿(新增 7 条,含「错误文案不得含凭据」的机械守卫)
  - _Requirements: 12.1, 12.4, 12.5, 12.6_

- [x] 13.4 前端接线
  - `desktop-bridge` 增 `syncCredential()` —— ★ **调用不带凭据**,只是「去取一次」的信号
  - `use-identity` 登录成功与登出后各调一次;登出走**同一条路径**(server 返回 null → 壳清条目),
    避免「登录一条路、登出另一条路」各自维护
  - **best-effort**:失败只记日志,不影响本次会话登录态
  - _Requirements: 12.1, 12.4, 12.5_

### ⚠ 已知缺口(不因本次实现而消失)

1. **残留风险**:token 在壳进程 env 里,同用户的其它进程读得到,从而能取走凭据。
   本方案**不声称**能挡住同用户攻击者 —— 它挡的是「任何本地进程随手 curl 一下就拿到凭据」。
   要彻底关掉需把服务端从 TCP 换成 0600 的 Unix domain socket,是另一个量级的改动。
   选型时已向用户说明并被接受。

2. **Windows / Linux 钥匙串未经真机验证**。`keyring` v3 按平台绑 Credential Manager /
   Secret Service,`credential_store.rs` 文件头即声明「仅 macOS 做过真实验证」。
   Linux 上 Secret Service 是 D-Bus 守护进程,**headless / SSH / 精简窗管 / 容器内均不存在**,
   写入会直接失败。故实现按 best-effort 设计:写不进只是下次要重登,登录本身不受影响。
   此项从 `desktop-cloud-login` 的悬置项**升格**为 Req 12 的已知缺口 —— 它现在有用户可感知的后果。

3. **重启后自动登录未真机验证**。读的那半边(keychain → base_env → 播种 → `current()` 补加载)
   是既有链路且有单测,但整条「登录 → 关应用 → 重开仍登录」尚未在真机走过一次。
