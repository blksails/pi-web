# 模型目录统一设计(model-catalog)— pre-spec 设计稿

> 状态:设计讨论稿(未立 spec)。触发:启用 ai-gateway providers 后,/settings
> 「默认 Provider」下拉与会话模型选择器出现数据污染与不一致(2026-07-18 实测)。
>
> 相关 spec:`specs/ai-gateway-providers/`(已实现合 main)、
> `.kiro/specs/aigc-tool-settings/`(模型开关)。

## 1. 触发缺陷(全部已实测复现)

启用 ai-gateway(`AI_GATEWAY_BASE_URL` 已配置,本地 blksails 网关 19 个模型)后:

**D1 — self provider 被整体吞并。** `GET /api/config/models` 返回
`providers: ['dashscope-token-plan', 'openai-compat', 'vercel-ai-gateway', 'volcengine']`,
agent 真实可用的 `apiservices`、`dashscope` 两个 provider 完全消失。根因:
`mergeModelCatalog`(`packages/server/src/ai-gateway/model-catalog.ts:147`)用**裸
`id`** 做同名判定,`byId.set(m.id, m)` 跨 provider 覆盖 —— 网关目录里的
`gpt-5.4`/`qwen3.7-max`/`deepseek-v3.2` 等与 self 目录的同 id 条目碰撞,precedence
默认 `gateway`,self 条目被逐个吞掉;当某 provider 的模型全部撞名时,该 provider
从 providers 列表整体蒸发。

**D2 — 网关内部渠道名被当成 provider。** 同一 merge 函数把网关 `/v1/models` 的
`owned_by`(`openai-compat`、`dashscope-token-plan`、`volcengine`——这些是网关的
**上游渠道名**,是 blksails ai-gateway 的内部实现细节)直接映射为 `provider` 字段,
流入「默认 Provider」下拉。用户若选中它写进 `settings.json` 的 `defaultProvider`,
agent 进程的 ModelRegistry 根本没有这个 provider,会话默认模型即坏。

**D3 — 设置页与会话选择器两套数据、语义不通。** 设置页下拉 =
`/api/config/models`(self ∪ gateway 聚合);会话内「模型」选择器 =
`/api/sessions/:id/models`(agent 进程 ModelRegistry `getAvailable()`,经 RPC)。
后者永远不含网关模型 —— 网关目录模型在设置页「可选」,但 agent 实际**用不了**
(ModelRegistry 无此 provider),选择是装饰性的。ai-gateway-providers spec 任务 4.2
的「按 source 分流」只落地了 source 徽章,浏览器侧没有(也不应有)直连 provider 的
请求路径(见该 spec tasks.md Tips 第 7 条:主对话请求构造权威在 agent 子进程)。

**D4 — AIGC 图像模型开关清单漏网关路由。** /settings「AIGC 图像」的模型开关来自
`GET /api/aigc/models` ← 静态 `AIGC_MODEL_CATALOG`
(`packages/tool-kit/src/aigc/model-catalog.ts`),没有并入
`AI_GATEWAY_IMAGE_ROUTES`(gpt-image-1 / gpt-image-2-ai-gateway / qwen-image)。
运行时工具真的能跑这三条路由(会话侧 `deriveActiveModels` 已并入 extraRoutes),
但设置页看不到、也**禁用不了** —— 正是 ai-gateway spec tips 里警告过的
「工具能跑但 UI 看不到」偏差,当时修了会话侧、漏了静态目录。

**D5 — 会话选择器噪音。** 会话选择器把 pi 内置 registry 里凡有 auth 的 provider
全量列出(截图里 `vercel-ai-gateway` 一组 200+ 条)。`PI_WEB_HIDE_PROVIDERS`
两个端点都已尊重(query-routes.ts:116),但运维要逐个发现、逐个加黑名单;且与
blksails ai-gateway 重名(`vercel-ai-gateway`)徒增混淆。

## 2. 现状盘点:五个消费面、四个数据源

| # | 消费面 | 端点/通道 | 数据源 | 现状问题 |
| --- | --- | --- | --- | --- |
| 1 | /settings 通用 · 默认 Provider/Model | `GET /api/config/models` | pi SDK `ModelRegistry.getAvailable()`(主进程,读 `<agentDir>/{auth,models}.json`)∪ 网关目录 merge | D1/D2/D3 |
| 2 | 会话内主对话「模型」选择器 | `GET /api/sessions/:id/models` | agent 子进程 ModelRegistry(RPC `get_available_models`) | D3/D5 |
| 3 | /settings AIGC 图像 · 模型开关 | `GET /api/aigc/models` | 静态 `AIGC_MODEL_CATALOG` | D4 |
| 4 | 会话内 AIGC 快捷设置(提示词栏) | state-bridge KV `aigc.models` | runner 内 `deriveActiveModels(disabled, extraRoutes)` | 正确(已含网关) |
| 5 | 视觉模型选择(image_vision 弹层) | `GET /api/vision/models` | `listVisionModelOptions`(models.json 过滤 input 含 image) | 未受影响,但属同族 |

四个数据源(主进程 ModelRegistry / 子进程 ModelRegistry / 网关目录 / 静态 AIGC
目录)各自演化,没有统一的 key、来源标记与「可用性」语义 —— 这是本设计要解决的
根本问题。

## 3. 设计目标

1. **一处权威**:server 侧一个模型目录服务,所有消费面从它取数;新增来源(未来
   的第二个网关、per-user 目录)只改一处。
2. **provider 语义纯净**:`provider` 字段只允许出现 agent 或 pi-web 真正建模过的
   provider 名;外部目录的内部分组(`owned_by`)是元数据,不是 provider。
3. **可用性显式化**:每个条目声明它在哪些场景可用(session 主对话 / 仅目录展示 /
   图像工具),UI 按可用性约束选择,杜绝「可选但不可用」。
4. **命名空间隔离**:对话模型(chat)与图像工具模型(image)是两个目录,不共享
   key 空间,各自的开关/选择器互不串扰。
5. **零破坏兼容**:现有三个端点的响应形状只增不改;未启用 ai-gateway 时输出与
   今天逐字节一致(延续 ai-gateway spec 的 Req 1.2 纪律)。

## 4. 统一数据模型

```ts
/** 目录条目的全局唯一 key = `${namespace}:${provider}/${id}` —— 永不使用裸 id。 */
interface CatalogEntry {
  /** 命名空间:主对话模型 vs 图像工具模型,两个独立目录。 */
  namespace: "chat" | "image";
  /** 语义纯净的 provider:self 条目 = agent 真实 provider 名;
   *  网关条目恒为 "ai-gateway"(单一 provider 面)。 */
  provider: string;
  id: string;
  name: string;
  source: "self" | "ai-gateway";
  /** 可用性:session = agent 进程当前可跑;catalog = 仅目录展示(未接线)。 */
  availability: "session" | "catalog";
  /** 展示/路由元数据,不参与身份判定。 */
  meta?: {
    /** 网关上游渠道名(原 owned_by),仅展示用二级分组。 */
    channel?: string;
    /** 图像条目:generation | edit 能力标记。 */
    imageCapability?: readonly ("generation" | "edit")[];
  };
}
```

要点:

- **key 修正(修 D1)**:同名判定 key 从裸 `id` 改为 `provider/id`。self 与
  gateway 条目 provider 必然不同("apiservices" vs "ai-gateway"),**永不互相
  吞并** —— `modelPrecedence`(gateway|self)的「同名取舍」语义随之收窄为
  **展示排序**(同 name 的条目谁排前面),不再做覆盖删除。`PI_WEB_AI_GATEWAY_
  MODEL_PRECEDENCE` env 保留、含义降级,文档同步。
- **provider 收敛(修 D2)**:网关条目 `provider: "ai-gateway"`,`owned_by` 降级
  进 `meta.channel`。设置页/选择器按 provider 分组时网关模型聚成一组
  「ai-gateway」,组内可按 channel 二级分组展示。
- **可用性(修 D3 的显式化前半)**:网关 chat 条目在 agent 未接线时
  `availability: "catalog"`;「默认 Provider/Model」下拉**只枚举
  `availability === "session"`** 的条目。catalog 条目仍可展示(带徽章 +
  「未接入会话」disabled 态),让用户知道网关有什么、并引导接线。

## 5. 目录服务与取数拓扑

```
                        ┌─ self-chat:   ModelRegistry.getAvailable()(主进程,现 listModelOptions)
ModelCatalogService ────┼─ gateway-chat: GatewayModelCatalog.get()(现有 TTL/fail-soft 不动)
  (packages/server/     ├─ self-image:  AIGC_MODEL_CATALOG(静态)
   src/model-catalog/)  └─ gateway-image: AI_GATEWAY_IMAGE_ROUTES 目录投影(env 条件)
        │
        ├─→ GET /api/config/models        (chat 全量;providers 仅列 session 可用)
        ├─→ GET /api/sessions/:id/models  (chat;子进程权威 ∪ catalog 条目标注,见 §6)
        ├─→ GET /api/aigc/models          (image 全量,修 D4)
        └─→ (vision/models 后续切片并入,本期不动)
```

- 服务是纯组装层:各源保持既有实现(TTL、fail-soft、hidden 过滤全部沿用),
  只是把 merge/标注/过滤逻辑从 `pi-handler.ts` 的闭包里抽成可单测的模块。
- `PI_WEB_HIDE_PROVIDERS` 在服务出口统一应用(三个端点同一名单,含
  `/api/aigc/models` —— 该端点今天不吃这个开关,属顺手补齐)。
- `AIGC_MODEL_CATALOG` 补上网关三条路由的静态条目(带 `source: "ai-gateway"`),
  端点按 `AI_GATEWAY_BASE_URL` 存在与否条件并入 —— 与 runner 侧 `extension.ts`
  的条件判据完全同一,消除两面漂移(修 D4)。注意 tool-kit 双入口纪律:静态目录
  文件仍零 env 读取,条件判断只在 server 端点层。

## 6. 会话可用性打通(P2,让网关 chat 模型真正可跑)

D3 的根治不是改 UI,而是把网关接成 agent 的真实 provider。落点在装配期
(`lib/app/pi-handler.ts` 会话创建路径),对 pi SDK 零改动:

- 生成 models.json 片段:provider `ai-gateway`,`api: "openai-completions"`
  (`meta.channel` 为 anthropic 的条目走 `anthropic-messages`),baseUrl 分两形态:
  - **本地 spawn**:直连 `${AI_GATEWAY_BASE_URL}/v1`,apiKey 引用
    `AI_GATEWAY_API_KEY`(env 已在 spawn 链路透传,本次 Chrome 实测已证);
  - **e2b/沙箱**:`${PI_AI_GATEWAY_BASE}/v1` + `PI_AI_GATEWAY_TOKEN`(scoped
    token 换钥,`computeAiGatewaySessionEnv` 既有机制,零新增)。
- 注入方式沿用「装配期写临时 models.json / 或经 runner option-mapper 合并」的
  既有接缝(与 sandbox-baked 镜像的 models.json 机制对齐,跨仓一致)。
- 打通后这些条目 `availability` 翻为 `"session"`,自动进入默认 Provider 下拉与
  会话选择器 —— **两个消费面的数据不一致就此消失**(会话选择器来自子进程
  ModelRegistry,注入后它自然列出 ai-gateway 组)。
- 开关:`PI_WEB_AI_GATEWAY_EXPOSE_TO_AGENT=1`(默认关)。网关模型进主对话涉及
  计费与配额,须运维显式打开;关闭时行为 = 本设计 P0/P1(仅目录展示)。

## 7. 分阶段交付

**P0 止血(bug 修,可独立先行,不等设计定稿):**
1. `mergeModelCatalog` key 改 `provider/id`,网关条目 provider 恒 `"ai-gateway"`、
   `owned_by` → `meta.channel`(修 D1/D2;单测补三种碰撞场景的不吞并断言)。
2. providerSelect(默认 Provider 下拉)只枚举 self 来源 provider;modelSelect 对
   `source: "ai-gateway"` 条目渲染 disabled + 「未接入会话」提示(修 D3 的 UI 面)。
3. `/api/aigc/models` 条件并入网关图像三条目(修 D4)。

**P1 目录服务收敛:** 抽 `ModelCatalogService`,三端点改从服务取数,统一
hidden 过滤与 source/availability 字段;`vision/models` 评估并入。

**P2 会话接线(独立 spec 切片):** §6 的 models.json 注入 + e2b token 形态 +
计费/配额联动(网关侧 sk-gw per-key 限额已有,pi-web 侧透传 429 标注已有)。

## 8. 开放问题

1. **重名展示折叠**:self `apiservices/gpt-5.4` 与网关 `ai-gateway/gpt-5.4` 是同一
   上游模型的两条通路。P0 后两条都展示(分组不同,不混淆),是否需要展示层
   「同名折叠 + 通路切换」待用户体验反馈再定。
2. **`vercel-ai-gateway` 命名混淆**:pi 内置 registry 的 vercel 网关与 blksails
   ai-gateway 重名度高。短期用 `PI_WEB_HIDE_PROVIDERS=vercel-ai-gateway` 隐藏;
   是否在 UI 给 blksails 网关一个展示别名(如「BlackSail 网关」)待定。
3. **图像目录要不要也从网关 `/v1/models` 动态发现**(而非静态三条):网关目录
   currently 不区分 chat/image 能力,需网关侧先在 `/v1/models` 暴露能力标记,
   属跨仓契约,记入 backlog。
