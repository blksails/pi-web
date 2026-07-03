# Research & Design Decisions — aigc-prompt-toolbar

## Summary
- **Feature**: `aigc-prompt-toolbar`
- **Discovery Scope**: Extension(既有系统集成型;全部接缝在设计前逐一读码实证)
- **Key Findings**:
  - 输入区已有 5 个 webext 槽(`accessoryAboveEditor/promptInput/accessoryInlineLeft/Right/accessoryBelowEditor`),但**工具排内部**(内核控件行)没有槽;工具排由 `controlNodes` + `toolbarOrder` map 装配(pi-chat.tsx:1103),`submit` 项自带 `ml-auto`,在 map 中 `key === "submit"` 前插入即天然落位"内核控件后、发送键前"。
  - 偏好传递全链现成:UI 侧 `WebExtStateAccess`(get/subscribe/set,web-kit/host-context.ts:16)→ 写回端点 → 子进程权威 KV;工具侧 `getSessionState()`(tool-kit/session-state.ts,fail-safe 降级,支持 scope 注入便于测试)。
  - 工具参数决定链在 `run-image-tool.ts`:model = `args.model > defaultModel > 首项`;缺参走 `resolveRequiredParams` 交互追问(hasUI 分支 `ctx.ui.select/input`)。偏好插入点与写回点都在此文件内。
  - 模型清单:`IMAGE_EDIT_ROUTES` 已导出(image-edit.ts:84),`image-generation.ts` 未导出对应 ROUTES(需补);UI 侧 workbench 有硬编码 `DEFAULT_MODEL_OPTIONS` 先例(canvas-workbench.tsx:111,注释明确"可由 prop 覆盖为动态清单")。

## Research Log

### 工具排挂载点(为何不是既有 5 槽)
- **Context**: 用户否决了 `accessoryBelowEditor`(输入卡下一行)与 `accessoryInlineRight`(输入框内绝对定位)两个 mock 方案,拍板"并进现有工具排后面"。
- **Sources Consulted**: packages/ui/src/elements/prompt-input.tsx(toolbar prop)、pi-chat.tsx:1103-1110(controlNodes/order map)、extension-slots.tsx(ExtSlotRegion)。
- **Findings**: PromptInput 的 `toolbar` 是宿主装配的 ReactNode;order 数组含 `submit`;`SlotKeySchema` 的 `toolbar` 槽名已被占用(渲染在 aside 区,pi-chat:1606)。
- **Implications**: 需新增 SlotKey `promptToolbar`(additive,向后兼容);在 map 内 `key === "submit"` 前渲染 `ExtSlotRegion`,as="span" 融入 flex 行。

### 偏好如何抵达工具执行(状态桥复用)
- **Context**: "记住的选择"必须被子进程里执行的图像工具读到;用户历史立场:零 REST 新增、agent-source 独立。
- **Sources Consulted**: state-injection-bridge spec/memory、tool-kit/session-state.ts、web-kit/host-context.ts、server/runner/state-wiring.ts。
- **Findings**: 双向通道齐备且同构于 canvas surface 用法;`getSessionState()` 无 pi SDK/Node 依赖、seam 缺失恒降级(available:false,读 undefined 写 no-op)。
- **Implications**: 零协议/零 REST 改动;R4.6/R7.2 的退化行为由 seam 的 fail-safe 天然承担。

### ExtSlotRegion 不透传 state(唯一宿主缺口)
- **Context**: 快捷设置组件需要 state access,但输入区槽经 `ExtSlotRegion → SlotHost` 渲染时未传 state(extension-slots.tsx:53)。
- **Findings**: `SlotHost` 本身已支持 `state` prop(panelRight 已用);缺的只是 ExtSlotRegion 的一个可选 prop 透传。
- **Implications**: 一处领域无关小改,与既有 upload/surface 透传同款范式(prop 注入而非 React context——webext 是独立 bundle,context 身份不跨 bundle)。

### 交互追问写回的范围
- **Context**: R5"自动记住工具提示的模型选择"——追问里选过的值写回偏好。
- **Findings**: `resolveRequiredParams` 的 spec 是通用参数数组(param 名任意,如 prompt 类 input 型不应记住)。
- **Implications**: 写回采用**白名单**:仅 `param ∈ {model, size}` 读/写 `aigc.<param>`,避免误记一次性输入。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 新 SlotKey promptToolbar + state 桥 KV(选定) | 工具排 map 内插领域无关槽;偏好走既有权威 KV 双向同步 | 零协议大改、零 REST;与 AAS/state 桥范式同构;宿主中立 | SlotKey enum 增值需同步 chat-app 测试 mock | 与 launcherRail 增槽先例一致 |
| B. 复用 accessoryBelowEditor/InlineRight | 零宿主改动 | 无新槽 | 用户已否决(位置不对/遮挡输入) | mock 截图对比后拍板 |
| C. 宿主内置 AIGC 选择器(toolbarOrder 加控件) | 最少文件 | — | 宿主引入领域语义,破坏 agent-source 独立性(红线) | 直接排除 |

## Design Decisions

### Decision: 偏好键与清单键约定
- **Context**: UI 与工具两侧需对同一 KV 键达成一致。
- **Selected Approach**: 偏好 `aigc.model` / `aigc.size`;清单 `aigc.models` / `aigc.sizes`(由 aigcExtension 装配期写入,单一事实源 = 工具 routes)。
- **Rationale**: 清单经 KV 下发使"新增 provider 自动出现在选择器",UI 无需 import tool-kit(providers 有 Node 依赖,浏览器不安全)。
- **Trade-offs**: UI 需为 KV 未就绪时准备 fallback 常量(与 workbench DEFAULT_MODEL_OPTIONS 同值)。
- **Follow-up**: workbench 的硬编码清单可后续统一消费 `aigc.models`(本 spec 不重构,Out of scope)。

### Decision: 工具侧偏好接缝走 deps 注入
- **Context**: KV 优先级需可单测;`getSessionState()` 读 globalThis,测试需隔离。
- **Selected Approach**: `runImageTool` 的 deps 增加 `getState?: () => SessionStateAccess`(默认 `getSessionState`),单测注入 fake。
- **Rationale**: 与既有 `deps.getCtx/fetchImpl` 注入范式一致;不动 session-state.ts。

### Decision: 跨会话记忆放 UI 侧 localStorage seed
- **Context**: KV 是会话级;R6 要求同浏览器跨会话保留。
- **Selected Approach**: 组件变更时双写(KV + localStorage `pi-web.aigc.model/size`);挂载时若 KV 无值且 localStorage 有 → `state.set` 回填(seed),从而 R6.3(新会话工具直接生效)成立。
- **Trade-offs**: agent 无法感知"浏览器记忆"本身——但偏好语义本来就属用户侧,seed 后权威仍在 KV。

## Risks & Mitigations
- SlotKey enum 增值 → chat-app 两测试 mock(vi.mock @blksails/pi-web-ui)缺新导出会崩(合并 main 时已发生过同型事故)— 任务中显式包含 mock 同步。
- stub e2e 无真实 provider → 浏览器 e2e 验 UI↔KV↔回显链与渲染位置;工具消费优先级由 tool-kit 单测覆盖(stub 有 state seam,可模拟追问写回帧)。
- webext bundle 隔离(context 不跨 bundle)→ 组件一切依赖走 props(state),不依赖 React context。

## References
- `.kiro/specs/state-injection-bridge/`(state 桥全链)- `packages/tool-kit/src/session-state.ts`(工具侧 seam)
- `docs/agent-authoritative-surface-design.md`(AAS 中立搬运范式)
- memory: agent-authoritative-surface-design / state-injection-bridge-spec / aigc-detoolspec-extension
