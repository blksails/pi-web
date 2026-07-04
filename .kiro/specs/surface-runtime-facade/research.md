# Research & Design Decisions

## Summary
- **Feature**: `surface-runtime-facade`
- **Discovery Scope**: Extension(既有 surface 栈上的门面收口,集成型轻量发现)
- **Key Findings**:
  - slot 组件是独立 bundle,宿主注入走 **props 而非 React context**(web-kit 不依赖 react,`packages/web-kit/src/host-context.ts:31` 注释明示)→ 门面 hook 必须采用「组件把注入 props 递给 hook」的 opts 装配形态,与 `useSurface(domain, opts)` 范式同构(`packages/react/src/hooks/use-surface.ts:56`)。
  - **react 已依赖 web-kit**(`packages/react/package.json:20`),ui 亦依赖 web-kit → 能力对象类型与纯函数组装器可 canonical 落在 web-kit(框架无关),react 只做 hook 装配,依赖方向 `protocol ← web-kit ← react ← ui` 全程顺行。
  - `buildToolPrompt` 的精确输出格式(`packages/ui/src/canvas/canvas-workbench.tsx:219-250`):标题行 `🎨 ${ACTION_LABEL} · ${intent≤48}`、fence 语言 `canvas-op`、参数行按固定顺序且**值内携带领域注解**(如 `mask: …(alpha mask,透明区=需要重绘的区域)`)→ 组装器泛化时参数值必须原样透传、按插入序输出,fence 语言必须可参数化才能保住「canvas 单测零改动全绿」验收线。
  - `doSend` 只收 `text`(`packages/ui/src/chat/pi-chat.tsx:1693` `onSubmitPrompt={(text) => doSend(text)}`),attachmentIds 来自 composer 状态(`pi-chat.tsx:752-784`)→ `bringToConversation(refs)` 需要宿主能力对象支持显式 attachmentIds,这是能力对象化(`submitUserMessage(text, opts?)`)相对旧回调的**实质增量**,不只是改名。

## Research Log

### SlotHost 注入集与传递机制
- **Context**: 门面从哪拿注入、canvas 迁移动哪些线。
- **Sources Consulted**: `packages/ui/src/web-ext/apply-extension.tsx:80-179`、`packages/ui/src/chat/pi-chat.tsx:1679-1694`、`packages/web-kit/src/host-context.ts`。
- **Findings**:
  - SlotHostProps 现注入集:`state/surface/upload/baseUrl/sessionId/syncSignal/onSubmitPrompt/livePreviewImage`(apply-extension.tsx:110-141);函数型贡献经 `renderContribution` 展开为组件 props(:82-105)。
  - `onSubmitPrompt?: (text: string) => void`(:135),由 pi-chat 以 `(text) => doSend(text)` 提供(:1693)。
  - `WebExtSurfaceAccess { run/getState/subscribe/hasCommand }` 定义于 web-kit host-context(:33-42),`hasCommand` 同步查 controls 快照。
- **Implications**: 新增 `conversation` 能力对象沿同一 prop 通道注入;类型落 web-kit host-context 与 WebExtSurfaceAccess 同族。

### buildToolPrompt 语义与字节等价约束
- **Context**: 验收线 1 要求 canvas 单测/e2e 零改动全绿;组装职责要移交 SDK。
- **Sources Consulted**: `canvas-workbench.tsx:184-250`(decideGenerate/ACTION_LABEL/buildToolPrompt)。
- **Findings**: 首参数行 `tool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)` ——注解与工具名同串;参数省略逻辑(空 prompt/size/n/model 跳过、reframe 默认 prompt)是**领域决策**,发生在参数表组装时而非渲染时。
- **Implications**: 泛化切面定在「参数表 → 消息文本」:领域侧产出 `SurfaceOp`(title/tool/params 有序表/fence),SDK `renderSurfaceOp` 只做纯拼接。`buildToolPrompt` 保留为 `renderSurfaceOp(buildSurfaceOp(d, opts))` 薄包装,既有单测(直接调 buildToolPrompt)零改动通过。

### 通道探测的同步性
- **Context**: opChannel 三态需可靠探测且随能力变化更新。
- **Findings**: canvas 现状探针 `surface.hasCommand("surface:canvas")`(canvas-workbench.tsx:431)为渲染时同步求值,背后是 ControlStore 镜像的 commands 快照;粘性帧机制保证重连后回放。
- **Implications**: 门面 command 态探测复用同一同步探针,渲染时求值即可,不引入异步 available 状态机(useSurface 的 getCommands 拉取路径是无 surface prop 场景的兜底,slot 场景不需要)。

### bringToConversation 与附件引用注入
- **Context**: C3-2 注入门面要复用既有机制。
- **Sources Consulted**: `packages/react/src/hooks/use-attachments.ts:294-303`(referenceIds)、`pi-chat.tsx:752-784`(attachmentIds→body)、`packages/server/src/attachment-bridge/reference-injection.ts:29-58`(服务端标记块)。
- **Findings**: 引用进 LLM 的既有链路 = 前端 `body.attachmentIds` → 服务端 `injectAttachmentRefs` 前置 `[attachment id=… ]` 标记块。文本内嵌标记不是合法路径(标记由服务端生成)。
- **Implications**: `conversation.submitUserMessage(text, opts?: { attachmentIds })` 必须开显式 attachmentIds 口;`doSend` 相应加可选参数,与 composer 引用**合并追加**(不清空、不替代用户草稿附件,保持既有行为不变式)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| opts 装配 hook(选定) | `useConversationBridge(opts)`,组件把注入 props 一次性递入 | 与 useSurface 同构;独立 bundle 无 context 可用的约束天然满足;可测性好(注入即 mock) | 组件仍声明注入 props(但不再散点消费) | 契约 §4.5 草图的 `useConversationBridge()` 无参形态在 slot 架构下不可实现,契约标注 informative,偏差合法 |
| React Context 注入 | SlotHost 包 Provider,hook 无参读 context | 应用面零 props | 独立 bundle 双 React 实例下 context 断裂;web-kit 不依赖 react,类型无处安放 | 否决:与 host-context.ts:31 的既有裁决冲突 |
| 门面对象直接注入(host 组装) | 宿主直接注入组装好的 bridge 对象 | 应用面最省 | 宿主被迫知道 fence/降级策略,违反契约 §4.2 分层(宿主领域无关) | 否决:层次错位即违章 |

## Design Decisions

### Decision: 类型与纯函数落 web-kit,hook 落 react
- **Context**: `ConversationAccess`(能力对象)、`SurfaceOp`/`renderSurfaceOp`(组装)需被 ui(注入/消费)、react(装配)、webext 作者(独立 bundle)三方使用。
- **Alternatives Considered**:
  1. 全落 react — webext 作者被迫依赖 react 包;
  2. 类型落 protocol — 能力对象非线上协议,违反 protocol 零运行时定位;
  3. 类型+纯函数落 web-kit,hook 落 react(选定)。
- **Selected Approach**: web-kit `host-context.ts` 增 `ConversationAccess`;web-kit 新文件 `surface-op.ts` 放 `SurfaceOp` 类型 + `renderSurfaceOp` 纯函数;react 新 hook `use-conversation-bridge.ts` 装配。
- **Rationale**: 依赖方向顺行(react→web-kit 既存);框架无关件归框架无关包;与 WebExtSurfaceAccess 的先例完全一致。
- **Trade-offs**: renderSurfaceOp 从 react 入口需 re-export(一行);收益是 webext 作者零额外依赖。

### Decision: SurfaceOp 形状与 fence 参数化
- **Context**: 契约 §4.5 草图 `{title, tool, params: Record<string,string>}`;字节等价约束要求参数序稳定、注解透传、fence 可指定。
- **Selected Approach**: `SurfaceOp = { title; tool; params: readonly (readonly [string, string])[]; fence?: string; fallback?: { action: string; args?: unknown } }`。params 用有序对数组(比 Record 插入序更显式);`fence` 默认 `"surface-op"`,canvas 传 `"canvas-op"`;`fallback` 声明控制面等价命令(command 态降级依据,Req 2.5/2.6)。
- **Rationale**: 契约明言 fence 格式是 SHOULD 约定非协议,参数化合规;fallback 是 C3-4 ② 在「操作无控制面等价」时不静默跳级的必要声明位。
- **Trade-offs**: 与契约草图的 Record 形状有偏差(草图 informative);有序对数组换取确定性输出。
- **Follow-up**: 单测断言 renderSurfaceOp(buildSurfaceOp(d)) 与旧 buildToolPrompt 输出逐字节相等(golden 对照)。

### Decision: submitUserMessage 增 attachmentIds 口(doSend 扩参)
- **Context**: bringToConversation 需提交带显式引用的消息;doSend 现仅收 text。
- **Selected Approach**: `ConversationAccess.submitUserMessage(text: string, opts?: { attachmentIds?: readonly string[] })`;pi-chat `doSend` 加同形可选参,显式 ids 与 composer 引用合并追加。`onSubmitPrompt` 别名保持 `(text) => void` 原签名不动。
- **Rationale**: 引用只能经 body.attachmentIds 进服务端注入链;别名零破坏由「签名不动」保证。
- **Trade-offs**: 宿主 seam 有一处实质行为增量(非纯改名),但增量是领域无关的搬运(宿主仍不知道 refs 是什么)。

### Decision: opChannel 探测规则
- **Selected Approach**: `prompt` ⇐ conversation(或 onSubmitPrompt 别名)在;`command` ⇐ 前者缺 ∧ surface 在 ∧ opts.domain 在 ∧ `surface.hasCommand("surface:"+domain)`;否则 `unavailable`。渲染时同步求值。
- **Rationale**: C3-4 次序直译;domain 由应用面声明(canvas="canvas"),门面保持领域无关。
- **Follow-up**: 三种注入组合 × submitOp 分道单测(Req 2 验收映射)。

### Decision: canvas 迁移切面
- **Selected Approach**: canvas-workbench 析出 `buildSurfaceOp(d, opts): SurfaceOp`(领域参数组装,含省略规则与注解);`buildToolPrompt` 变薄包装保测;三处 `onSubmitPrompt?.(...)` 调用点改 `bridge.submitOp(...)`;两处 `useEffect([syncSignal])` 改 `bridge.onTurnEnd`;`available` 二态横幅升级为 opChannel 三态(command 态:生成不可用提示「操作不进对话/LLM 不在环」,本地工具与控制面动作照常;unavailable 态:沿用现横幅)。canvas 生成操作**不声明 fallback**(无控制面等价命令),command 态下 submitOp 拒绝即 Req 2.6 行为。
- **Follow-up**: e2e 降级场景用无 surface 的 agent source 验 unavailable 不崩。

## Risks & Mitigations
- 字节等价断言脆弱(golden 对照) — 用「旧函数即新管线包装」的结构性保证(buildToolPrompt=renderSurfaceOp∘buildSurfaceOp),而非平行两套实现;golden 单测只作防漂移哨兵。
- onSubmitPrompt 别名与 conversation 并存期间双通道混用 — 门面内部统一归一(conversation 优先,别名兜底),canvas 迁移后 grep 验证无裸调用(验收线 2)。
- syncSignal 初值触发误报轮末 — hook 记录首见值,仅在**变化**时回调(canvas 现状 mount 即跑 effect 属无害行为,迁移后语义收紧,需确认 livePreview 清除不依赖 mount 触发)。
- StrictMode 双执行(canvas-workbench.tsx:88 settleWindow 的旧伤) — onTurnEnd 注册/退订走 effect 清理函数,幂等。
- 并发 WIP 污染主工作树(memory: 多 agent 抢 main) — 实现期在隔离 worktree 干,验证后 FF。

## References
- `docs/surface-app-runtime-contract-v1.md` — 框架单一权威;本 spec 兑现 §4(C3)、§4.2 分层、C3-4 降级、§4.5 草图与 §11 M-A。
- `.kiro/specs/agent-authoritative-surface/` — 上游 spec(createSurface/useSurface/wireSurfaceBridge)。
- `packages/react/src/hooks/use-surface.ts` — opts 装配范式先例。
- `packages/web-kit/src/host-context.ts` — 能力对象同族先例(WebExtSurfaceAccess/WebExtStateAccess)。
