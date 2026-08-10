# Design Document

## Overview

把设置页 Provider 面板顶部那份只读 provider 清单升级为可配置面：使用者逐个开关 provider 在
清单中的可见性，并为每个 provider 勾掉不想看到的模型。配置只作用于**展示出口**，执行路径
（工具调用、会话内已选模型）完全不受影响。

设计的核心是一条既有事实：装配层已经把展示与执行分离了。`lib/app/pi-handler.ts` 的
`listModelOptions` 是展示取数的唯一出口，被 `GET /api/config/models` 独家消费；工具侧走
`imageEntries()`，会话 spawn 期走 `catalog.get()` 快照。因此「仅隐藏」只需挂在展示出口做
后置过滤，无需触碰 `ModelCatalogService` 内部那套「彻底禁用」机制。

### Goals

- 清单里每个 provider（含内置注册档）可开关可见性，配置持久化。
- 每个 provider 可勾掉模型（黑名单式，默认全展示）。
- 全部展示消费面一致遵守配置。
- 未配置时行为与引入前**逐字节一致**（可机械验证：过滤函数返回入参同一引用）。

### Non-Goals

- 不新增 provider 的载入途径（网关实例仍只能由部署方经环境变量配置）。
- 不改动 `PI_WEB_HIDE_PROVIDERS` 的彻底禁用语义。
- 不接入云端下发的 provider 配置。
- 不提供 provider 凭据（`baseUrl` / `apiKey`）的界面编辑。

## Boundary Commitments

### This Spec Owns

- `providers` 配置域中新增的 `visibility` 字段及其校验。
- 可见性过滤纯函数（新文件），及其在两个展示出口的挂载。
- Provider 面板中可见性与模型清单的界面呈现与交互。

### Out of Boundary

- `packages/core/src/model-catalog/service.ts` —— **本 spec 不得修改**。彻底禁用语义
  （`hiddenProviders`）归 `multi-gateway-providers` Req 5 所有。这条是可机械检查的复查判据。
- provider 的注册与载入（`custom-provider-source.ts`、网关实例装配、`models.json` 解析）。
- 工具侧模型可用性判定（`imageEntries()` 的消费者）。
- 会话内已选模型的执行可用性。

### Allowed Dependencies

- 读：统一模型目录端点 `GET /api/config/models`（带筛选参数）产出的 `CatalogModel` 投影。
- 读：`providers` 配置域的持久化值。
- 依赖既有 widget 机制：`registerFieldRendererByKey` + 字段 `widget` 标记。

### Revalidation Triggers

- **新增展示消费面而不经 `listModelOptions` 或 `GET /sessions/:id/models`** → 该面会绕过
  可见性配置，须回到本设计补挂载点。
- `ModelOptions` / `CatalogQueryResult` 的 `{providers, models}` 双字段形态改变 → 过滤器需重写。
- 若将来「仅隐藏」被改判为「彻底禁用」→ 本设计的挂载层选择整体失效，须回到需求阶段。

## Architecture

### Existing Architecture Analysis

```
展示路径（本 spec 挂载）                    执行路径（本 spec 不碰）
─────────────────────────────              ──────────────────────────
GET /api/config/models                     AIGC 工具 → imageEntries()
  └→ listModelOptions (pi-handler:1446)    会话 spawn → catalog.get() 快照
       ├→ 零筛选 → chatOptions()
       └→ 带筛选 → query()
GET /sessions/:id/models
  └→ get_available_models (query-routes:271)

前端展示消费者（全部打 /api/config/models）：
  provider-registry-summary / aigc-model-toggles-field
  vision-model-select-field / model-select-field
```

既有的 `hiddenProviders`（`PI_WEB_HIDE_PROVIDERS`）在 `ModelCatalogService` **内部**生效，
覆盖 chat 与 image 两个命名空间，语义是彻底禁用。本设计的可见性过滤在其**外部**、更靠近出口，
两者层次分明、互不干扰。

### Architecture Pattern & Boundary Map

**模式：出口后置过滤（decorator over the seam）**。纯函数，无状态，不进服务内部。

```
配置域 providers.visibility ──读──→ 过滤器 applyVisibility*()
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        listModelOptions 出口                GET /sessions/:id/models 出口
                    │                                   │
                    ▼                                   ▼
            GET /api/config/models              会话内模型选择器
                    │
        ┌───────────┴───────────┬──────────────┬──────────────┐
        ▼                       ▼              ▼              ▼
provider-visibility      aigc-model-      vision-model-   model-select
  (本 spec 的 widget)     toggles          select
```

### Technology Stack

无新依赖。沿用：`zod`（配置域校验）、既有 widget 渲染机制、`vitest`（单测）、`playwright`（e2e）。

## File Structure Plan

### New Files

| 路径 | 职责 |
|------|------|
| `packages/core/src/model-catalog/visibility-filter.ts` | 可见性过滤纯函数；空配置直通（返回同一引用）；对 `{providers, models}` 形态泛型处理 |
| `packages/core/test/model-catalog/visibility-filter.test.ts` | 过滤器单测：空配置引用相等、隐藏 provider、隐藏模型、无效条目忽略、providers 列表随 models 收敛 |
| `packages/ui/test/config/provider-visibility-field.test.tsx` | widget 单测：取数带筛选参数、开关与勾选的值写回、筛选框、全勾掉的确认提示 |

### Modified Files

| 路径 | 改动 |
|------|------|
| `packages/protocol/src/config/domains/providers.ts` | 新增 `visibility` 字段的 zod schema 与 formSchema 条目（标 `widget: "providerVisibility"`） |
| `packages/ui/src/config/provider-registry-summary.tsx` | 由只读汇总升级为可配置 widget renderer：保留既有两次带参取数与来源分档，新增开关、模型清单、筛选 |
| `packages/ui/src/config/index.ts` | 导出新 renderer |
| `lib/settings/register-panels.ts` | `registerFieldRendererByKey("providerVisibility", …)` |
| `lib/app/pi-handler.ts` | `listModelOptions` 出口套用过滤器；读取 `providers.visibility` 配置 |
| `packages/core/src/http/routes/query-routes.ts` | `GET /sessions/:id/models` 出口套用过滤器 |

**明确不改**：`packages/core/src/model-catalog/service.ts`（边界承诺，复查机械判据）。

> **实施期修订（2026-08-07）**：上表在实施中被证明不完整，实际还需以下四处，理由见
> `tasks.md` 的 Implementation Notes：
>
> | 路径 | 为何设计阶段漏了 |
> |------|------------------|
> | `packages/server/src/host-assembly/custom-providers.ts` | 根包不依赖 `@blksails/pi-web-core`，`pi-handler.ts` 无法 deep-import core 子路径，必须经 server 转出 |
> | `packages/core/src/http/handler.types.ts` | 会话侧出口需要一条可选注入接缝 `readProviderVisibility` |
> | `packages/core/src/http/create-handler.ts` | 把该接缝传给 `makeModelsHandler` |
> | `packages/core/src/model-catalog/custom-provider-source.ts` | 配置读取加在已读同一份 `providers.json` 的模块内（其头注反对另建第二份数据源） |
>
> 另：`packages/ui/src/config/settings-shell.tsx` 需拆掉按 `panel.id` 特判挂载旧组件的分支，
> 且 `provider-registry-summary.tsx` 被**删除**而非原地改造——它是无 props 的展示组件，
> 与 widget 的 `FieldProps` 契约不兼容；保留它会让面板出现两份清单。

## System Flows

### 保存配置

1. 使用者在 Provider 面板开关某 provider 或勾掉某模型。
2. widget 把变更写入 `providers` 域的 `visibility` 值（本地表单态）。
3. 若变更会导致「当前默认 provider 被隐藏」或「某 provider 全部模型被勾掉」，界面在保存前要求确认。
4. 保存 → 配置域持久化 → 界面显示已保存。

### 查询模型（展示）

1. 任一展示消费者请求 `GET /api/config/models?output=…`。
2. `listModelOptions` 按既有规则取 `chatOptions()` 或 `query()`。
3. 读 `providers.visibility`；若为空 → **原样返回**（同一引用，字节兼容）。
4. 否则过滤：剔除 `hidden` 的 provider、剔除 `hiddenModels` 中的模型、按剩余 models 重算 `providers` 列表。

### 目录变化时

- 部署方侧新增模型 → 不在 `hiddenModels` 中 → 默认展示（Req 4.4）。
- 配置引用了已消失的 provider/模型 → 过滤按「剔除交集」实现，不存在的条目自然无效，整份配置继续工作（Req 7.4）。

## Requirements Traceability

| 需求 | 覆盖组件 / 决策 |
|------|----------------|
| 1.1, 1.2 | widget 沿用 `provider-registry-summary` 的两次带参取数与三档来源标注 |
| 1.3 | widget 取数失败态；配置值独立于取数，失败不影响已存配置 |
| 1.4 | 被隐藏的 provider 仍在**本面板内**列出（面板取数不经过滤器，过滤只作用于目录出口） |
| 2.1, 2.2 | `applyVisibility*()` 在 `listModelOptions` 出口生效 |
| 2.3 | `visibility` 以 providerId 为键，不区分来源档 |
| 2.4, 4.7 | 执行路径（`imageEntries()` / `catalog.get()`）不在挂载点内 |
| 2.5, 4.5 | widget 保存前确认交互 |
| 3.1 | widget 文案明示作用范围仅为展示 |
| 3.2 | 被 `PI_WEB_HIDE_PROVIDERS` 禁用者根本不进入目录产出，故不出现在面板 |
| 3.3 | 面板对「被自己隐藏」与「未启用」分别呈现 |
| 4.1, 4.2, 4.3, 4.4 | 黑名单式 `hiddenModels`；缺省即全展示 |
| 4.6 | widget 内模型名称筛选框 |
| 5.1, 5.2, 5.3, 5.4 | 复用既有配置域持久化与保存反馈；`visibility` 对全部来源档统一表达 |
| 6.1, 6.2, 6.3 | 两个展示出口全覆盖；过滤与类型筛选叠加（先筛选后过滤，互不覆盖） |
| 7.1 | 空配置返回同一引用 |
| 7.2 | 不改载入路径 |
| 7.3 | `service.ts` 不改 |
| 7.4 | 剔除式实现，无效条目自然忽略 |
| 7.5 | `providers` 域既有字段与行为不动 |

## Components and Interfaces

### Core / 过滤器

```ts
/** 单个 provider 的可见性配置(黑名单式;缺省即全展示)。 */
export interface ProviderVisibility {
  /** true = 从展示清单中隐藏该 provider(不影响工具与已有会话)。 */
  readonly hidden?: boolean;
  /** 被勾掉的模型 id 集合;不在此列的一律展示,含目录新增的模型。 */
  readonly hiddenModels?: readonly string[];
}

/** 以 provider id 为键。 */
export type ProviderVisibilityConfig = Readonly<Record<string, ProviderVisibility>>;

/** 空配置判据:无键,或全部键都既未 hidden 也无 hiddenModels。 */
export function isVisibilityEmpty(cfg: ProviderVisibilityConfig | undefined): boolean;

/**
 * 对 `{providers, models}` 形态的结果套用可见性过滤。
 * ★ 空配置时返回入参**同一引用**——这是 Req 7.1「零侵入」的机械判据。
 */
export function applyProviderVisibility<
  M extends { readonly provider: string; readonly id: string },
  R extends { readonly providers: readonly string[]; readonly models: readonly M[] },
>(result: R, cfg: ProviderVisibilityConfig | undefined): R;
```

`ModelOptions` 与 `CatalogQueryResult` 均满足该约束，故同一函数覆盖两个出口。

### Protocol / 配置域

`providers` 域新增：

```ts
const providerVisibilitySchema = z
  .object({
    hidden: z.boolean().optional(),
    hiddenModels: z.array(z.string()).optional(),
  })
  .passthrough();

// providersConfigBaseSchema 内新增
visibility: z.record(providerVisibilitySchema).default({}),
```

formSchema 新增字段（静态，**不得**在后端 enrich）：

```ts
{
  key: "visibility",
  kind: "object",
  widget: "providerVisibility",
  label: "Provider 与模型展示",
  description: "控制清单里出现哪些 provider 与模型;仅影响展示,不影响已有会话与工具。",
  required: false,
}
```

### UI / widget

`ProviderVisibilityField`（由 `provider-registry-summary.tsx` 升级而来）：

- 取数：沿用既有两次带参请求（`?output=text` 与 `?output=image`）后合并。
  ★ **不得**零参数调用——零筛选会走回旧 `chatOptions()`，不含自定义 provider 与图像目录，
  实测会让清单恒空。
- 渲染：provider 行（标识 / 来源徽章 / 模型数 / 可见性开关）→ 展开后逐模型勾选 + 名称筛选框。
- 值：读写 `visibility`，形态同上。
- 测试注入：仿既有 `__set*FetchImpl` / `__reset*Cache` 风格。

## Data Models

### Domain Model

`ProviderVisibility` 是一份**稀疏的否定式声明**：只记录被隐藏的东西。这使「默认全展示」
与「目录新增自动可见」成为结构性质，而非需要维护的同步逻辑。

### Physical Data Model

落在 `providers` 配置域既有持久化位置，与 `providers` 数组同一份文件、同一次保存。

```json
{
  "providers": [ /* 既有自定义条目,不动 */ ],
  "visibility": {
    "openrouter": { "hiddenModels": ["some-model-id"] },
    "sufy": { "hidden": true }
  }
}
```

## Error Handling

### Error Strategy

展示面故障一律降级为「看得见的失败」，不静默吞掉，也不影响已存配置。

### Error Categories and Responses

| 情形 | 响应 | 需求 |
|------|------|------|
| 目录取数失败 | widget 呈现可辨识的失败态，保留已存配置 | 1.3 |
| 持久化失败 | 明确报错并保留编辑内容 | 5.3 |
| 配置引用已消失的 provider/模型 | 静默忽略该条，其余照常 | 7.4 |
| 隐藏了默认 provider / 勾掉全部模型 | 保存前要求确认 | 2.5, 4.5 |

### Monitoring

沿用既有配置域保存与目录取数的日志命名空间，不新增。

## Testing Strategy

### 单元测试

- `visibility-filter.test.ts`
  - 空配置 → 返回**同一引用**（`toBe`，非 `toEqual`）——Req 7.1 的机械判据
  - `hidden: true` → 该 provider 及其全部模型从结果消失，`providers` 列表同步收敛
  - `hiddenModels` → 仅指定模型消失，同 provider 其余模型保留
  - 配置引用不存在的 provider/模型 → 结果与无该条配置时一致
  - 目录新增模型且不在 `hiddenModels` → 出现在结果中（Req 4.4）
- `providers` 域 schema 测试：`visibility` 缺省为 `{}`；非法形态被拒；既有字段行为不变

### 组件测试

- `provider-visibility-field.test.tsx`
  - 取数 URL **带** `output=` 参数（防零参数恒空的坑）
  - 开关与勾选正确写回 `visibility` 值
  - 名称筛选框收敛长列表
  - 隐藏默认 provider / 勾掉全部模型时出现确认

### 集成测试

- `GET /api/config/models` 在有/无 `visibility` 配置下的产出差异；无配置时与引入前一致
- `GET /sessions/:id/models` 同样遵守可见性配置

### E2E

沿用本仓 `/settings` e2e 范式（`[data-pi-settings-nav="…"]` / `[data-pi-field="…"]` /
保存按钮 / `已保存` 文案）：隐藏一个 provider 并保存 → 模型选择器中该 provider 消失 →
改回可见 → 恢复出现。

### 验证前置

改配置域后 **dev 必须重启**（handler 单例 pin 在 `globalThis`），否则改动不生效会被误判为实现错误。
