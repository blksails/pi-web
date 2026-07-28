# Design Document — registry-org-identity

## Overview

三件事，都在 `pi-clouds`：

1. **数据**：`public.companies` 加 `org_name`（默认 `org-<uuid>` 占位、唯一、收窄字符集）与
   `org_name_status`（`auto` | `configured`）；
2. **读写与显示**：`Company` 类型与租户 store 补这两列；显示判定收敛为**单一函数**；
3. **收紧**：registry 的 `CallerContext` 承载 `org`，建源路径的 `tenantId` 与 `org`
   **一律从认证上下文派生**，不再接受调用方自报。

`pi-web` **零改动**。

## Steering Alignment

- 迁移沿用本仓既有形态：幂等（`if not exists`）、注释写明为什么这么做。
- 与 `tenant-company-authority` 对齐：`companyId` 的权威是 `profiles.company_id`，本设计
  **不另立判定**，只消费。
- 与 registry 的既有裁断对齐：「token 仅传输层，授权本体是验签」——
  本设计不改验签，只把**归属数据**从声明变成派生。

## 现状（勘察实证）

| 事实 | 位置 | 对设计的约束 |
|---|---|---|
| `public.companies` 是共享 CRM 表，本仓迁移**从不 ALTER 它** | `20260708100000_pi_clouds_tenancy.sql:9`；全仓 `ALTER TABLE companies` 零命中 | 加列是**有意偏离**，须在迁移注释写明 |
| `service_role` 已有 `select/insert/update` | 同上 | 不需新增授权 |
| `companies.code` 唯一但取值是统一社会信用代码 | 生产库 31 家实测 | **不复用**，另起 `org_name` |
| PG **17.8**，`gen_random_uuid()` 内置 | 生产库实测 | 默认值可直接用，无需 pgcrypto |
| `Company` 只有 `id`/`name` | `sandbox/src/tenancy/types.ts:11-14` | 需加两个可选字段 |
| store 两处 `select("id,company_name")` | `supabase-tenant-store.ts:104,127` | 需补列，否则新字段永远读不到 |
| `CallerContext` **已有** `tenantId?`，无 `org` | `registry-client/src/types/api.ts:17-24` | 只需加 `org?` |
| `registerVersion` 持有 `ctx`，但调 `autoCreateSourceBySignature` **不传** | `registry-service.ts:341, 353` | 传进去即可用派生值，见决策 4 |

## Architecture

```
CRM companies 表
  + org_name         (default 'org-<uuid>', unique, 收窄字符集)
  + org_name_status  (auto | configured)
        │
        ├─► SupabaseRestTenantStore.select(… , org_name, org_name_status)
        │        └─► Company { orgName?, orgNameStatus? }
        │                └─► displayOrgName(company)  ← 唯一显示判定
        │
        └─► (P1) buildDesktopCapabilities: status==='configured' 才给 publish 授予
                     └─► publish token 携带 {companyId, org}
                              │
registry ─────────────────────┘
  CallerContext { publisherId, tenantId, org, admin }
        │
   createSource / autoCreateSourceBySignature
        ├─ tenantId  ← ctx（不再取 input）
        └─ orgOf(id) 必须 === ctx.org，否则 ForbiddenError
```

## Components and Interfaces

### 决策 1：迁移落在 **`BlackSail/supabase`**，不在 pi-clouds

★ **归属修正（勘察后确认）**：`public.companies` 的建表就在 `BlackSail/supabase` 仓
（`migrations/20251201173656_squash..sql:4119`），pi-clouds 只是消费方。故迁移归该仓：

```
BlackSail/supabase/migrations/20260728000000_companies_org_name.sql
```

**放对仓带来一处实质简化**：早先草案必须包
`do $$ … if exists(information_schema.tables …) $$` 守卫 —— 那只因 pi-clouds **不拥有**该表、
本地实例上表不存在会让 `db reset` 崩。该仓拥有此表，**守卫是多余的**，已去掉，
并改用本仓风格（大写关键字、引号标识符）。

```sql
-- <ts>_pi_clouds_company_org_name.sql
-- ★ 有意偏离:本仓此前不 ALTER 共享 CRM 表 public.companies(见 20260708100000 注释)。
--   org_name 是 registry 的 org 命名空间,与 company 一一对应,故按裁定直接落在该表。
--   实测环境 PostgreSQL 17.8,gen_random_uuid() 内置。
--
execute $mig$
alter table public.companies
  add column if not exists org_name text
    not null
    default ('org-' || replace(gen_random_uuid()::text, '-', ''));

create unique index if not exists companies_org_name_key
  on public.companies (org_name);

alter table public.companies drop constraint if exists companies_org_name_chk;
alter table public.companies
  add constraint companies_org_name_chk
  check (org_name ~ '^[a-z][a-z0-9-]{1,38}$');

alter table public.companies
  add column if not exists org_name_status text
    not null default 'auto'
    check (org_name_status in ('auto', 'configured'));

comment on column public.companies.org_name is '…';
comment on column public.companies.org_name_status is '…';
$mig$;
end $$;
```

（早先草案用 `do $$ … execute $mig$ … $mig$` 是为了绕开"表可能不存在"；迁移归位后不再需要，
最终版是直白的 `ALTER TABLE`。）

三处不可省的裁断：

- **默认值形态 `org-<32hex>` 而非裸 uuid**：裸 uuid 有 10/16 概率以**数字**起首，
  违反下面"字母起首"的约束 —— 直接用会当场失败（已在生产库验证 `org-…` 形态通过）。
  前缀还让人一眼看出这是系统占位。
- **字符集比 registry 更窄**（`^[a-z][a-z0-9-]{1,38}$` vs `^[A-Za-z0-9][A-Za-z0-9._-]*$`）：
  禁大小写歧义、禁 `.`（包标识里另有含义）、上限 39 对齐 GitHub org。
  **收窄容易放宽难** —— 放宽不让存量失效，收窄会。
- **volatile 默认值 ⇒ 表重写 + ACCESS EXCLUSIVE 锁**。31 行可忽略，但**必须在注释里写明**，
  别让人以为是"秒级无锁加列"。

### 决策 2：显示判定收敛为单一函数

```ts
// packages/sandbox/src/tenancy/types.ts
export interface Company {
  readonly id: string;
  readonly name: string;
  readonly orgName?: string;
  readonly orgNameStatus?: "auto" | "configured";
}

/**
 * 对外可展示的 org 标识。**唯一判定点**——各调用点不得自行比较 status,
 * 漏判一处就会把 `org-2ed0…` 这串系统占位摆给用户看。
 */
export function displayOrgName(c: Pick<Company, "orgName" | "orgNameStatus">): string | undefined {
  return c.orgNameStatus === "configured" ? c.orgName : undefined;
}
```

字段做成**可选**是刻意的：`Company` 有内存 fake 实现与既有构造点，必填会一次性改崩它们，
而本 spec 的边界不含"让所有构造点都提供 org"。缺失即按 `auto` 处理（`displayOrgName` 返回
`undefined`），是安全的默认方向。

### 决策 3：`CallerContext` 加 `org`，建源改为派生

```ts
export interface CallerContext {
  readonly publisherId?: string;
  readonly tenantId?: string;
  /** 发布面 org 命名空间(= 公司的 org_name)。归属判定的权威来源。 */
  readonly org?: string;
  readonly admin?: boolean;
}
```

`createSource` 的改动：

1. `CreateSourceApiInput.tenantId` 由**必填**改为**可选**，且**非 admin 传入即显式报错**
   —— 不静默忽略。静默忽略会让调用方以为自己指定的租户生效了，而实际被换掉，
   那正是本 spec 要消灭的那类"无声错位"。
2. `tenantId` 取自 `ctx.tenantId`（admin 显式传入时用传入值）；缺失 → `ForbiddenError`。
3. `orgOf(input.id)` 必须 `=== ctx.org`（admin 豁免）；不符 → `ForbiddenError`，
   消息指出应使用哪个 org 前缀。
4. `bindOrg` 保留不动 —— org 既已由身份派生，"先到先得"的抢注面自然消失，
   它退化为一致性记录。

### 决策 4：顺带修掉 `autoCreateSourceBySignature` 的首次发布死路

现状：该方法**不接收 ctx**（`registry-service.ts:353`），只好从"该 publisher 已有 source"
反推 tenantId，因而**首次发布必然失败**：

> `a first-time publisher must be provisioned by the platform before auto-registering a source`

把 `ctx` 传进去后，`tenantId` 与 `org` 直接取自认证上下文，那段反推与它的显式失败**整体删除**
（源码注释原话：「待(丙)落地后，本段推导应当整体删除」—— 本设计即是那个"丙"的归属部分）。

⚠ 该方法的验签逻辑**一行不改**：归属仍需"声明变成证明"，只是 tenantId/org 不再靠反推。

### 决策 5：Req 3（未配置不允许发布）本 spec 只交付到"可读"

发布授予本身属 P1，尚不存在。本 spec 交付：store 能读出 `org_name_status`、
`Company` 承载它、有单一判定函数。**门控接线随 P1 落地**，任务里显式标注，不假装闭环。

## Data Models

`public.companies` 加两列（见决策 1）。无其它持久化变更。

## Error Handling

- 迁移幂等：`if not exists` / `drop constraint if exists`，可重复执行。
- 建源拒绝一律 `ForbiddenError` 且**带可操作信息**（应使用哪个 org / 谁能覆盖），
  不给含糊的 403。
- `displayOrgName` 对缺失字段 fail-safe 返回 `undefined`（宁可不显示，不可误显示占位）。

## Testing Strategy

| 层 | 覆盖 |
|---|---|
| 迁移 · 真实 DB | 幂等（连跑两次结果一致）；存量行获得互不相同占位值且 `status='auto'`；唯一冲突被拒；字符集违规被拒；**既有列未被修改** |
| 单测 · `displayOrgName` | `auto` → undefined；`configured` → 值；字段缺失 → undefined |
| 单测 · store | select 语句含新列；返回对象映射到 `orgName`/`orgNameStatus` |
| 单测 · `createSource` | 非 admin 传 `tenantId` → 显式报错；tenantId 取自 ctx；org 段不符 → `ForbiddenError`；admin 覆盖可用 |
| 单测 · `autoCreateSourceBySignature` | 首次发布**不再失败**；tenantId/org 取自 ctx；**验签行为逐条不变** |
| 回归 | 消费面 `visibleToConsumer`（public/org/private × 租户匹配）行为**逐条不变** |

## Open Questions（实现阶段裁定）

1. ~~迁移在哪验~~ → **已裁定**：docker 可用，但**本地 Supabase 没有 `public.companies`**
   （它是 CRM 表，不由本仓迁移创建），故本地 reset 只能验证"守卫生效、不报错"，
   **验不了加列本身**。方案：用一个**独立的一次性 postgres 容器**，先手工建一张最小
   `public.companies`（只需 `id`/`company_name`），再跑本迁移验幂等与约束。
   生产库**只读，不跑任何 DDL**。
2. ~~`CreateSourceApiInput.tenantId` 调用点~~ → **已实测**：service/API 级调用点 **47 处**
   （绝大多数在测试夹具里），与 `store.createSource(source)`（Store 端口，收完整 `Source` 实体）
   **是两个不同的方法**，后者不受影响。改动面比预想大，任务里按"先改类型 → 批量修夹具"拆开。
