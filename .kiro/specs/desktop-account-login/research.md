# Research Log — desktop-account-login

> Discovery 类型:**Extension**(集成向轻量发现)。系统已存在(`desktop-cloud-login` + `desktop-hybrid-agent-sources` + 宿主契约 v1),本 spec 补一个缺口端口并替换登录形态。

## Discovery Scope

1. 云端登录端点的真实契约(外部,不可改)
2. 宿主契约 v1 现有端口的形状与语义纪律(P2 `CapabilityProvider` 是新端口的直接邻居)
3. 既有登录链路的全部接缝:进程内登录态 / 鉴权路由 / 能力面装配 / 前端 hook
4. `tenant` 字段"契约有、代码无消费方"的确认
5. 新端口在能力面装配(`defaultCapabilities`)中的挂载方式

## Findings

### F1 · 云端契约(实测,2026-07-27)

| 端点 | 方法 | 实测响应 |
|---|---|---|
| `{cloudBase}/api/desktop/login` | POST `{email,password}` | 400 `email and password required` / 401 `Invalid login credentials` |
| `{cloudBase}/api/desktop/capabilities` | POST(GET 返回 405) | 需 `Authorization: Bearer <凭据>` |
| `{cloudBase}/api/desktop/egress/v1/models` | GET | 未带凭据 401 |
| `/api/desktop/device`、`/api/desktop/device/start`、`/api/auth/login`、`/api/auth/signin` | — | **全 404** |

**含义**:`components/auth/login-control.tsx:12` 注释所称"生产形态由 pi-cloud 授权流(device 授权)承载"是**过时推测**,云端从未提供 device 端点。该注释误导了整条登录形态的设计,须一并更正(Req 9.3)。

### F2 · P2 `CapabilityProvider` 的语义纪律(`packages/server/src/capability/types.ts`)

三条不变式已在类型层落实,新端口必须与之**一致而非另立一套**:

1. **「不可用」与「加载失败」必须可区分** —— 前者以字段缺失表达(调用方降级),后者以抛错表达(宿主拒绝进入已登录态)。这直接决定 Req 4.2(整体失败不进已登录态)与 Req 4.3(单项缺失降级)必须是**两条不同的机制**,而不是同一条的两种写法。
2. **附件授予的会话作用域由方法签名机械强制**(`StaticCapabilitySnapshot.attachments?: never`)。文件注释记录了一条实证结论:改回 `load(sessionId?)` 重载形态**挡不住**越权签发(TS 对重载只做一次宽松兼容检查)。→ 新端口若要机械强制什么,须走"拆方法/拆类型",不能靠重载。
3. **凭据禁落盘**,授予皆为只读投影并强制携带 `expiresAt`。

`contractVersion` 被钉成 `typeof HOST_CONTRACT_VERSION`(类型层即固定,宿主无法声明别的版本)—— 新端口沿用同一写法。

### F3 · 既有登录链路的接缝清单

| 接缝 | 位置 | 现状 |
|---|---|---|
| 进程内登录态 | `packages/server/src/auth/auth-session-state.ts` | `set/clear/isValid/currentCredential/snapshot`;`snapshot()` 从**凭据 payload** 取 `userId/companyId`,不是从 `tenant` 授予 |
| 鉴权路由 | `packages/server/src/auth/auth-routes.ts` | `POST/DELETE /auth/session`、`GET /auth/me`;`POST` 收的是**已获得的凭据串** |
| 能力面挂载 | `packages/server/src/host-assembly/default-capabilities.ts:162` | `{ id: "auth.session", factory: d => d.authState !== undefined ? … : [] }` —— 条件挂载以 `HostDeps` 可选字段表达 |
| 能力授予客户端 | `packages/server/src/auth/desktop-capabilities-client.ts` | 只解析 `sources` 一个字段;**全链 fail-soft**(任何失败 → `undefined`) |
| 装配 | `lib/app/pi-handler.ts:480-491, 854-901` | `cloudLoginConfig` → `AuthSessionState` → capabilities 客户端 → 线上源 provider/resolver |
| spawn env | `lib/app/auth-egress-assembly.ts` `computeAuthEgressSpawnEnv` | egress `baseUrl`/`models` 取自**装配期 env 配置**,不是能力授予 |
| 前端 | `components/auth/use-desktop-auth.tsx` + `login-control.tsx` | Context 单实例;`login(credential)` 直接 POST 凭据串 |

### F4 · `tenant` 无人消费(确认)

`CapabilitySnapshot.tenant` 在 `packages/server/src/capability/types.ts` 有完整定义(`userId`/`companyId`/`role` 三字段皆必填,注释写明"身份是完整的或根本没有"),但全仓无任何消费方。前端展示的 `userId`/`companyId` 来自 `parseDesktopCredential` 解出的**凭据 payload**,与 `tenant` 授予是两条独立来源。Req 5.1 要求改用 `tenant`。

### F5 · fail-soft 与 fail-hard 的冲突点(本次发现的关键风险)

`DesktopCapabilitiesClient.getSourcesGrant()` 是**故意 fail-soft** 的 —— 它服务于"源列表枚举",云端抖动时应退回仅本地源而不是让侧栏报错。

但 Req 4.2 要求**登录路径**上授予获取整体失败时**不进入已登录态**(与契约 §4.2.3 一致)。

两者不能用同一个方法。→ 设计决策 D3:同一客户端暴露**两个语义不同的方法**,`loadStatic()` fail-hard(抛)、`getSourcesGrant()` 保持 fail-soft(返回 `undefined`),后者内部复用前者并吞掉异常。**不得**把 `getSourcesGrant` 改成抛 —— 那会让线上源侧栏在云端抖动时整体报错,是回归。

## Architecture Pattern Evaluation

| 候选 | 评价 | 结论 |
|---|---|---|
| **给 `CapabilityProvider` 加身份获取方法** | 破坏 P2 的单一职责("用身份换授予");且 `loadStatic()` 已是无参方法,加交换语义会让"不支持交换"的云端实现被迫写空实现 | ✗ |
| **新增 P5 `IdentityProvider` 端口** | 与 P2 正交:P5 回答"身份怎么来",P2 回答"身份能换到什么";v1 兼容(纯新增) | ✓ **采纳** |
| 桌面实现自带(方案 B) | 已在 requirements 阶段否决 | ✗ |

## Design Decisions

### D1 · 身份状态是**判别联合**,不是布尔加可选字段

```
{ kind: "authenticated", tenant }  |  { kind: "anonymous" }
```

理由:`{ loggedIn: boolean; tenant?: Tenant }` 允许表达 `{loggedIn:true, tenant:undefined}` 这种非法组合,而 Req 5.1 要求已登录必然有身份。判别联合在编译期消灭该组合。这与 F2 第 2 条的教训同源 —— 能靠类型挡住的,不要靠文档。

### D2 · "是否支持凭据交换"**只有一个事实源**:`exchange` 方法是否存在

Req 1.3/1.4 要求端口表明是否支持交换。两种写法:

- (a) `current()` 返回值里带 `exchange: { supported: boolean }` 标志
- (b) `exchange?` 作为**可选方法**,存在即支持

选 **(b)**,但 UI 隔着 HTTP 看不到方法。→ HTTP 投影里的 `canExchange` 布尔由路由层**派生**自 `typeof provider.exchange === "function"`,**不**由实现另行声明。

若两者都让实现声明,就有了两个可能不一致的事实源 —— 实现写了 `supported:true` 却没实现方法,类型挡不住,只会在用户点"登录"时炸。

### D3 · fail-soft / fail-hard 分成两个方法

见 F5。`loadStatic()` 抛、`getSourcesGrant()` 吞。

### D4 · egress 授予**优先于** env 配置

Req 4.5 要求 `egress` 授予到位时模型清单来自云端出口。现状 `computeAuthEgressSpawnEnv` 取装配期 env 的 `models`。改为:有 `egress` 授予 → 用授予的 `baseUrl`/`models`;无授予 → 退回 env 配置(保持 `desktop-cloud-login` 既有行为不回归)。

### D5 · 前端概念更名 `desktopAuth` → `identity`

Req 1.5 禁止 UI 据宿主类型分支。留着 `useDesktopAuth` 这个名字,下一个改它的人会自然地写 `if (isDesktop)`。命名是这条约束最廉价的执行手段。旧名保留 re-export 一轮,避免大面积改动。

### D6 · `/api/auth/*` 保留不动

Req 3.4 只要求粘贴形态**不再是主路径**,没要求删除。删除会破坏 `desktop-cloud-login` 的既有测试与桌面壳凭据播种链路。新端点 `/api/identity/*` 并存;`AuthSessionState` 仍是凭据的唯一进程内权威,两条路径写同一实例。

## Risks

| 风险 | 缓解 |
|---|---|
| `getSourcesGrant` 被误改为 fail-hard → 线上源侧栏在云端抖动时整体报错 | 该方法上写明纪律注释;单测钉住"网络失败 → `undefined` 而非抛" |
| 登录成功但 `loadStatic` 抛 → 用户看到"登录失败"却凭据已被云端签发 | 交换与授予加载在同一 `exchange()` 内完成;失败时**不写入** `AuthSessionState`,对用户即"未登录",可重试 |
| 云端多租户实现缺席 → P5 变成"只有桌面用"的伪抽象 | 本 spec 交付**两个**实现:桌面密码实现 + 一个由既有凭据/会话直接产出身份的实现,后者即云端形态的本仓可测版本 |
| 密码经本地服务端中转 → 明文在 Node 进程内存 | 不写日志、不入响应体、不写 Workspace;交换后立即丢弃,只保留云端签发的凭据 |

## Revalidation Triggers

- 云端 `POST /api/desktop/login` 的请求/响应形状变化
- `CapabilitySnapshot` 字段增删
- `HOST_CONTRACT_VERSION` 升版
- `defaultCapabilities` 能力面 id 集合变化(两端须重新表态)
