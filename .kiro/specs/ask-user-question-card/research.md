# Research Log — ask-user-question-card

## 发现范围（Light Discovery / Extension）

本特性是对既有 extension-UI 子协议链路的扩展，不新增协议帧。研究聚焦三条集成缝：工具端（tool-kit / 示例 agent）、前端（react hook + ui 卡片）、离线 e2e（stub agent）。三路并行子代理调查，结论如下。

## 集成点（file:line 证据）

### 1. 协议层是共享编解码的正确归属
- `packages/protocol/package.json` 依赖仅 `@blksails/pi-web-logger` + `zod`，不 import 任何 sibling `@blksails/*` 运行时包 → 契约根（zero-runtime-dep isomorphic）。
- `ui` 同时依赖 protocol 与 tool-kit；`tool-kit` 目前依赖 `agent-kit` + `logger`（未依赖 protocol）。让 tool-kit 新增 protocol 依赖**不成环**（protocol 不 import tool-kit）。
- 既有 `packages/protocol/src/rpc/extension-ui.ts` 就是本特性搭载的帧契约。新增 `packages/protocol/src/rpc/ask-user-question.ts`，经 `packages/protocol/src/index.ts`（已 `export *`）再导出，是自然落点。
- `protocolVersion` 常量在 `packages/protocol/src/version.ts:17` = `"0.1.0"`，被 `transport/sse-frame.ts` 引用。**本特性零新增帧 → 该常量不动**。

### 2. `select` 帧可承载富载荷，`value:string` 应答可回传富答案
- pi SDK `ExtensionUIContext.select(title, options[], opts?): Promise<string | undefined>`（`@earendil-works/pi-coding-agent .../types.d.ts:69`）。`title` 内容无约束。
- 帧契约镜像 `extension-ui.ts:16-23`（select 请求：`title/options[]/timeout?`）与 `:85-101`（应答联合：`value:string` | `confirmed:boolean` | `cancelled:true`）。
- 前端 `respond(requestId, response)`（`packages/react/src/hooks/use-extension-ui.ts:84-104`）→ `client.uiResponse` → 成功后 `dequeueExtensionUi`。`UiResponseRequest` = pi 原生应答联合（`packages/protocol/src/transport/rest-dto.ts:129-130`）。故 `{ type:"extension_ui_response", id, value: <编码答案> }` 原生可回传。

### 3. 前端渲染分支落点
- `PiInteraction`（`packages/ui/src/elements/pi-interaction.tsx`）仅当 `current` 为 select/confirm/input/editor 时渲染（`isInteractive` 57-67）。富请求 `method:"select"` 天然通过该门 → 只需在 select 分支内检测 `title` 哨兵改渲染富卡片。
- `title` 当前被 verbatim 渲染（`:195`, `:305`）→ 富卡片必须在渲染前 decode 拦截。
- 关键杠杆：`submit(request, response, outcome)`（`:94-112`）已把「回传帧 response」与「本地留痕 outcome」**分离**为两个参数 → 富路径可回传编码 JSON、同时留痕存人类可读摘要，无需改签名。
- 挂载点：`pi-chat.tsx:1611/1690`、`pi-chat-basic.tsx:159`。
- i18n：`packages/ui/src/i18n/messages.ts` 扁平 `Record<string,string>` 的 `zh`/`en` 两图，既有 `piInteraction.*` 键（zh 155-166 / en 360-371）。新键同时加两图。
- 单测样板：`packages/ui/test/elements/notifications.test.tsx`（vitest + testing-library，直接 render + mock `extensionUI`，断言 `data-pi-*`）。`packages/ui/package.json:15` `test: vitest run`。

### 4. tool-kit 两入口 + 工具注册习惯
- `packages/tool-kit/package.json:9-16`：`.` → `src/index.ts`（前端安全，**禁 import pi SDK**）；`./runtime` → `src/runtime.ts`（node-only，pi SDK + undici 允许）。
- 工具用 `defineTool({ name, label, description, parameters: Type.Object({...}), async execute(_id, params, signal, _onUpdate, ctx) })`；`textResult` 形如 `{ content:[{type:"text",text}], details }`。示例：`examples/archive-agent/tools/archive-tools.ts:24-45`、`examples/ui-demo-agent/index.ts`。
- agent 经 `customTools:[...]` opt-in（`defineAgent`，`@blksails/pi-web-agent-kit`）。
- **AskUserQuestion 工具用到 `defineTool` + `ctx.ui.select`（pi SDK）→ 归属 `./runtime`**（node-only）。

### 5. stub agent 帧级驱动，无需真实 agent
- `lib/app/stub-agent-process.mjs`：状态机 `awaitingUiResponse`（:407）+ `pendingUi`（:409）。prompt sentinel 分发 `:720-759`（`ext-select` :725-733 / `ext-input` / `ext-editor` / else `writeConfirm`）。`finishTurn` :781-790 发 "Continuing" 文本 + `turn_end` + `agent_end`。应答处理 `:797-804` 仅按 `pendingUi` 定位（当前忽略 payload，但 `cmd.value/answers` 可读）。stdin 解析 `:1163-1182`。
- 新增 sentinel `ext-askq`：`handlePrompt` 加分支写 `select` 帧、`title` 带哨兵 JSON；应答 case 加 `pendingUi==="askq"` 分支解码 `cmd.value`、echo 后 `finishTurn`。单步闭环（类比 `ext-input`）。
- 运行：`package.json:43` `e2e:node = cross-env PI_WEB_STUB_AGENT=1 vitest run -c vitest.node-e2e.config.ts`；config `include:["e2e/node/**/*.test.ts"]`，含 `@` 与 `@blksails/pi-web-tool-kit/*` 源码 alias。
- stub 发**裸帧**，不 import 任何 example → e2e 可纯帧级验证 codec 往返（可直接 import protocol codec 佐证）。

## 合成决策（Synthesis）

- **Build vs Adopt**：不引入任何新依赖、新库、新协议帧。完全复用既有 `select`/`value` 帧 + 既有 `PiInteraction` 承载点 + 既有 stub 驱动范式。
- **Generalization**：把「哨兵 + JSON 富载荷」抽成 protocol 层单一权威 codec（类型 + zod + 编解码函数 + 常量），tool-kit 与 ui 各自 import，杜绝两端硬编码哨兵/结构漂移（满足 R6.1）。
- **Simplification**：富卡片一次 `select` 往返完成全部多题作答（请求 title 载问题组、应答 value 载答案），不做多轮 per-question 往返，避免 FIFO 串行多帧的复杂度。
- **Degradation**：`title = 人类可读前导 + 哨兵 + JSON`；旧前端 verbatim 渲染仍可读前导 + 用 `options` 兜底作答；应答 value 无答案哨兵前缀 → 工具端识别为降级情形（满足 R4）。
- **留痕**：复用 `submit` 的 response/outcome 分离——回传编码 JSON，留痕存人类可读摘要，ResolvedCard 无需改造即显示可读结果。

## 风险与缓解
- **哨兵碰撞**：用控制字符前缀（如 ``）+ 版本标记降低与正常 title 碰撞概率；`isAskTitle` 仅在 `method==="select"` 时检测，进一步收窄。
- **旧前端 title 观感**：降级下 JSON 尾随于人类前导之后，控制字符多数终端/浏览器不可见；R4 只要求可应答，不要求美观，接受。
- **参数校验双保险**：`Type.Object` 的 `minItems/maxItems` + execute 内 protocol zod 复校，防 SDK 不深校嵌套约束（满足 R1.5）。
