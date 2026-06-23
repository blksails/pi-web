# Gap Analysis — attachment-mention-completion

> 实施缺口分析：将需求(WHAT)与现有代码库对齐，为设计阶段提供策略输入。
> 证据来源：对 `packages/server/src/completion`、`packages/server/src/attachment*`、`packages/ui/src/completion`、`e2e/` 的代码勘察（含文件路径/行号）。

## 1. 现状勘察（Current State）

### 1.1 Completion 框架（高度可复用，扩展点齐备）
- **Provider 接口** `packages/server/src/completion/types.ts:36-57`：`{ id, trigger(单字符), kind?, extract?, priority?, complete(), resolve?() }`。`complete()` 返回 `CompletionItem[]`，`resolve()` 为可选提交期钩子。
- **CompletionItem 结构** `packages/protocol/src/transport/completion-dto.ts:17-26`：`{ providerId, kind, id, label, detail?, insertText?, score?, sortText? }`。已支持 `detail` 副信息与自定义 `insertText`。
- **Registry** `packages/server/src/completion/registry.ts:31-142`：`register()`（同 id 覆盖、触发符单字符校验）、`triggers()`（并集）、`query()`（**同触发符多 provider 并发 + 按 priority/score 合并 + 按 kind 分组 + 统一上限默认 30**）、`findByKind()`（提交期按 kind 分发 resolve）。
- **通用端点** `packages/server/src/http/routes/completion-routes.ts`：`GET /sessions/:id/completion/triggers`、`GET /sessions/:id/completion?trigger=@&q=…` → `{ items, groups:[{kind,count}] }`。
- **Token 文法** `packages/server/src/completion/token.ts`：`<trigger><kind>:<id>`，正则 `/([@$#/])([a-z][a-z0-9_-]*):([^\s]+)/g`；无冒号视为普通文本。`parseTokens()` / `tokenMatches()`（带位置）。
- **提交期 resolve** `packages/server/src/completion/resolve.ts:1-44`：扫描 ref → 按 kind 分发 provider.resolve → 位置式重写 token 为返回 text；**无 provider/无 resolve/抛错/返回 null → 保留原始 token 文本，不阻断发送**（已满足 R6.3/R6.4/R7.2 降级语义）。
- **file-provider 参照** `packages/server/src/completion/providers/file-provider.ts:186-279`：`id/trigger/kind = "file"/"@"/"file"`；`complete()` 遍历 session cwd 模糊匹配 → `insertText=@file:<rel>`；`resolve()` `@file:<rel>` → `@<rel>` 含 realpath 安全校验。

### 1.2 Attachment 系统（列举与隔离能力已就绪）
- **Store** `packages/server/src/attachment/attachment-store.ts:88-189`：含 **`listBySession(sessionId): Promise<Attachment[]>`**（R1 关键方法已存在）、`head()`、`presignUrl()` 等。
- **Registry** `packages/server/src/attachment/attachment-registry.ts:33-87`：`listBySession` 扫描 `<root>/*.att.json` 按 sessionId 过滤（隔离已实现）。
- **描述符** `packages/protocol/src/attachment/attachment-dto.ts:24-33`：`{ id, name, mimeType, size, origin:"upload"|"tool-output", sessionId, createdAt }`（足够支撑 label=name、detail=type/size）。
- **Reference Injection** `packages/server/src/attachment-bridge/reference-injection.ts:29-58`：当前对 `attachmentIds` 列表逐条产出 `[attachment id=att_… type=<mime> name=<name>]` 行（R6.2 解析目标格式来源）。
- **提交链路** `packages/server/src/http/routes/command-routes.ts:91-134`：`makeMessagesHandler` 顺序执行 (a) `resolveCompletions(message)` → (b) `resolveAttachments(attachmentIds)` → (c) `injectAttachmentRefs(...)`。**completion resolve 已先于附件注入执行**，是接入 mention resolve 的天然位置。

### 1.3 前端（基本零改动即可承载新 kind）
- **useCompletion** `packages/ui/src/completion/use-completion.ts:50-145`：经 `client.getCompletionTriggers / getCompletion` 拉取，返回 `groups`（按 kind 分组）、`activeToken`、`accept()`（插入 `insertText`）。kind 无硬编码。
- **PiCompletionPopover** `packages/ui/src/completion/pi-completion-popover.tsx:26-106`：**按 kind 通用分组渲染 + 支持 detail 副标题 + 插入 insertText**。新 kind `attachment` 会被自动渲染，无需改前端即满足 R3/R5 基本验收。
- 局限：浮层不渲染图标/真实缩略图（已在需求列为 out-of-scope/可选增强）。

### 1.4 测试基建（现成可套用）
- **Node e2e** `e2e/node/completion.e2e.test.ts`：`PI_WEB_STUB_AGENT=1` + stub agent path；直接打 triggers/completion 端点断言。运行：`npx vitest run e2e/node/completion.e2e.test.ts`。
- **Browser e2e** `e2e/browser/completion.e2e.ts`：`PI_WEB_STUB_AGENT=1` + `NEXT_DIST_DIR=.next-e2e` 隔离构建，外部 server 模式。运行：`npm run e2e:browser`。
- **Attachment e2e** `e2e/browser/attachment-store.e2e.ts`：上传→落库→分发 URL 展示链路。

## 2. 需求 → 资产映射（Requirement-to-Asset Map）

| 需求 | 依赖资产 | 状态 |
|---|---|---|
| R1 列举本会话附件 | `AttachmentStore.listBySession` | ✅ 复用 |
| R2 `@`+kind 并存 | `registry.query` 多 provider 并发合并 | ✅ 复用 |
| R3 候选展示/分组 | `CompletionItem.label/detail` + `groups` + 前端通用渲染 | ✅ 复用 |
| R4 查询过滤/上限 | 自实现 `complete()` 名称匹配；框架统一上限 | 🟡 新增 provider 内逻辑 |
| R5 token 插入 | token 文法 + 前端 `accept(insertText)` | ✅ 复用（provider 提供 insertText） |
| R6 解析为规范标记 | `resolve.ts` 分发 + reference-injection 格式 | 🟡 新增 `resolve()` + **复用/提取格式化函数** |
| R7 会话隔离 | `listBySession` + ctx.sessionId | ✅ 复用 |
| R8 e2e | 现有 completion/attachment e2e 范式 | ✅ 复用范式，新增用例 |

**缺口标记：**
- **Missing**：attachment 专属 CompletionProvider（`complete()` + `resolve()`）尚不存在 —— 本功能核心新增。
- **Constraint①（store 注入）**：provider 需在 server 侧访问 `AttachmentStore`。file-provider 通过构造期闭包拿 session cwd；attachment provider 同理需在 `create-handler.ts` 构造时注入 store 引用，并依赖 `CompletionCtx.sessionId`。→ **Research Needed: 确认 `CompletionCtx` 字段是否含 `sessionId` 及 store 在 handler 构造处的可达性**。
- **Constraint②（格式一致性）**：R6.2 要求 resolve 输出与 reference-injection 完全一致。当前注入逻辑面向 `attachmentIds` 列表内联在 `reference-injection.ts`，需提取一个「单附件 → 标记字符串」的共享纯函数，供 mention resolve 与既有列表注入复用，避免格式漂移。
- **Constraint③（去重）**：mention resolve 产出的内联标记 与 既有 `attachmentIds` 注入若同时引用同一附件，可能产生重复标记。需在设计阶段定义去重/合并语义（本功能引用的是「已有」附件，通常不在 `attachmentIds` 中，重复风险低但需明确）。

## 3. 实施方案选项

### Option A — 纯扩展（不新增独立 provider 文件）
将 attachment 逻辑塞进 file-provider 或在 registry 内特判。
- ✅ 文件最少
- ❌ 违反单一职责，污染 file-provider；kind 混淆；不符框架「一 provider 一职责」约定。**不推荐**。

### Option B — 新建独立 Provider（推荐）
新增 `packages/server/src/completion/providers/attachment-provider.ts`，实现 `complete()`（`listBySession` → 名称过滤 → `CompletionItem{kind:"attachment", insertText:"@attachment:<id>"}`）与 `resolve()`（id→规范标记），在 `create-handler.ts` 注入 store 并 `register()`。复用 `reference-injection` 提取出的共享格式化函数。
- ✅ 与 file-provider 对称、清晰隔离、易单测
- ✅ 前端零改动即承载新 kind
- ✅ 完整命中框架既有扩展点（`completionProviders`）
- ❌ 需小幅重构 reference-injection 以共享格式化函数（受控）

### Option C — 混合（Provider + 前端增强）
在 B 基础上额外为浮层增加 attachment 图标/缩略图渲染。
- ✅ 体验更好
- ❌ 触及前端渲染、超出本功能强制范围（可选增强）。建议作为后续增量，不纳入本 spec 强制验收。

## 4. 复杂度与风险

- **Effort：S（1–3 天）** —— 框架与列举/隔离能力均已就绪，核心是一个对称的新 provider + 一处格式化函数提取 + e2e 用例。
- **Risk：Low** —— 复用成熟模式（file-provider 为现成模板）、扩展点明确、降级语义已由框架保证；唯一受控项是格式一致性与 ctx.sessionId 可达性。

## 5. 设计阶段建议

- **首选方案：Option B**，token 类型 `attachment`、形态 `@attachment:<id>`，触发符复用 `@`。
- **关键决策**：
  1. 从 `reference-injection.ts` 提取单附件格式化纯函数（如 `formatAttachmentRef(att)`），mention resolve 与列表注入共用，锁死 R6.2 格式一致性。
  2. resolve 中先 `listBySession`/`head` 校验 id 归属当前会话（满足 R7.2），失配 → 返回 null 走框架降级（满足 R6.3）。
  3. 确认前端 `PiCompletionPopover` 对 `attachment` 分组的默认渲染达标（label=name、detail=`type · size`），如需更友好分组标题再做最小增强。
- **Research Needed（带入设计）**：
  - `CompletionCtx` 是否提供 `sessionId`；若无，确认 provider 获取当前会话的途径。
  - mention 内联标记与 `attachmentIds` 注入的去重/合并语义边界。
  - tool-bridge 是否仅凭 id（无需进入 `attachmentIds`）即可让 agent 取到已有附件（预判：可，store 按 id+session 解析）。

---

## 设计阶段综合（Synthesis · Research Needed 已闭环）

- **CompletionCtx 已含 sessionId** —— `packages/server/src/completion/types.ts`：`CompletionCtx = { sessionId, cwd, userId }`（服务端注入）。provider 可直接用 `ctx.sessionId` 列举/校验，无需自前端取。Constraint① 解除。
- **store 在注册处可达** —— `create-handler.ts:75-77` 构造注册表并注册 file-provider；`opts.attachmentStore` 同处可达（`:95` 已传入 makeMessagesHandler）。采用条件注册：`if (opts.attachmentStore) completion.register(createAttachmentProvider(opts.attachmentStore))`。
- **格式无需新提取函数** —— `buildAttachmentRefs([att])`（`attachment-bridge/reference-injection.ts`）对单附件恰好产出一行 `[attachment id=… type=… name=…]`。resolve 直接复用，Constraint② 由「复用而非重定义」解除，杜绝格式漂移。
- **去重风险低（Constraint③）** —— 本功能引用「已有」附件，通常不在当次 `attachmentIds` 中；mention resolve 仅内联文本标记、不进入 `attachmentIds`。两路径不重叠，无需额外去重；若用户同时上传+mention 同一 id 的极端情形产生两条标记，对 agent 无害（同 id 幂等）。设计 Non-Goal 已声明不进入 attachmentIds。
- **tool-bridge 取用确认** —— agent 凭标记中的 id 经 tool-bridge 按 (id, session) 从 store 取附件，已有附件天然可取，无需进入 `attachmentIds`。
- **前端零改动** —— `PiCompletionPopover` 按 kind 通用渲染 + 支持 detail + 插入 insertText；新 kind `attachment` 自动承载。Option C 的浮层图标/缩略图为可选增强，排除出本 spec。

**Build-vs-Adopt**：全部 Adopt 现有框架与函数；唯一 Build 是对称的新 provider 文件 + 一处条件注册接线。
