# 跨仓设计讨论稿 —— 发布身份与可见性

> 状态：**讨论稿，未定案，未立 spec**。
> 涉及三个仓：`pi-web`（客户端 + 能力契约类型）、`pi-clouds/apps/cloud`（签发能力）、
> `pi-clouds/packages/registry-{client,server}`（注册表服务）。
> 本稿所有"现状"均为读源码实证，标注了文件与行号；所有"建议"都明确标为建议。

## 0. 这份稿子要解决什么

`pi-web` 侧已交付 `/agent publish --dry-run`（发布前编译校验与预览，spec `publish-host-command`）。
真正的对外发布还缺三件事，**全部在云端侧**：

1. 登录用户拿不到发布身份（当前授予是 consume scope）；
2. 没有"按用户建 publisher + 注册公钥"的自助路径（现为 platform admin 专属）；
3. 发布时无法选择可见性（`visibility` 挂在 `createSource`，而发布链路根本不调它）。

## 1. 现状（勘察实证）

### 1.1 三方与数据流

```
pi-web 桌面                apps/cloud                    registry-server
   │  POST /api/desktop/login  │                              │
   │──────────────────────────>│                              │
   │  POST /api/desktop/capabilities                          │
   │──────────────────────────>│ buildDesktopCapabilities()   │
   │<── {tenant, egress?, sources{baseUrl,token}} ────────────│
   │                                                          │
   │  GET {sources.baseUrl}/sources    Bearer <consume token>  │
   │─────────────────────────────────────────────────────────>│
```

- 能力组装：`apps/cloud/lib/desktop-capabilities.ts` `buildDesktopCapabilities()`，
  返回 `StaticCapabilitySnapshot`，字段只有 `tenant` / `egress?` / `sources`。
- `sources.token = signConsumeToken(ctx.companyId, …)` ——
  payload `{ companyId, scope: "consume", exp }`（`registry-client/src/ports/consume-token.ts:8`）。

### 1.2 registry 的授权是**两个正交面**

`registry-client/src/ports/token.ts` 的原话：

> **token 仅传输层**，不承担授权语义（R7.1）：发布授权本体是**验签**（R4.2②），
> 归属授权是 **publisher/org 匹配**（R7.3）。

| 面 | 方法 | 得到 |
|---|---|---|
| 消费 | `verifyConsume(token)` | `{ tenantId }` |
| 发布 | `verifyPublish(token)` | `{ publisherId, admin? }` |

**`HmacConsumeTokenVerifier.verifyPublish` 恒抛 `UnauthorizedError`** —— 登录用户拿到的那枚
token 在发布面是死的。发布身份目前只来自 `StaticTokenVerifier` 的静态
`token → {publisherId, admin}` 配置表。

### 1.3 可见性是三档，且**只管消费面**

`registry-client/src/types/entities.ts:25-31` + `registry-service.ts:875-890`：

| 取值 | 语义 | 判定 |
|---|---|---|
| `private` | 仅 admin / 发布面可见 —— **只有自己** | 消费面恒不可见 |
| `org` | 同租户消费者可见 | `ctx.tenantId === source.tenantId` |
| `public` | **任意租户**可见 | 前置于 tenantId 比较 |

`Visibility` 的文档明写：**「三者都不放宽发布面：发版 / 移动 channel / yank 恒需属主或 admin」**。

> ⚠️ **命名陷阱（务必写进任何 UI 文案与需求）**：日常说的"private = 公司内可见"，
> 对应的是 registry 的 **`org`**，不是 `private`。照字面发 `private` 会让同事一个都看不见，
> **且不报错**。

### 1.4 publisher 与公钥当前是 admin 专属

```
registerPublisher: if (!ctx.admin) throw ForbiddenError("only platform admin may register publishers")
addPublisherKey:   if (!ctx.admin) throw ForbiddenError("only platform admin may rotate publisher keys")
```

且 `addPublisherKey` 拒绝同一公钥跨 publisher 登记（指纹反查需唯一）。

### 1.5 已存在一条自动登记 source 的路径，且它已标出本稿要解的缺口

`registry-service.ts` `autoCreateSourceBySignature()`（#35 乙）：按 `manifest.publisher`
（公钥指纹）反查 publisher → **用该 publisher 的公钥验签** → 通过才建 source。
它的注释解释了为什么归属不能在 `createSource` 授予：

> `createSource` 那一步服务端手上没有任何签名，客户端传来的发布者标识都只是**未经证实的声明**
> …… 而在本方法里 manifest 与 signature 都在手上：先按指纹找 publisher，再用该 publisher 的
> 公钥验签，通过了才授予归属。**声明因此变成证明**。

自动登记的 source 固定 `visibility: "org"`，且**首次发布者会被显式拒绝**：

> 首次发布(该 publisher 尚无任何 source)时**不猜** …… 不如显式失败并指明该找谁
> `a first-time publisher must be provisioned by the platform before auto-registering a source`

注释还记了一次真机事故：`tenant_id` 写错导致**可见性判定静默失灵**、装完看不见。

### 1.6 org / tenant / publisher 目前是**三个互不相关的事实**

这是本稿最重要的一处认知修正（由领域语义反推）。

**领域语义（用户确认）**：`org` 与 `tenant` **是同一个东西**；tenant 与 company 绑定；
`org` 只是 company 的 code_name。也就是说 —— **一个身份，三种投影**。

**代码现状与之不符**：三者是各自独立取得的，谁都不由认证身份派生。

| 事实 | 怎么来的 | 谁能左右它 |
|---|---|---|
| `orgOf(sourceId)` | 从**用户传的 sourceId** 里切出来 | 调用方任意填 |
| `source.tenantId` | `CreateSourceApiInput.tenantId`，**调用方自报** | 调用方任意填 |
| `publisherId` | `verifyPublish(token)` | 认证得来（唯一可信的一个） |

`bindOrg(org, publisherId)` 绑的是 **org → publisher**，**不是 org → company**；
而 `source.tenantId` 与 org 之间**没有任何一致性约束**。于是：

- 没有任何一步校验「这个 org 是不是调用方 company 的 code_name」——
  先到先得，B 公司可以占掉 A 公司的 code_name；
- 也没有任何一步校验「`input.tenantId` 是不是调用方的 company」——
  自报一个别的租户，可见性判定就静默走偏（`autoCreateSourceBySignature` 的注释记了一次真机
  事故：`tenant_id` 写错 → 装完看不见，**不报错**）。

**org 的数据来源:需要新增 `org_name`(已裁定)**。

本稿早先两次判断都不准,现以生产库实测为准(只读 `information_schema` / `pg_indexes` 查询):

**`companies.code` 存在且唯一,但语义不对。**

| 项 | 实测 |
|---|---|
| 唯一性 | ✅ `CREATE UNIQUE INDEX companies_code ON public.companies (code)`(★ 由**独立唯一索引**实现,不在 `pg_constraint` 里 —— 只查约束表会误判为"无唯一") |
| 可空 | `NOT NULL`,无默认值 |
| registry 字符集 | ✅ 31/31 全通过 `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| 长度 | 9–43 |
| `pic-` 前缀 | **0 条** —— `supabase-tenant-store.ts:101` 那条生成路径在生产上从未走过 |

**真实取值形态**:

```
BLACKSAIL
91430104MAD98P553K
91430102MA4TFLB85N
12341234123412234
```

绝大多数是**统一社会信用代码**。直接当 org 段,包标识会长成
`91430104MAD98P553K/my-agent` —— 技术上合法,但作为要被人阅读、输入、写进文档的标识不可接受,
且把公司业务标识暴露给所有能看到 public 包的人。

**裁定:新增 `org_name`,不复用 `code`。**

### 1.7 `org_name` 落在 `public.companies`(已裁定)

**边界情况(已提出,用户裁定照此执行)**:`public.companies` 是共享 CRM 表,pi-clouds 此前
**刻意不拥有它**:

> 此 migration **不建表**(建了会与既有 CRM public.companies 冲突/读错表)。仅确保 service_role
> 对这三张表有访问权。
> —— `supabase/migrations/20260708100000_pi_clouds_tenancy.sql:9-10`

全部迁移中 `ALTER TABLE ... companies` **零命中**;其余 pi-clouds 表一律是
`pi_clouds_*` + `references public.companies(id)`。**本次加列是对该惯例的一次有意偏离**,
需在迁移注释里写明,避免后来者以为是失误。

配套事实:`service_role` **已有** `select/insert/update` 权限(同上迁移),故不需新增授权。

迁移草案:

```sql
-- supabase/migrations/<ts>_pi_clouds_company_org_name.sql
-- ★ 有意偏离:本仓此前不 ALTER 共享 CRM 表 public.companies(见 20260708100000 注释)。
--   org_name 是 registry 的 org 命名空间,与 company 一一对应,故按裁定直接落在该表。
--   幂等写法(if not exists),可重复执行。
--
-- 实测环境:PostgreSQL 17.8,`gen_random_uuid()` 内置(无需 pgcrypto)。

-- 默认值形态刻意是 `org-<32位hex>` 而非裸 uuid:
--   ① 裸 uuid 有很大概率以**数字**开头,而下面的字符集要求**字母起首** —— 直接用会当场违约;
--   ② 去掉连字符后拼 `org-` 前缀,共 36 字符,落在 39 上限内;
--   ③ 前缀让人一眼看出"这是系统占位,不是谁起的名字"。
-- ⚠ 该默认值是 **volatile**,故本次加列会触发表重写(每行取不同值,正是所需);
--   31 行量级可忽略,但需知道它拿的是 ACCESS EXCLUSIVE 锁,不是"秒级无锁加列"。
alter table public.companies
  add column if not exists org_name text
    not null
    default ('org-' || replace(gen_random_uuid()::text, '-', ''));

-- 全局唯一:org 命名空间的硬要求。默认值已保证存量互不相同,故可直接建唯一索引。
create unique index if not exists companies_org_name_key
  on public.companies (org_name);

-- 字符集比 registry 的 `^[A-Za-z0-9][A-Za-z0-9._-]*$` **更窄**,刻意为之:
-- 小写起首、只允许 a-z0-9-,避免大小写歧义与 `.`(它在包标识里另有含义);
-- 上限 39 与 GitHub org 同量级。**收窄容易放宽难** —— 放宽不让存量失效,收窄会。
alter table public.companies
  drop constraint if exists companies_org_name_chk;
alter table public.companies
  add constraint companies_org_name_chk
  check (org_name ~ '^[a-z][a-z0-9-]{1,38}$');

-- 状态位:区分"系统占位"与"用户已配置"。**只有 configured 才对外显示 org_name**。
alter table public.companies
  add column if not exists org_name_status text
    not null default 'auto'
    check (org_name_status in ('auto', 'configured'));

comment on column public.companies.org_name is
  'pi-clouds registry 的 org 命名空间(包标识首段)。全局唯一。默认为 org-<uuid> 占位;'
  '用户配置后 org_name_status 置 configured。';
comment on column public.companies.org_name_status is
  'auto=系统占位(不对外显示);configured=用户已配置(可显示)。';
```

### 1.8 状态位同时管**显示**与**发布**(已裁定:方案 A)

`org_name` 有了默认值,发布本会不再被阻塞 —— 未配置的公司也能发,包标识会是
`org-2ed000537e6140109c404edd2debba9b/my-agent`。而 org 段**永久写进已发布包的标识**,
于是会出现:公司先用占位 org 发了几个包 → 之后配置了 `acme` → **旧包永远挂在 uuid org 下**,
且按"不可改"原则改不动。

**裁定:`org_name_status = 'auto'` 时既不显示、也不允许发布。**

两条推论:

1. **占位 uuid 永远不会进入任何包标识**。它的作用退化为"满足 NOT NULL + 唯一索引的占位值",
   分裂问题因此**从根上不存在**,而不是靠事后补救。
2. **pi-web 侧零新增机制**。落实点在云端:`buildDesktopCapabilities()` 仅当
   `org_name_status = 'configured'` 时才产出 `publish` 授予;否则**省略该字段**
   (与既有 egress 未配时省略同一手法)。桌面拿不到授予,就走已经实现的
   `PUBLISH_NOT_AVAILABLE` 诚实降级 —— 只需把文案补一句"该公司尚未配置 org"。

**状态单向**:`auto → configured`,不可回退。故不存在"已签发的 publish 授予因状态回退而
越权"的窗口,无需为此加吊销机制。

代码侧配套(目前都没有):
- `packages/sandbox/src/tenancy/types.ts:11-14` 的 `Company` 加
  `orgName?: string` 与 `orgNameStatus?: "auto" | "configured"`;
- `supabase-tenant-store.ts` 两处 `select("id,company_name")` → 补 `org_name,org_name_status`(:104, :127);
- **显示层统一走一个判定**(如 `displayOrgName(company)`:status 非 configured 即返回 undefined),
  避免每个调用点各判一次、漏一处就把占位串泄出去;
- **不可改**由应用层保证(DB 层不加触发器,避免给共享表增加副作用)。

待定(产品裁决,非技术阻塞):
- **谁分配**:平台分配 / 首次发布时自助认领(建议自助 + 唯一索引兜底冲突);
- **配置后能否再改**:建议一旦 `configured` 即冻结(它已进入包标识)。
- **文案**:`PUBLISH_NOT_AVAILABLE` 的说明需能区分两种成因 ——「该部署未接入发布身份」
  与「该公司尚未配置 org」。目前 pi-web 侧只有前者,接入时补后者。

## 2. 三个待决问题

### Q1 · 发布身份怎么给登录用户？

已倾向裁定（用户决策）：**云端托管** —— 登录即有发布身份。落到实现是两条路：

- **A. cloud 代持 admin，按需 provision**：cloud 用平台 admin token 调 `registerPublisher`
  为该用户/租户建 publisher，再签发一枚 scope=publish 的 HMAC token 给桌面。
  改动集中在 cloud，registry 只需新增一个 `HmacPublishTokenVerifier`。
- **B. registry 开自助注册面**：把 `registerPublisher` 的 admin 门换成"持有效租户凭据即可为
  自己建 publisher"。改动在 registry，语义面更大。

**建议 A**。理由：registry 的授权模型（"token 仅传输层，授权本体是验签"）是刻意设计的，
放宽 admin 门会侵蚀它；而 cloud 本来就是租户身份的权威，代持 admin 做 provision 是它的本分。

### Q2 · 密钥归谁持有？

这是**信任模型的分水岭**，不是实现细节：

| 方案 | 私钥位置 | 代价 |
|---|---|---|
| 云端代管代签 | 云端 | pi-web 最轻（永不碰私钥）；但"发布者身份由本地密钥证明"这条不再成立，验签退化为云端自证 |
| 每用户本机持钥 | 用户机器 | 追责到人，验签语义完整；多用户 web 部署发不了（只能桌面版），且要做备份/轮换 |

**已倾向裁定：云端代管代签。** 但有一条**必须记下的后果**：一旦云端代签，
`registry` 的"验签是发布授权本体"就变成"云端说是谁就是谁"。
建议在 registry 侧把这类 publisher 显式标记（如 `custodial: true`），
避免将来分不清哪些签名代表真实的本地密钥持有。

### Q3 · org / tenantId 应当**派生**而非接收（合并原 Q3+Q4）

既然 org ≡ tenant ≡ company 是同一身份的三种投影，那当前"两处自报 + 一处认证"的形态就是
把一个身份拆成了三份可被独立伪造的声明。**修法方向是收敛到单一可信来源**：

1. **`public.companies` 加 `org_name` + `org_name_status`**（见 §1.7/§1.8）：
   默认 `org-<uuid>` 占位、唯一索引、收窄字符集；`status=auto` 时不对外显示。
   不复用 `companies.code`（它是统一社会信用代码，语义不对且泄露业务标识）。
2. **publish token 携带 `companyId` 与 `org_name`**，`verifyPublish` 解析出
   `{ publisherId, tenantId, org }`。
3. **`createSource` 不再接收 `tenantId`**，改由 token 派生；
   `orgOf(input.id)` 必须等于 token 里的 `org`，否则 `ForbiddenError`。
4. `bindOrg` 的语义随之从「org → publisher」变为「org 天然属于该 company」——
   抢注问题**自动消失**，因为 org 不再是先到先得，而是身份的投影。

**这条建议先于发布功能落地**：`bindOrg` 不可逆，等有真实数据再改就要做迁移；
而在 org 派生未落地期间，任何"每租户一个 publisher"的上线都会持续产生错绑数据。

**过渡期可行的最小收紧**（若 `org_name` 的分配流程一时定不下来）：publish token 带 `tenantId`，
`createSource` 校验 `input.tenantId === ctx.tenantId`（admin 可覆盖）。
这挡不住 org 抢注，但能挡住可见性静默失灵那一类事故 —— 那是已经真实发生过的。

## 3. 接口缺口（按仓）

### 3.1 `pi-web` · 能力契约要加一档授予

`StaticCapabilitySnapshot` 定义在 **pi-web**（`packages/server/src/capability/types.ts:122`），
却由 **pi-clouds** 填充 —— 加 `publish` 授予**两侧必须同改**，且受 `HOST_CONTRACT_VERSION` 约束。

```ts
// 建议形状,与既有 sources 授予同构
readonly publish?: {
  readonly baseUrl: string;
  readonly token: string;      // scope=publish
  readonly publisherId: string; // 展示用:让用户看得见"以谁的身份发布"
  readonly expiresAt: number;
};
```

配套：`DesktopCapabilitiesClient` 加 `getPublishGrant()`，**失败语义与 `getSourcesGrant` 一致
（返回 `undefined` 而非抛）** —— 否则云端抖动会让整条命令崩而不是降级。

### 3.2 `apps/cloud` · 签发 publish 授予 + 按需 provision publisher

`buildDesktopCapabilities()` 增 `publish` 分支：
`signPublishToken(companyId, publisherId, org, …)`，并在首次为该租户/用户 provision publisher
（调 registry `registerPublisher`，携平台 admin token）。

**门控（§1.8 裁定）**：仅当 `org_name_status = 'configured'` 时才产出 `publish` 授予；
`auto` 一律省略该字段。这是"未配置 org 不允许发布"的**唯一落实点** —— 放在这里而不是
pi-web 侧，是因为 pi-web 无从得知公司的 org 状态，而云端本就是租户身份的权威。

fail-closed 沿用既有规矩：缺 secret / 缺 registry base → 省略 `publish` 字段（**不是**返回半个快照），
桌面据此走"未接入发布身份"的诚实降级 —— 这条 pi-web 侧**已经实现**（`PUBLISH_NOT_AVAILABLE`）。

### 3.3 `registry` · 三处

1. `HmacPublishTokenVerifier`：解析 cloud 签发的 publish token → `{publisherId, tenantId, admin:false}`；
   与既有 `CompositeTokenVerifier` 组合，不动 `StaticTokenVerifier`。
2. `createSource` 改为从 token 派生 `tenantId` 与 `org`，不再接收 `input.tenantId`；
   `orgOf(input.id) !== ctx.org` → `ForbiddenError`（Q3）。
3. `bindOrg` 语义随之调整（org 属 company，而非先到先得绑 publisher）。

### 3.4 `pi-web` · 发布链路补首次建源

`publish-orchestrator` 目前是 `compile → sign → uploadBundle → registerVersion → setChannel`，
**从不调 `createSource`**（全仓 grep 零命中）。两条路：

- 依赖 registry 的 `autoCreateSourceBySignature`（固定 `visibility: "org"`）——
  首次发布仍需平台预置 publisher 的 tenantId；
- 或显式调 `createSource`，那时才有位置让用户**选可见性**。

**若要"发布时选 public/org"，只能走后者。** 这是 UI 上"可见性选择"能否存在的前提。

## 4. 分期建议

| 期 | 内容 | 可独立验收 |
|---|---|---|
| **P0** | `companies.org_name` + `org_name_status` 迁移 + org、tenantId 改为从 token 派生 | 是 —— 迁移 + registry 侧收紧，**不可逆数据风险先消除** |
| **P1** | cloud 签发 publish 授予 + provision publisher；pi-web 契约加 `publish` 字段 | 是 —— pi-web 侧可用"授予存在但不真发布"验证链路 |
| **P2** | pi-web 打通 `uploadBundle → registerVersion → setChannel`（裸 `publish` 开始工作，语义不变） | 是 |
| **P3** | 可见性选择（含 `createSource`）与 UI 文案（**org ≠ 口语 private**） | 是 |

P0 建议**先做**：`bindOrg` 不可逆，等有真实数据再改就要做迁移。

## 5. 本稿未覆盖

- 密钥轮换与吊销的运营流程；
- `yank` / `deleteChannel` / `deleteSource` 在 web 端的暴露（本稿只谈发布）；
- 计费与配额。

## 附：与已交付部分的衔接

`pi-web` 侧 `publish-host-command` 已实现的部分，**在上述任一方案下都不需要返工**：
命令与子动作、参数位补全、kind 门（清单权威）、预览卡片、`PUBLISH_NOT_AVAILABLE` 降级。
云端就绪后，裸 `/agent publish <dir>` 从"诚实失败"直接变成"真正发布"，
**语义与文案都不用改** —— 这是当初把裸 publish 定义为"真发布意图"而非"预览"的原因。
