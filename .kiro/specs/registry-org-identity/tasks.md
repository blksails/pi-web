# Implementation Plan — registry-org-identity

> **两个仓**：
> - `BlackSail/supabase`（分支 `develop`）—— 迁移，因该仓拥有 `companies` 建表；
> - `agents/pi-clouds`（worktree `.claude/worktrees/registry-org-identity`，分支
>   `feat/registry-org-identity`）—— 类型、store、registry service 与全部测试。
>
> `pi-web` 零改动。

## Phase 1 · 迁移

- [x] 1.1 写迁移 —— ★ 落在 **`BlackSail/supabase`** 仓（该仓拥有 `companies` 建表），
  文件 `migrations/20260728000000_companies_org_name.sql`
  - `org_name`：`not null default ('org-' || replace(gen_random_uuid()::text,'-',''))`
    ★ **不能用裸 uuid** —— 有 10/16 概率数字起首，违反下面的字母起首约束
  - 唯一索引 `companies_org_name_key`
  - check `^[a-z][a-z0-9-]{1,38}$`（比 registry 字符集更窄，**收窄容易放宽难**）
  - `org_name_status`：`not null default 'auto' check in ('auto','configured')`
  - ~~存在性守卫~~ → 迁移归位到 `BlackSail/supabase` 后**不再需要**：该仓拥有 `companies`
    建表（`20251201173656_squash..sql:4119`），表必然存在。守卫只是"放错仓"的补丁
  - 注释写明：有意偏离「本仓不 ALTER companies」的惯例；volatile 默认值会触发
    **表重写 + ACCESS EXCLUSIVE 锁**
  - _Requirements: 1.1–1.6, 2.1, 2.2, 5.2, 5.3, 5.4_

- [x] 1.2 迁移验证（一次性 postgres 容器）
  - docker 起一个干净 postgres 17；手工建最小 `public.companies(id, company_name)`
    并塞几行；跑迁移
  - 断言：存量行获得**互不相同**的占位值且 `status='auto'`；**连跑两次结果一致**（幂等）；
    唯一冲突被拒；字符集违规被拒；既有列未变
  - 另跑一次「表不存在」的场景，确认守卫生效、迁移不报错
  - ⚠ **生产库只读，不跑任何 DDL**
  - _Requirements: 5.1, 6.4_
  - _Depends: 1.1_

## Phase 2 · 租户读写与显示

- [x] 2.1 `Company` 加字段 + `displayOrgName`
  - `packages/sandbox/src/tenancy/types.ts`：`orgName?` / `orgNameStatus?`（**可选**，
    避免改崩既有构造点与内存 fake）
  - `displayOrgName(c)`：**唯一显示判定**，非 `configured` 一律返回 `undefined`
  - _Requirements: 2.3, 2.4_

- [x] 2.2 store 补列
  - `packages/adapters-aliyun/src/supabase-tenant-store.ts` 两处
    `select("id,company_name")`（:104, :127）→ 补 `org_name,org_name_status`
  - 行 → `Company` 的映射补两个字段
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.1_

- [x] 2.3 单测
  - `displayOrgName`：`auto` → undefined／`configured` → 值／字段缺失 → undefined
  - store：select 含新列；映射正确
  - _Requirements: 6.1_
  - _Depends: 2.2_

## Phase 3 · registry 收紧

- [x] 3.1 `CallerContext` 加 `org?`
  - `packages/registry-client/src/types/api.ts`
  - 纯加法，此步后全量测试须仍绿
  - _Requirements: 4.1_

- [x] 3.2 `createSource` 改为派生
  - `tenantId` 取自 `ctx.tenantId`（缺失 → `ForbiddenError`）
  - `CreateSourceApiInput.tenantId` 必填 → 可选；**非 admin 传入即显式报错**
    （不静默忽略 —— 静默忽略正是本 spec 要消灭的"无声错位"）
  - `orgOf(input.id) !== ctx.org` 且非 admin → `ForbiddenError`，消息指出应用哪个 org 前缀
  - `bindOrg` 不动
  - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - _Depends: 3.1_

- [x] 3.3 批量修调用点（**47 处**，绝大多数是测试夹具）
  - ★ 注意区分：`service.createSource(token, input)` 受影响；
    `store.createSource(source)`（Store 端口，收完整 `Source` 实体）**不受影响**
  - 夹具统一给 ctx 带上 `tenantId`/`org`，而非到处塞 `tenantId` 入参
  - _Requirements: 4.2_
  - _Depends: 3.2_

- [x] 3.4 `autoCreateSourceBySignature` 接 ctx
  - `registry-service.ts:353` 把 `ctx` 传进去；`tenantId`/`org` 取自 ctx
  - **删除**"从 siblings 反推 tenantId"那段与它的首次发布显式失败
    （源码注释原话：「待(丙)落地后，本段推导应当整体删除」）
  - ⚠ **验签逻辑一行不改** —— 归属仍须"声明变成证明"
  - _Requirements: 4.2, 4.3_
  - _Depends: 3.2_

- [x] 3.5 单测
  - `createSource`：非 admin 传 `tenantId` → 显式报错；tenantId 取自 ctx；
    org 段不符 → `ForbiddenError`；admin 覆盖可用
  - `autoCreateSourceBySignature`：**首次发布不再失败**；tenantId/org 取自 ctx；
    验签行为逐条不变
  - **回归**：`visibleToConsumer`（public/org/private × 租户匹配）逐条不变
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 3.3, 3.4_

## Phase 4 · 终验

- [x] 4.1 全量回归
  - `pnpm -r run typecheck` + `pnpm -r run test`
  - 与基线比对：新红必须能归因到本次改动，既有红如实标注
  - 按 `verify-completion` 取新鲜证据后再宣称完成
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 1.2, 2.3, 3.5_

## 明确不做（随 P1/P2/P3）

- 云端签发 publish 授予、provision publisher；
- **Req 3 的门控接线**——本 spec 只交付到"状态位可被读出、语义明确"，
  真正的"未配置不给授予"落在 `buildDesktopCapabilities`，属 P1。**不假装闭环。**

## Implementation Notes

### 实施中被实测纠正的三处

1. **批量改夹具的正则互相踩踏**。先给 `publishTokens` 加 `tenantId`、再用通用正则删
   `tenantId:`，结果**把刚加的又删了**，还误删了 `seedBuiltinSource` 的合法入参与
   `consumeTokens` 里的租户。改为**上下文感知**:只删 `createSource(...)` 实参对象内的
   `tenantId`（按括号配对定位调用范围），其余一律不动。教训:跨语义同名字段不能靠正则区分。

2. **`seedBuiltinSource` 是生产代码,不是夹具**。它显式把内置源预置到 `platform` 租户 ——
   那正是「admin 显式覆盖」的典型运维用途。故改为用它**已在手的 `adminToken`** 建源
   （发版/移动 channel 仍用 publishToken）。若改成让根 publishToken 自带 tenantId，
   等于要求每个部署的 token 配置同步变更，影响面大得多。

3. **admin 跨租户用例的意图必须保留**。`admin-registry-http` 里那条「admin 能看到其他租户的
   private 源」原本靠 `pub` token 传 `tenantId: "t2"` 造数据。新模型下改走 admin 显式覆盖 ——
   意图不变，且顺带成为该运维路径的一次真实使用。

### 顺带修掉的既有缺口

`autoCreateSourceBySignature` 的「从 siblings 反推 tenantId」与它的首次发布死路
（`a first-time publisher must be provisioned by the platform`）**整体删除** ——
源码原注释写着「待 (丙) 落地后,本段推导应当整体删除」,本 spec 即那个 (丙) 的归属部分。
**验签逻辑一行未改**。

### 归属修正与 org_name 取值

- **迁移放错过仓**：初版落在 pi-clouds，经指出后移到 `BlackSail/supabase` ——
  `public.companies` 的建表在那里（`20251201173656_squash..sql:4119`），pi-clouds 只是消费方。
  移仓后**去掉了存在性守卫**（它只是"放错仓"的补丁），改用本仓风格并**重新完整复验**
  （改了风格与结构即是新文件，不能靠旧验证背书）。
- **`blksails` 拼写已确认**：与 `companies.code`（`BLACKSAIL`）不是大小写差异而是不同拼写，
  已向用户指出「一旦 configured 即进入包标识且不可改」，用户明确**按此拼写**。
  终态在容器上验过：`1 | 黑帆科技 | BLACKSAIL | blksails | configured`。
  ⚠ **生产库尚未执行任何 DDL/UPDATE**（用户选择"先只看，不执行"）。

### 证据（2026-07-28）

- 迁移:一次性 postgres 17 容器实证 —— 守卫（表不存在时跳过不报错）／存量行获互不相同占位值
  且 status=auto／**幂等**（连跑两次值不变）／唯一冲突、大写起首、数字起首、含点、非法 status
  五类违规全部被拒／既有列一字未动。**生产库全程只读,零 DDL。**
- `pnpm -r run typecheck`:**0 错误**
- sandbox **189/189** ✓；adapters-aliyun **78 通过/64 跳过** ✓；
  registry-server **216 通过/6 跳过** ✓；registry-client **224 通过 / 1 失败**
- ⚠ 唯一的红是 `registry-client/test/dist-exports.test.ts`（`publishConfig.access`
  期望 restricted 实为 public + `pnpm build` 失败）。已 `git stash` 回基线复跑,
  **基线同样红** ⇒ 既有失败,与本 spec 无关。
- ⚠ sandbox 曾出现 13 红,基线复跑为 **184/184 全绿** ⇒ 确认是我引入的,已定位为夹具传
  `tenantId`,修复后 189/189。**这条归因是靠基线比对做出的,不是靠猜。**
