# Gap Analysis — canvas-vision-readout

> 所有结论由本仓源码与 `node_modules` 真实 `.d.ts` 核实，非推测。
> 本轮 gap 分析**推翻了初始描述中的一个事实错误**，并**删除了两条不可达需求**。

---

## 1. 被推翻的假设（最重要）

### 1.1 「Canvas 模型清单看不到内置模型」—— **错误，已撤回**

初始描述声称：只读端点读 `models.json`，故凭据来自环境变量的内置模型（openrouter 等）不会出现。

**事实**：server 侧早已有 `packages/server/src/config/model-options.ts:31-36`：

```ts
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
const models = registry.getAvailable().map(...)
```

即 server 进程内可直接使用 pi SDK 的 `ModelRegistry`，其 `getAvailable()` = `models.filter(hasConfiguredAuth)`
—— 与 `image_vision` 工具弹层的候选**完全同源**（`tool-kit/src/vision/select-model.ts:35`）。

⇒ 只需追加 `input.includes("image")` 过滤。**不存在清单缺失**。requirements 的
Adjacent expectations 已据此改写为「两处候选同源」。

### 1.2 「无当前工作图」分支 —— **不可达，需求已删**

`current = assets.find(...) ?? asset`（`canvas-workbench.tsx:649-652`），`currentId` 初值
`asset.attachmentId`（`:537`），而 `GalleryAsset.attachmentId` 是必填 string。
工作台是「打开某张图之后」的界面，无图态在 gallery / launcher 层。

⇒ 原 R1.4「无图时禁用按钮」不可实现也不可测，已删除。

### 1.3 「提交后清空输入框」—— **与既有行为冲突，需求已反转**

`generate()`（`:825-992`）全程**没有** `setPrompt("")`。`setPrompt` 只出现在 onChange（`:1762`）、
@ 选中去尾（`:1789`）、版本条切图预填（`:1000`）。

⇒ 用户裁定：解读后**不清空**，与生成一致（R1.4）。

### 1.4 「提示词栏有回车提交」—— **不成立**

Textarea（`:1756-1770`）只有 `onChange`，无 `onKeyDown` / `onSubmit`。唯一提交入口是点击生成按钮
（`:1999` `onClick={() => void generate()}`）。⇒ R4.1 措辞已修正。

### 1.5 「Canvas 快捷设置」不在 Canvas 里 —— **位置澄清**

`AigcQuickSettings`（`packages/canvas-ui/src/aigc-quick-settings.tsx`）挂在**聊天 composer 的
`promptToolbar` 槽**（`examples/aigc-canvas-agent/.pi/web/web.config.tsx:28`），
**不是**工作台的 `promptBar`（`canvas-workbench.tsx:1735`）。二者是两个不同的栏。

⇒ 用户裁定：视觉模型下拉放**工作台 promptBar 内**，与既有「生成模型」选择器并列。

---

## 2. 关键资产与范式

| 资产 | 位置 | 用法 |
| --- | --- | --- |
| 提示词栏 `promptBar` | `canvas-workbench.tsx:1735-2009` | 输入框 `:1756`；生成模型选择器 `:1847`（`data-canvas-model`）；比例 `:1865`；变体 `:1948`；生成按钮 `:1986`（`data-canvas-generate`） |
| 提交入口 `generate()` | `:825-992` | 标注拍平上传 → `resolveAction` 评分 → `consumeSent` 清引用/标注/笔迹 → `bridge.submitOp(buildSurfaceOp(...))` |
| op 发出 | `packages/react/src/hooks/use-conversation-bridge.ts:113-115` | `submitViaPrompt(renderSurfaceOp(op))` → `conversation.submitUserMessage(text)` |
| `SurfaceOp` | `packages/web-kit/src/surface-op.ts:17-28` | `{ title, tool, params: [k,v][], fence?, fallback? }`；`DEFAULT_FENCE="surface-op"`（`:47`），canvas 显式传 `"canvas-op"` |
| `buildSurfaceOp` | `canvas-workbench.tsx:284-318` | tool 行含内联中文指令：`image_edit(请直接按下列参数调用,勿追问、勿复述参数)`（`:314`）；title `🎨 ${label} · ${intent}`（intent = prompt 前 48 字） |
| 生成模型选择器数据源 | `:535` `useState("")`；`:1717` `capabilities?.models ?? modelOptions ?? DEFAULT` | **纯本地 state，不持久**；空值 = 交给工具默认模型（`MODEL_DEFAULT_SENTINEL`） |
| 只读端点范式 | `packages/server/src/aigc-settings/aigc-models-routes.ts:14-21` | `createXxxRoute(): ReadonlyArray<InjectedRoute>`，经 `routes:` 注入（`lib/app/pi-handler.ts:493`） |
| Next catch-all 转发器 | `app/api/aigc/[[...path]]/route.ts:9-11` | ⚠ **新顶层 API 段必须自带**，否则静默 404；该文件**只导出 GET** |
| 模型枚举（含凭据） | `packages/server/src/config/model-options.ts:31` | `ModelRegistry.create(authStorage, models.json).getAvailable()` |

### LLM 如何理解围栏（隐性契约）

`examples/aigc-canvas-agent/index.ts` 的 systemPrompt **没有**教 LLM 解析 `canvas-op` 围栏格式。
理解完全依赖 tool 行内嵌的中文指令「请直接按下列参数调用,勿追问、勿复述参数」。
⇒ 视觉 op 必须沿用同一形态（`image_vision(请直接按下列参数调用,勿追问)`），不能只写 `tool: image_vision`。

---

## 3. 需求 → 资产映射与 gap

| 需求 | 可复用资产 | Gap | 类别 |
| --- | --- | --- | --- |
| 1.1–1.4 解读入口 | `promptBar` JSX、`current.attachmentId`、`bridge.submitOp` | 需新增按钮 + `buildVisionOp`（新函数） | Missing（小） |
| 2.1–2.4 结论回流对话 | `use-conversation-bridge.ts` 的 prompt 通道 | 无。`submitOp` 已是对话通道；R2.4「不另建展示区」= 不做即满足 | — |
| 3.1 清单 | `model-options.ts` + `ModelRegistry.getAvailable()` | 需新端点 + `input` 过滤 + Next catch-all 转发器 | Missing |
| 3.2 偏好 | 生成模型选择器范式（本地 state） | 生成模型**不持久**；「记住偏好」需决定是否加 localStorage | Constraint |
| 3.3 有偏好不弹层 | `image-vision-tool` Req 3.2 已实现 | 无。op 带 `model` 参数即可 | — |
| 3.4 无偏好弹层 | `image-vision-tool` Req 3.1 已实现 | 无。op 不带 `model` | — |
| 3.5/3.6 空清单 / 拉取失败 | — | 需前端退化：清单为空/失败 → 选择器显示说明，但按钮仍可用 | Missing（小） |
| 4.1–4.4 不干扰生成 | `generate()` 的 `consumeSent` | 解读**不得**调用 `consumeSent`，也不进 `resolveAction` | Constraint |
| 5.1 失败表现 | `image-vision-tool` 的 fail-soft | 无。结论/失败都由工具结果卡承载 | — |
| 5.2 零回归 | `generate-actions.test.ts` 决策守恒线 | 需确保 `BUILTIN_GENERATE_ACTIONS` 与 `buildSurfaceOp` 逐字节不变 | Constraint |
| 5.3 示例 agent 装载 | 已装（`aigc-canvas-agent` `extensions: [aigcExtension, visionExtension, canvasSurfaceExtension]`） | 无 | — |

---

## 4. 实现方案选项

### Option A — 把「解读」做成一个 `via:"prompt"` 的 CanvasActionPlugin
- ❌ 会进 `resolveAction` 评分制，与生成动作竞争；需给 `ActionInput` 加「意图」字段
- ❌ 违反 R4.2（不参与生成决策），且改动 canvas-kit 公开契约（影响插件作者）

### Option B — 独立按钮 + 独立 op 构造器（推荐）
- ✅ 完全绕开评分制；`canvas-kit` 契约零改动
- ✅ 复用 `bridge.submitOp` + `renderSurfaceOp`，与生成同一条对话通道
- ✅ agent 侧零改动（`image_vision` 已装载）
- ❌ `buildVisionOp` 与 `buildSurfaceOp` 有少量结构重复（可接受：params 顺序与 tool 行语义完全不同）

### Option C — 走 surface 命令通道
- ❌ **不可行**：命令 handler 只有 `SurfaceCtx`（`create-surface.ts:35`），没有 `modelRegistry`；
  vision 内核选模型与解析凭据都要它。需新增 ExtensionContext 捕获 seam（`pi.on` 回调第二参）。
- ❌ 结论不进对话记录，需新建结果展示区（违反 R2）

**推荐 Option B。**

---

## 5. 工作量与风险

| 维度 | 评级 | 理由 |
| --- | --- | --- |
| Effort | **S（1–3 天）** | 一个按钮 + 一个下拉 + 一个 op 构造器 + 一个只读端点；agent 侧零改动 |
| Risk | **Low–Medium** | 主要风险在「不干扰生成」的回归面（`consumeSent` / 评分制）与 Next catch-all 转发器遗漏 |

- 🟡 **Next catch-all 转发器**：新顶层 `/api/vision` 段必须自带 `app/api/vision/[[...path]]/route.ts`，
  否则静默 404（`app/api/aigc/[[...path]]/route.ts:9-11` 有明确警告）。这是已知的易漏项。
- 🟡 **决策守恒线**：`packages/canvas-ui/test/generate-actions.test.ts` 断言 `resolveAction` 与
  `buildSurfaceOp` 逐字节不变。解读若误入评分制或改动 `buildSurfaceOp`，该测试立刻红——是好护栏。
- 🟢 **围栏隐性契约**：tool 行必须带内联中文指令，否则 LLM 可能复述参数而不调用工具。

---

## 6. 带入 design 的决策与研究项

**必须在 design 中确定：**

1. `buildVisionOp` 的 params 顺序与 tool 行文案（须沿用 `image_edit` 的内联指令形态）。
2. 视觉模型偏好是否持久化：生成模型是纯本地 state；`AigcQuickSettings` 双写 KV + localStorage。
   建议 **本地 state + localStorage**（键与 `pi-web.aigc.*` 同构），不引入 state 桥 KV
   （workbench 的生成模型就没用 KV，保持一致）。
3. 清单如何到达 workbench：新增 prop（如 `visionModelOptions`），由宿主 `CanvasPanel` 从端点拉取注入
   —— 与既有 `modelOptions` prop 同构（`canvas-workbench.tsx:477`）。
4. 端点路径与 Next 转发器：`/api/vision/models`（新顶层段，须建转发器，只需 GET）。
5. 解读按钮**不得**调用 `consumeSent`、不得进入 `resolveAction`（R4.2/4.3/4.4）。

**Research Needed（design 阶段核实）：**

- `CanvasPanel`（`.pi/web/web.config.tsx`）当前是否给 workbench 传 `modelOptions`？若否，注入路径要新建。
- `packages/ui/test/canvas/` 下组件测试如何 mock `bridge`/`conversation`，以便断言「点击解读 → submitOp 被调用且 op 文本含 image_vision」。
- 端点单测范式：`packages/server/test/aigc-settings/aigc-models-routes.test.ts` 直测 `InjectedRoute.handler`，
  绕开 `createPiWebHandler` alias 陷阱。

---

# Design 阶段追加 — Discovery（light）与 Synthesis

## 待核实项的结论（承接 §6）

| 项 | 结论 |
| --- | --- |
| `CanvasPanel` 是否传 `modelOptions` | **不传**。`CanvasLauncher:154` 渲染 `CanvasWorkbench`，生成模型清单走 `capabilities?.models`（agent 权威快照）。⇒ 视觉模型清单需**新 prop + launcher 注入**（agent 侧无法下发，装配期没有 modelRegistry）。 |
| 组件测试如何 mock 对话通道 | `packages/ui/test/canvas/canvas-workbench-channel.test.tsx` 用 `onSubmitPrompt` prop 注入 prompt 通道（`opChannel` 探测：`conversation`/`onSubmitPrompt` 在场 → `"prompt"`）。可直接断言 submitOp 产生的围栏文本。 |
| 端点单测范式 | `packages/server/test/aigc-settings/aigc-models-routes.test.ts` 直测 `InjectedRoute.handler` + 最小 `RequestContext`，**不经** `createPiWebHandler`（避开 alias 陷阱）。 |

## Synthesis 决策

1. **Build vs Adopt — 对话通道**：Adopt 既有 `bridge.submitOp` + `renderSurfaceOp`。
   拒绝 surface 命令通道（无 `modelRegistry`，且结论不进对话记录，违反 R2）。
   净效果：**agent 侧零改动**，工具弹层能力免费获得。

2. **Generalization — 拒绝合并 op 构造器**：`buildVisionOp` **不复用** `buildSurfaceOp`。
   二者 tool 行语义、params 顺序、可选参数集合完全不同；强行抽象会把
   `generate-actions.test.ts` 的决策守恒线（逐字节断言 `buildSurfaceOp` 输出）拖下水。
   两个独立纯函数是更小的耦合面。

3. **Simplification — 拒绝 state 桥 KV**：视觉模型偏好用 `useState` + `localStorage`，
   不引入 state 桥 KV。理由：workbench 的**生成**模型选择器就是纯本地 state，
   引入 KV 会让同一栏里两个下拉的持久化机制不一致。

4. **关键裁定 3（格式）**：视觉模型下拉 value = `provider/modelId`（与 `modelKey` 对齐），
   而既有生成模型下拉 value = 裸 `id`。**两者不可混用**，实现时极易搞错。

## Boundary 决策与理由

- `buildSurfaceOp` / `BUILTIN_GENERATE_ACTIONS` / `resolveAction` / `ActionInput` **一字不改**。
  解读由显式按钮触发，不进评分制（R4.2）。`generate-actions.test.ts` 是这条边界的守卫。
- 解读**不得**调用 `consumeSent` —— 掩码 / 参考图 / 标注只服务生成，解读只看当前工作图（R4.3/4.4）。
- Canvas 侧不解释识别失败、不重试、不建结论展示区（R2.4/R5.1）——那是 `image-vision-tool` 的责任。

## 风险复核

- 🔴→🟢 「内置模型看不到」：已证伪（server 可用 `ModelRegistry.getAvailable()`）。
- 🟡 **Next catch-all 转发器遗漏** ⇒ `/api/vision/models` 静默 404。缓解：列为独立任务 + node e2e 断言。
- 🟡 **`model` 参数格式混淆**（`provider/id` vs 裸 `id`）⇒ 工具报 `unknown_model`。缓解：单测锁死。
- 🟡 **误接入 consumeSent** ⇒ 解读会吞掉用户的掩码/参考图。缓解：组件测试 4 专门锁这条。
- 🟢 围栏隐性契约：tool 行内联中文指令，单测 3 锁死。
