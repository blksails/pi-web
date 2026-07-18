# Research & Design Decisions — model-catalog

## Summary
- **Feature**: `model-catalog`
- **Discovery Scope**: Extension(existing system,integration-focused light discovery;全部现场勘察于 2026-07-18 会话内完成,证据为实际请求/代码读取)
- **Key Findings**:
  - `mergeModelCatalog`(packages/server/src/ai-gateway/model-catalog.ts:147)以裸 `id` 为 Map key,跨 provider 覆盖;实测启用网关后 self 的 `apiservices`/`dashscope` 两 provider 从 providers 列表整体消失(D1),网关 `owned_by` 渠道名(`openai-compat`/`dashscope-token-plan`/`volcengine`)冒充 provider(D2)。
  - 前端 `buildGroups`(model-select-field.tsx):providerSelect 只消费响应的 `providers` 数组;modelSelect 分组只消费 `models` 数组的 `provider` 字段——**两者解耦**,服务端把 `providers` 收敛为 self-only 即可零 UI 改动修复 R3.1。
  - `providers` 字段全仓仅 providerSelect 一个真实消费方(grep 证实,`enrich-settings-models.ts` 仅存在于注释中,文件不存在)。
  - `GET /api/aigc/models` ← 静态 `AIGC_MODEL_CATALOG`(tool-kit 主入口,零 env 读取);运行时网关图像路由并入发生在 runtime 层 `extension.ts`(env 判据 `AI_GATEWAY_BASE_URL`)。两面漂移即 D4。
  - 网关图像路由的有效路由键:gen 与 edit 两组同为 `gpt-image-1`/`gpt-image-2-ai-gateway`/`qwen-image`(gpt-image-2 经 extras.model 覆盖避开 NewAPI 同名键),gen∪edit 去重后 3 键。
  - `/api/sessions/:id/models`(query-routes.ts makeModelsHandler)已吃 `PI_WEB_HIDE_PROVIDERS`,与 /config/models 口径一致;`/api/aigc/models` 不吃——经需求评审判定图像命名空间**不应**吃该过滤(见 Decision 3)。

## Research Log

### D1/D2 根因与影响面
- **Context**: 启用 ai-gateway 后 /settings 默认 Provider 下拉只剩 `dashscope-token-plan`/`openai-compat`/`vercel-ai-gateway`/`volcengine`。
- **Sources Consulted**: 实际请求 `GET /api/config/models`(self 186 条 / gateway 19 条);model-catalog.ts / model-options.ts / pi-handler.ts 装配闭包源码。
- **Findings**: merge 的 `byId` Map 用裸 id;precedence=gateway 时 gateway 条目覆盖同 id self 条目并携带 `provider: ownedBy`;self provider 的模型全部撞 id 时该 provider 从 providers 列表蒸发。
- **Implications**: key 必须含 provider;gateway 条目 provider 必须收敛为常量 `"ai-gateway"`。

### 前端下拉的数据依赖拓扑
- **Context**: 判定 R3.1(providerSelect 只列会话可用 provider)的最小改动位置。
- **Findings**: `buildGroups(widget, data)`:providerSelect → `data.providers` 平铺;modelSelect → 按 `data.models[].provider` 分组。`triggerLabelFor` 对存量值缺失项原样显示(R3.3 已满足,零改动)。
- **Implications**: 服务端 `providers` = session 可用集合即可;modelSelect 的 ai-gateway 分组由 models 条目自然形成。UI 只需新增 disabled 渲染(R3.2)。

### AIGC 目录一致性机制
- **Context**: D4 修复要维持 tool-kit 双入口纪律。
- **Findings**: `AIGC_MODEL_CATALOG` 是纯静态声明层;既有防漂移 sync 断言在 `test/aigc/model-catalog.test.ts`;`AigcCatalogEntry.provider` 为字面量联合,需扩 `"ai-gateway"`。运行时禁用机制(disabledModels)对 extraRoutes 已生效(ai-gateway spec 任务 5.2 已验证),故设置页勾选禁用网关键即自然生效(R4.2 零新机制)。
- **Implications**: 新增平行静态组 `AI_GATEWAY_AIGC_CATALOG`(声明层,零 env);并入条件判断放 server 层(pi-handler 已有 `aiGwConfig` 判据,与 extension.ts 的 env 判据同源同语义)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 原地修 merge + 各端点分别补 | 只改 mergeModelCatalog 与 aigc-models-routes | 改动最小 | 取数口径仍散落 pi-handler 闭包,下个来源再抄一遍 | 仅满足 P0 |
| B. ModelCatalogService 统一组装(选定) | server 侧新模块统一 chat/image 目录组装与过滤,端点从服务取数 | 单一权威、可单测、来源可扩展 | 多一层间接 | P0 修复落在 merge 纯函数内,服务只做组装,风险可控 |
| C. 协议层新目录端点(v2) | 新端点新形状 | 语义最干净 | 破坏兼容,前端全改 | 违反 R5.4 只增不改,否决 |

## Design Decisions

### Decision 1: merge key 与 provider 收敛(修 D1/D2)
- **Context**: 裸 id 跨 provider 吞并 + owned_by 冒充 provider。
- **Alternatives Considered**:
  1. key 改 `provider/id`,gateway 条目保留 ownedBy 为 provider — 仍暴露渠道名,D2 不修。
  2. gateway 条目 provider 恒 `"ai-gateway"`,ownedBy 降级 `channel` 元数据,key `provider/id`(选定)。
- **Selected Approach**: 方案 2。self 与 gateway 的 provider 恒不同 → 天然零吞并;`modelPrecedence` 失去覆盖对象,语义收窄为 merged models 数组中 gateway 块与 self 块的排序先后(gateway=网关块在前)。
- **Trade-offs**: `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE` 行为变化(不再删条目)→ 属缺陷修复,文档同步即可。
- **Follow-up**: 更新 ai-gateway spec 的 merge 单测三冲突场景为「不吞并」断言。

### Decision 2: `providers` 字段语义 = 「可设为默认的 provider」(修 R3.1 零 UI 改动)
- **Context**: providerSelect 只消费 providers 数组。
- **Selected Approach**: 聚合后 `providers` 只含 self 来源 provider(不追加 `ai-gateway`);gateway 模型仍进 `models`(供 modelSelect 分组展示 + disabled)。
- **Rationale**: providerSelect 零改动即合规;形状不变(string[]),值修正属缺陷修复。
- **Trade-offs**: R6.2 的「至多新增 ai-gateway 一项」取零的一侧;`PI_WEB_HIDE_PROVIDERS=ai-gateway`(R5.3)仍按 models 的 provider 字段过滤,不依赖 providers 列表。

### Decision 3: 图像命名空间不吃 `PI_WEB_HIDE_PROVIDERS`(R5.2,修正设计稿初稿)
- **Context**: docs/model-catalog-design.md 初稿曾提议给 /api/aigc/models「顺手补齐」该过滤。
- **Findings**: 图像 provider(openrouter/newapi/sufy/dashscope)与对话 provider 同名不同物;部署现状 `PI_WEB_HIDE_PROVIDERS=openrouter` 若作用于图像清单,会隐藏 6 个 openrouter 图像模型而运行时工具照常注册 → 制造新的「工具能跑 UI 看不到」偏差(与 D4 同型)。
- **Selected Approach**: 图像清单不吃该过滤;requirements R5.2 已固化。设计稿该句已被本决定取代。

### Decision 4: availability 字段与会话选择器边界
- **Context**: R3.2/R3.4 —— 网关模型「可见不可选」,会话选择器不并入网关目录。
- **Selected Approach**: 聚合时 gateway 条目附 `availability: "catalog"`、self 条目附 `availability: "session"`(仅聚合形态出现,未启用时零字段);UI disabled 判据用 `availability === "catalog"`(而非 source,为 P2 打通后翻转留接缝:P2 把接线后的网关条目标为 session 即自动可选)。`/api/sessions/:id/models` 保持子进程权威,本 spec 不动其数据面。

## Risks
- ai-gateway spec 既有集成测试(`test/ai-gateway-route-mount*.integration.test.ts`、`packages/server/test/ai-gateway/model-catalog.test.ts`)对旧 merge 行为有断言,需同步改写——属预期变更,不是回归。
- `ModelOption` 新增可选字段经 protocol 无关(类型在 server 包本地),前端接口为结构性 JSON,只增字段零破坏(R5.4)。
