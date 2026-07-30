# Requirements Document

## Project Description (Input)

让**登录用户拿到发布身份**：cloud 在能力快照里签发一枚 publish 授予，registry 认它。
这是设计稿 `docs/registry-publish-identity-design.md` 的 **P1**。

**跨三仓**（逐任务标注）：
- `agents/pi-clouds`：签发（`apps/cloud`）+ 验签（`registry-client` 的 verifier）
- `agents/pi-web`：能力契约加 `publish` 字段 + 客户端取授予（**只加管道，不打通发布**）
- `BlackSail/supabase`：无 —— P0 已就位

### 前置已就位（P0 实测）

生产库 `public.companies` 已有 `org_name`（31 家全有值、唯一）与 `org_name_status`；
`黑帆科技` 已配 `blksails` / `configured`，其余 30 家为 `auto` 占位。
registry 侧 `CallerContext` 已能承载 `tenantId` / `org`，`createSource` 已改为从中派生。

### 现状（勘察实证）

| 事实 | 位置 | 含义 |
|---|---|---|
| `buildDesktopCapabilities` 只产 `tenant` / `egress?` / `sources` | `apps/cloud/lib/desktop-capabilities.ts` | 需增 `publish` 分支 |
| `sources.token = signConsumeToken(companyId)`，payload `{companyId, scope:"consume", exp}` | `registry-client/src/ports/consume-token.ts` | publish token 照此形态另立，**不复用 scope** |
| 签发与验签**共享同一份算法实现**（刻意，避免两侧字节级不一致） | 同上文件头注释 | publish token 必须沿用该结构 |
| `HmacConsumeTokenVerifier.verifyPublish` **恒抛** | `registry-client/src/ports/token.ts:82` | 需要一个新的 publish verifier |
| `CompositeTokenVerifier` 已存在，可组合多个 verifier | 同上 :106 | 新 verifier 挂进去即可，不动 `StaticTokenVerifier` |
| `registerPublisher` / `addPublisherKey` 需 **platform admin** | `registry-service.ts:162,176` | 自助 provision 只能由 cloud 代持 admin 完成 |
| `StaticCapabilitySnapshot` 定义在 **pi-web**、由 pi-clouds 填充 | `pi-web packages/server/src/capability/types.ts:122` | 加字段是**两仓同改**，受 `HOST_CONTRACT_VERSION` 约束 |

## Introduction

本特性打通"登录 → 拿到发布身份"这一段：cloud 依据当前企业的 org 配置状态决定是否签发
publish 授予，registry 认它并解出 `{publisherId, tenantId, org}`。pi-web 侧只把授予接进
能力面并暴露给应用层，**不改任何发布行为** —— 真正发布属 P2。

## Boundary Context

- **In scope**
  - publish token 的签发（cloud）与验签（registry）；
  - 按需 provision publisher（首次为该企业建 publisher）；
  - `org_name_status` 门控：未 `configured` 一律不签发；
  - pi-web 能力契约加 `publish` 字段 + 客户端 `getPublishGrant()`；
  - 相关单测。
- **Out of scope**
  - pi-web 打通 `uploadBundle → registerVersion → setChannel`（P2）；
  - 可见性选择（P3）；
  - 密钥归属与签名 —— 已裁定云端代管，但**代签本身属 P2**，本 spec 不涉及；
  - 密钥轮换 / 吊销；
  - `org_name` 的分配流程 UI（谁来把 `auto` 改成 `configured`）。
- **Adjacent expectations**
  - 本 spec 落地后，pi-web 侧 `/agent publish` 的行为**完全不变**（仍 `PUBLISH_NOT_AVAILABLE`）——
    授予只是被取到并暴露，尚无人消费它。这是刻意的：管道与用途分两步，各自可验。
  - 黑帆科技（唯一 `configured`）将是唯一能拿到授予的企业。

## Requirements

### Requirement 1：cloud 签发 publish 授予

**Objective:** As a 登录用户, I want 登录后自动获得发布身份, so that 我不需要运维为我手工配置
一枚静态 token。

#### Acceptance Criteria

1. When 用户取能力快照且其企业已配置 org, the cloud shall 在快照中产出一个发布授予，
   含注册表地址、短时 token、发布者标识与到期时间。
2. The publish token shall 携带企业标识与 org，使验签方能解出完整归属身份。
3. The publish token shall 与既有消费 token **作用域可区分**，消费 token 不得被当作发布凭据使用，
   反之亦然。
4. The 签发算法 shall 与验签方**共享同一份实现**，不在两侧各写一遍。
5. The token shall 有明确的有效期，且到期时间随快照返回，使客户端可在过期前重取。

### Requirement 2：未配置 org 的企业不签发

**Objective:** As a 平台运维者, I want 未配置 org 前拿不到发布身份, so that 占位标识永远不会
写进任何已发布包的永久标识。

#### Acceptance Criteria

1. While 企业的 org 配置状态为「系统占位」, the cloud shall **省略**发布授予字段，
   而不是签发一枚"受限"的授予。
2. The 省略 shall 与既有的可选能力（如出口代理未配置时）采用同一手法，不引入新的表达方式。
3. If 签发所需配置缺失（如密钥未配）, then the cloud shall 同样省略该字段，
   **不得**返回一个半成品快照。

### Requirement 3：registry 认这枚授予

**Objective:** As a 平台运维者, I want registry 能验证 cloud 签发的发布身份, so that 发布面
不再只能依赖静态配置表。

#### Acceptance Criteria

1. The registry shall 能验证该 token 并解出发布者标识、企业标识与 org。
2. If token 形态不对、签名不符、作用域不符或已过期, then the registry shall 拒绝，
   且**不向调用方区分具体原因**（避免可用的 oracle），但保留服务端日志可排障。
3. The 新验签能力 shall 与既有的静态 token 校验**并存**，不改变后者的任何行为。
4. The 消费面校验 shall 完全不受影响。

### Requirement 4：按需 provision publisher

**Objective:** As a 登录用户, I want 首次发布前不需要平台为我建 publisher, so that 发布不被
一道人工流程卡住。

#### Acceptance Criteria

1. When 某企业首次需要发布身份而 registry 尚无对应 publisher, the cloud shall 代为登记一个。
2. The publisher 标识 shall 由企业身份稳定派生，同一企业重复取快照不得产生第二个 publisher。
3. If 登记失败, then the cloud shall 省略发布授予（诚实降级），而不是返回一个指向不存在
   publisher 的授予。
4. The 登记 shall 使用平台管理员凭据完成 —— 这是 registry 既有的授权要求，本 spec 不放宽它。

### Requirement 5：pi-web 取得并暴露授予

**Objective:** As a pi-web 维护者, I want 能力面能取到发布授予, so that P2 接发布时不必再动
契约层。

#### Acceptance Criteria

1. The pi-web 能力契约 shall 承载发布授予（可选字段）。
2. The 能力客户端 shall 提供取发布授予的方法，其失败语义 shall 与既有的源授予一致
   （取不到返回"无"，**而不是抛**）—— 否则云端抖动会让整条命令崩而不是降级。
3. While 授予不存在, the pi-web 行为 shall 与本 spec 引入前**完全一致**。
4. The 契约变更 shall 与宿主契约版本约束一致，不绕过它。

### Requirement 6：凭据卫生

**Objective:** As a 平台运维者, I want 发布凭据不泄露, so that 它不会经日志或响应体扩散。

#### Acceptance Criteria

1. The publish token shall 只出现在能力快照响应体中，不写盘、不进日志、不进任何其它载荷。
2. The 签发所需的密钥 shall 只存在于服务端配置，任何客户端载荷都不得携带它。
3. The 拒绝路径的错误信息 shall 不包含 token 内容或密钥。

### Requirement 7：验证

**Objective:** As a 维护者, I want 这条链路有可执行证据, so that "登录即有发布身份"不是靠替身证明。

#### Acceptance Criteria

1. The 测试套件 shall 覆盖签发：已配置 org → 有授予；未配置 → 无授予；缺密钥 → 无授予。
2. The 测试套件 shall 覆盖验签：合法 token 解出三元身份；作用域错、过期、篡改签名各自被拒。
3. The 测试套件 shall 覆盖 provision：首次登记；重复取快照不产生第二个 publisher；登记失败降级。
4. The 测试套件 shall 断言**签发与验签互通**（同一份 token 签出即能验过），
   而非两侧各测各的 —— 那正是两侧各写一遍实现会踩的坑。
5. The 测试套件 shall 断言 pi-web 在无授予时行为不变。

---

## 实施状态（2026-07-28）

| Req | 状态 | 位置 |
|---|---|---|
| 1 签发 | ✅ | `pi-clouds` `registry-client/src/ports/publish-token.ts` + `apps/cloud/lib/desktop-capabilities.ts` |
| 2 org 门控 | ✅ | 同上（未 configured → 省略字段） |
| 3 验签 | ✅ | `HmacPublishTokenVerifier` + `CompositeTokenVerifier` 对称化 |
| 4 provision | ⚠️ **部分** | `apps/cloud/lib/publish-identity.ts` 已实现并测试；**路由层未接线** |
| 5 pi-web 取授予 | ✅ | `packages/server/src/capability/types.ts` + `desktop-capabilities-client.ts` |
| 6 凭据卫生 | ✅ | 测试断言 token 不出现在快照其它字段、secret 不出现在任何位置 |
| 7 验证 | ✅ | 17 + 13 + 8 + 129 条 |

### Req 4 为何停在"未接线"

接上 `resolvePublishIdentity` 后，**下一次有人登录就会真的往生产 registry 写一条 publisher 记录**。
属生产写入，待明确许可后再接（几行接线，非技术难点）。

### provision 的实现方式与原议不同（更好）

原议是"cloud 代持 registry admin token"。实施中发现 cloud 的 registry 是**进程内直连 DB** 装配的，
故改为：cloud 另起一个 `RegistryService` 实例，校验器只认**进程内随机 nonce**。收益：

- 没有长期共享密钥 → 不存在"admin token 被偷 → 伪造任何人签名"
- `CloudTokenVerifier.verifyPublish` 那颗「cloud 是只读消费面」的钉子**原封不动**
- 13 道 admin 门只开 `registerPublisher`；`addPublisherKey`（真正危险的那道）仍无入口

### 跨仓类型垫片（临时，有删除条件）

`apps/cloud` 依赖 npm 上的 `@blksails/pi-web-server@0.6.1`，看不到 pi-web 源码里新加的
`publish` 字段。**未发 npm 包**（外向动作），改用本地扩展类型 `DesktopCapabilitySnapshot`。
**删除条件**：上游发布含 `CapabilitySnapshot.publish` 的版本并在 pi-clouds 升级依赖。

### P2 / P3 未启动的原因

- **P2（打通真实发布）**：~~发布的授权本体是**验签**，而当前 provision 出的 publisher 是**空钥**的~~
  → **该前置已由 spec `publish-key-lifecycle` 解除（2026-07-28）**：本机自动生成密钥、
  公钥经 `POST /api/desktop/publish/keys` 自动登记，`publisher.keys` 不再恒空。
  P2 剩余的是**接线本身**（`uploadBundle → registerVersion → setChannel`）与
  Req 4 的路由接线（见上）。
- **P3（可见性选择）**：依赖 P2 的 `createSource` 调用点存在。

### 2026-07-28 追记：P2 已交付（spec `publish-execution`）

★ 交付时发现一处**本 spec 遗留的真阻塞**：`HmacPublishTokenVerifier` 在本 spec 造好并测过，
却**从未接进 `apps/registry` 的 `buildTokenVerifier()`** —— 即上表 Req 3 标 ✅ 只覆盖了
「校验器写对了」，没覆盖「它被装上了」。cloud 签得出 token、真实 registry 一律拒绝，
而这不会有任何报错，只在真机上表现为"登录了也发不出去"。

已在 `publish-execution` 任务 1.1 接入，并把**装配点本身**纳入验收
（`apps/registry/test/token-verifier.test.ts`，四种 env 组合）。

**教训**：造好一个组件并为它写测试，不等于它在跑。装配点要么被测试覆盖，要么在验收清单里点名。
