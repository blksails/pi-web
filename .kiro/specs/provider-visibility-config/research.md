# Research & Design Decisions

## Summary

轻量发现（Extension 类）。特性完全建立在 `multi-gateway-providers` 已落地的统一模型目录之上，
无新外部依赖、无新库，因此跳过技术验证，全部精力用于**定位注入接缝**与**避开本仓已知陷阱**。

三条发现直接决定了设计形态：

1. 展示面与执行面在装配层已经天然分离，**「仅隐藏」有一个干净的挂载点**，不必碰既有的
   彻底禁用机制。
2. 本仓配置 UI 是「静态 schema + 动态 values」，**后端 enrich formSchema 完全无效**——
   运行时动态选项只能走 widget + 数据端点 + 自定义 renderer。这条有明确的踩坑前科。
3. 要做的 widget 在本仓已有近乎同构的先例（`aigcModelToggles`），可直接照搬其形态与测试注入方式。

## Research Log

### 展示面 vs 执行面：「仅隐藏」该挂在哪一层

**调查**：追踪 `ModelCatalogService` 三个查询面（`chatOptions()` / `imageEntries()` / `query()`）的消费者。

**发现**：

- `lib/app/pi-handler.ts:1446` 的 `listModelOptions` 是装配层**唯一**出口，内部按「是否带筛选参数」
  二选一：零筛选 → `chatOptions()`（Req 10.1 的字节兼容承诺路径）；带筛选 → `query()`。
- 该出口被 `GET /api/config/models` **独家**消费，而前端四个展示消费者全部打这个端点：
  `provider-registry-summary.tsx`、`aigc-model-toggles-field.tsx`、`vision-model-select-field.tsx`、
  `model-select-field.tsx`。
- 工具与会话的执行路径不经过它：AIGC 工具侧走 `imageEntries()`，会话 spawn 期走
  `catalog.get()` 的同步快照（`pi-handler.ts:1193`）。
- 会话内模型选择器是另一条路：`GET /sessions/:id/models` → `get_available_models`
  （`packages/core/src/http/routes/query-routes.ts:271`），其注释明示它「与 /config/models 同样
  尊重 `PI_WEB_HIDE_PROVIDERS`」。

**影响**：把可见性过滤做成**展示出口的后置过滤**，挂在 `listModelOptions` 与
`/sessions/:id/models` 两处，就能同时满足「Req 6 全部展示面一致」与「Req 2.4 / 4.7 不影响
已有会话与工具」——因为执行路径压根不经过这两个出口。**不需要**、也**不应该**把新语义混进
`ModelCatalogService` 内部的 `hiddenProviders`（那是 Req 5 的彻底禁用，语义不同，混入会破坏
既有验收）。

### 配置 UI 的动态选项如何落地

**调查**：本仓设置页表单的渲染链路。

**发现**（与项目记忆一致，且有踩坑前科）：

- `lib/settings/register-panels.ts` 注册 panel 时把 `settingsFormSchema` **编译期静态绑定**。
- `packages/react/src/config/use-config-domain.ts` 的 `makeConfigDomainIO.load`
  **只返回 `json.values`，丢弃 `json.formSchema`**。
- 结论：在后端 `GET /config/:domain` 里 enrich formSchema（改 kind / 注入 enumOptions）**完全无效**。

**影响**：provider 清单与模型多选这类运行时数据，只能走
「schema 字段标 `widget` → 后端已有数据端点 → 前端 `registerFieldRendererByKey` 注册 renderer 自取数」。

### 可直接照搬的先例

**调查**：既有 widget 实现。

**发现**：`packages/ui/src/config/fields/aigc-model-toggles-field.tsx` 与本特性要做的东西**近乎同构**——
同样是「fetch `/api/config/models` → 按 provider 分组 → 渲染逐模型开关 → 值写回配置域」，
只是它固定 `?output=image` 且只管 AIGC 一侧。`lib/settings/register-panels.ts` 已注册 5 个
widget renderer（`extensionsKv` / `configFiles` / `providerSelect` / `modelSelect` / `logNamespaceToggles`）。

`provider-registry-summary.tsx` 本身也已经在做「两次取数（`output=text` + `output=image`）→ 合并 →
按来源分档」，它的头注还写明了取数**必须带筛选参数**的原因（零参数会走回旧 `chatOptions()`，
不含自定义 provider 与图像目录，实测会让清单恒空）。

**影响**：新 widget 直接继承这套取数与分档逻辑，**升级**而非并列 —— 避免同一份清单出现两套取数实现。

## Architecture Pattern Evaluation

| 方案 | 取舍 | 结论 |
|------|------|------|
| A. 新建独立配置域 `provider-visibility` | 语义独立，但要改「三处」（protocol domain + protocol index + server DOMAIN_SCHEMAS），且设置页多一个入口，与「自定义 Provider」割裂成两处配 provider | 否决 |
| B. 扩展既有 `providers` 域，新增一个 widget 字段 | 同一面板、同一域、同一次保存；只改 schema 一处；与既有 `enabled` 字段语义相邻 | **采用** |
| C. 复用既有 `providers` objectList，为内置 provider 也建条目 | `baseUrl` 是必填 URL，内置 provider 无从填写；且会把「使用者新增」与「部署方已配」两类混为一谈，破坏 Req 7.1 的来源标注 | 否决 |
| D. 过滤下沉进 `ModelCatalogService` 内部 | 与 Req 5「彻底禁用」共用一套机制，语义会被污染，且会波及工具侧 | 否决 |
| E. 过滤挂在展示出口（`listModelOptions` + `/sessions/:id/models`） | 执行路径不经过，天然满足「仅隐藏」；配置为空时可直通，保住字节兼容 | **采用** |

## Design Decisions

### Decision: 可见性过滤作用于展示出口，而非目录服务内部

**背景**：使用者选定「关掉 = 仅从清单隐藏」，与既有 `PI_WEB_HIDE_PROVIDERS` 的「彻底禁用」并存。

**决定**：新过滤只作用于 `listModelOptions` 与 `GET /sessions/:id/models` 两个展示出口，
`ModelCatalogService` 内部保持不变。

**理由**：两种语义若共用一套机制，必然互相污染；而装配层的展示/执行分离是既有事实，
沿用它比新造抽象更省。

**代价**：将来若新增展示消费面而未经这两个出口，会绕过可见性配置。以 Revalidation Trigger 形式记录。

### Decision: 黑名单式模型清单，配置为空即直通

**决定**：配置值只记录「被隐藏的」provider 与模型；空配置时过滤函数原样返回入参对象（同一引用）。

**理由**：Req 7.1 要求未配置时结果与引入前一致；返回同一引用可让「零侵入」成为可机械验证的判据
（对象引用相等），而不是靠肉眼比对字段。

### Decision: 升级 `provider-registry-summary` 为可配置 widget，而非新增并列组件

**决定**：把既有只读汇总组件改造为 widget renderer，保留其取数与来源分档逻辑。

**理由**：该组件的取数带着一条硬约束（必须带筛选参数，否则清单恒空，已实测复现）。
另起一份实现意味着这条约束要被重新发现一次。

## Risks & Mitigations

| 风险 | 后果 | 缓解 |
|------|------|------|
| 误把过滤下沉到目录服务内部 | 破坏 Req 5 彻底禁用语义，且工具侧被误伤 | 设计已明确 Out of Boundary；复查时以「`service.ts` 是否被改」为机械判据 |
| 新 widget 零参数调用 `/api/config/models` | 清单恒空（已实测复现的坑） | 沿用既有组件的两次带参取数；测试断言请求 URL 带 `output=` |
| 后端 enrich formSchema | 白写，前端不消费 | 设计已写死走 widget 路径；复查以「是否改了后端 formSchema 注入」为判据 |
| 配置引用了已消失的 provider/模型 | 整份配置失效 | Req 7.4 要求忽略无效条目继续工作；过滤实现按「取交集」而非「按配置查表」 |
| 改配置域后 dev 未重启 | 表现为改动不生效，浪费排查时间 | 验证步骤明确要求重启 dev（handler 单例 pin 在 globalThis） |

## References

- `multi-gateway-providers` spec（本特性的基线，勿重复其能力）
- `packages/ui/src/config/fields/aigc-model-toggles-field.tsx`（同构先例）
- `packages/ui/src/config/provider-registry-summary.tsx`（被升级对象，头注含取数硬约束）
- `lib/app/pi-handler.ts:1446` `listModelOptions`（展示出口）
- `packages/core/src/http/routes/query-routes.ts:271` `GET /sessions/:id/models`
- 项目记忆：配置 UI 静态 schema + 动态 widget；新 config 域改三处；改配置域后需重启 dev
