# Requirements Document

## Project Description (Input)

把 registry 的 **org 命名空间**收敛为公司身份的投影：新增 `companies.org_name` 与
`org_name_status`，并让 registry 的 `org` 与 `tenantId` **从认证身份派生**，不再接受调用方自报。

> 本 spec 是 `docs/registry-publish-identity-design.md` 的 **P0**。
> 该稿的 P1（云端签发 publish 授予）、P2（打通真实发布）、P3（可见性选择）**不在本 spec**，
> 各自另立。P0 先做的理由见下方"为什么先做这个"。

**跨仓**：任务分布在两个仓，逐任务标注。
- `pi-clouds`：迁移、租户读写、registry service 收紧
- `pi-web`：无 —— 本 spec 对 pi-web **零改动**（这正是它可以独立推进的原因）

### 为什么先做这个

`createSource` 里 `bindOrg(org, publisherId)` **不可逆**（源码注释明写）。一旦"登录即有发布身份"
上线，每一次错绑都会沉淀成改不动的数据。而当前的绑定依据全是自报的：

| 事实 | 怎么来的 | 可信吗 |
|---|---|---|
| `orgOf(sourceId)` | 从调用方传的 sourceId 里切出来 | ❌ |
| `source.tenantId` | `CreateSourceApiInput.tenantId`，调用方自报 | ❌ |
| `publisherId` | `verifyPublish(token)` | ✅ |

两类真实后果：**org 抢注**（B 公司可占 A 公司的命名空间），以及**可见性静默失灵** ——
后者已真实发生过，`registry-service.ts` 的注释记着「真机撞到的 `tenant_id=e2e` 导致 install 不可见」，
且**全程不报错**。

### 已确认的现状（读源码 + 查生产库实证）

- `public.companies` 是**共享 CRM 表**；`supabase/migrations/20260708100000_pi_clouds_tenancy.sql:9`
  明写「此 migration **不建表**」，全部迁移中 `ALTER TABLE ... companies` **零命中**。
  本 spec 加列是**对该惯例的有意偏离**（已裁定）。
- `service_role` 对该表**已有** `select/insert/update` 权限（同上迁移），不需新增授权。
- `companies.code` 存在且唯一（`CREATE UNIQUE INDEX companies_code`，★ 由**独立唯一索引**实现，
  不在 `pg_constraint` 里），但取值多为**统一社会信用代码**（生产库 31 家实测：
  `91430104MAD98P553K`、`BLACKSAIL`），**不适合当 org 段** —— 难读，且把业务标识泄露给
  所有能看到 public 包的人。故**不复用 code**。
- 生产环境 PostgreSQL **17.8**，`gen_random_uuid()` 内置（无需 pgcrypto）。
- `registry` 的 sourceId 段字符集为 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（`online-source-id.ts`）。

### 与既有 spec 的关系

`pi-clouds` 的 `tenant-company-authority` 把「用户当前属于哪个企业」的权威收敛到
`profiles.company_id`。本 spec 取 `companyId` **必须走同一权威**，不得另立判定。
注意两者边界取舍不同：那个 spec 明确「Supabase 表结构不改」，本 spec **要改**（加两列）。

## Introduction

本特性让 registry 的归属数据成为**认证身份的投影**而非调用方声明：公司获得一个稳定、唯一、
人可读的 `org_name`，publish 面的 `org` 与 `tenantId` 一律从 token 派生并强制校验。
配套一个状态位，把"系统占位"与"用户已配置"分开，未配置者既不显示 org 也不允许发布。

## Boundary Context

- **In scope**
  - `companies` 加 `org_name`（默认 `org-<uuid>` 占位、唯一、收窄字符集）与
    `org_name_status`（`auto` | `configured`）；
  - `Company` 类型与租户读写补这两个字段；显示层统一判定；
  - `createSource` 改为从认证上下文派生 `org` 与 `tenantId`，不再接收 `input.tenantId`；
  - `CallerContext` 承载 `tenantId` / `org` 所需的类型与校验；
  - 相关单测与迁移验证。
- **Out of scope**
  - 云端签发 publish 授予、provision publisher（设计稿 P1）；
  - pi-web 打通真实发布（P2）；可见性选择 UI（P3）；
  - 密钥归属、轮换、吊销；
  - `companies` 表的其它列与 CRM 侧的任何行为；
  - `tenant-company-authority` 的既有裁决 —— 只对齐，不重做。
- **Adjacent expectations**
  - 本 spec 落地后，`org_name_status = 'auto'` 的公司**仍无法发布**（本就发不了，因为 P1 未做）；
    差别是：P1 上线时门控已经就位，不需要再补。
  - 占位 uuid **永远不会进入任何包标识** —— 这是状态位同时管发布带来的性质，不是巧合。

## Requirements

### Requirement 1：公司获得 org 命名空间

**Objective:** As a 平台运维者, I want 每家公司有一个稳定唯一的 org 标识, so that registry 的包
命名空间有可派生的权威来源，而不是靠调用方自报。

#### Acceptance Criteria

1. The `companies` 表 shall 具备一个**全局唯一**的 org 标识列，任意两家公司不得取同值。
2. The org 标识 shall 有默认值，使存量与新建公司都无需人工干预即满足非空与唯一。
3. The 默认值 shall 一眼可辨为**系统占位**，而非某人起的名字。
4. The org 标识 shall 满足比 registry sourceId 段**更窄**的字符集约束（小写起首、不含易混字符），
   使其可安全用作包标识首段。
5. If 试图写入不满足该字符集的值, then the 数据库 shall 拒绝写入，而不是留待应用层发现。
6. The 迁移 shall 幂等（可重复执行）。

### Requirement 2：区分"系统占位"与"用户已配置"

**Objective:** As a 用户, I want 未配置时不被展示一串占位字符, so that 我不会把系统占位误认成
我的 org 标识。

#### Acceptance Criteria

1. The `companies` 表 shall 具备一个状态位，取值仅限「系统占位」与「用户已配置」两种。
2. The 状态位 shall 默认为「系统占位」。
3. While 状态为「系统占位」, the 任何对外展示面 shall 不显示 org 标识，而是呈现"尚未配置"。
4. The 显示判定 shall 收敛在**单一函数**，不由各调用点各自判断
   （漏判一处即把占位串泄露给用户）。
5. The 状态 shall 单向推进（占位 → 已配置），不可回退。

### Requirement 3：未配置 org 的公司不允许发布

**Objective:** As a 平台运维者, I want 未配置 org 前无法发布, so that 占位标识永远不会写进
任何已发布包的永久标识。

#### Acceptance Criteria

1. While 公司状态为「系统占位」, the 云端能力面 shall 不产出发布授予
   （与既有 egress 未配置时省略该字段同一手法）。
2. The 门控 shall 落在**云端**，而非客户端 —— 客户端无从得知公司的 org 状态。
3. When 客户端因此拿不到发布授予, the 既有的诚实降级 shall 生效，且其说明 shall 能与
   「该部署未接入发布身份」区分开。

> ⚠ 本需求的**验收依赖 P1**（发布授予本身尚未实现）。本 spec 内只交付到
> "状态位可被云端读取且语义明确"，门控的接线随 P1 落地。此点在任务里显式标注，不假装已闭环。

### Requirement 4：org 与 tenantId 从认证身份派生

**Objective:** As a 平台运维者, I want 归属数据不再接受调用方自报, so that org 抢注与
可见性静默失灵这两类事故从结构上消失。

#### Acceptance Criteria

1. The 发布面认证上下文 shall 携带调用方的租户标识与 org 标识。
2. The 建源接口 shall **不再接收**调用方传入的租户标识，改由认证上下文派生。
3. If 待建源标识的 org 段与认证上下文的 org 不一致, then the 服务 shall 拒绝并说明原因，
   不得静默接受。
4. The org 与 publisher 的绑定 shall 与公司身份一致，不再是"先到先得"。
5. Where 调用方为平台管理员, the 服务 shall 允许显式覆盖上述派生（运维必需），
   且该覆盖 shall 可与普通路径区分。
6. The 既有消费面判定（可见性、按租户过滤）shall 行为不变。

### Requirement 5：存量数据的处置

**Objective:** As a 平台运维者, I want 迁移不破坏任何既有数据, so that 上线无需停机也无需回填。

#### Acceptance Criteria

1. When 迁移执行, the 存量公司 shall 全部获得互不相同的占位 org 标识，且状态为「系统占位」。
2. The 迁移 shall 不修改 `companies` 表的任何既有列。
3. The 迁移 shall 不依赖 CRM 侧的任何配合改动。
4. The 迁移执行者 shall 事先知晓其锁级别与是否触发表重写（默认值为 volatile 时二者都会发生），
   并在迁移注释中写明。

### Requirement 6：验证

**Objective:** As a 维护者, I want 这套收紧有可执行证据, so that "自报被挡住了"不是靠替身证明。

#### Acceptance Criteria

1. The 测试套件 shall 覆盖：唯一性冲突被拒、字符集违规被拒、默认值形态合规、状态位默认与单向性。
2. The 测试套件 shall 覆盖建源接口的派生行为：org 段不符被拒、租户标识不再取自入参、
   管理员覆盖路径可用。
3. The 测试套件 shall 断言既有消费面判定（可见性/租户过滤）**行为逐条不变**。
4. The 迁移 shall 在真实数据库上验证幂等（连续执行两次结果一致）。
