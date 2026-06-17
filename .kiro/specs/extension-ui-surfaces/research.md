# Research & Design Decisions — extension-ui-surfaces

## Summary
- **Feature**: `extension-ui-surfaces`
- **Discovery Scope**: Extension(对既有系统的集成扩展)
- **Key Findings**:
  - 协议层 `RpcExtensionUIRequestSchema` 已解析全部 9 个 method;`RpcExtensionUIResponseSchema` 仅 `value/confirmed/cancelled` 三分支 → 推送类 5 方法无回包、为 fire-and-forget,**无需协议/server 改动**。
  - `ControlStore.applyControlFrame` 当前把所有 extension-ui 请求塞进单一 FIFO `extensionUiQueue`;`useExtensionUI.current=queue[0]`,而 `PiPermissionDialog` 只渲染交互类 4 方法 → 推送类排队首时阻塞后续交互对话框(确有缺陷)。
  - `PiChatPro` 经 `extensionUI?: UseExtensionUIResult` prop 注入并自持 `setInput`,具备接线 title/editorText/ambient 面的天然挂载点;仓库内 `PiChatPro` 无包内/应用引用,收敛影响面小。
  - e2e 经确定性 stub(`lib/app/stub-agent-process.mjs`)发同款 `extension_ui_request` 帧;增发 5 个推送帧即可端到端验证,无 API 成本。

## Research Log

### 推送类方法是否需要回包
- **Context**: 决定 ambient 是否需要 `respond/ack`。
- **Sources Consulted**: `packages/protocol/src/rpc/extension-ui.ts`(派生自 pi 0.79.x `rpc-types.d.ts`);`packages/react/src/hooks/use-extension-ui.ts`。
- **Findings**: 响应 schema 仅 3 分支,均对应交互类(select/input/editor→value、confirm→confirmed、取消→cancelled)。推送类无任何匹配回包形状。
- **Implications**: ambient 路径完全不调 `client.uiResponse`;不入对话框队列;无 pending/error 语义。

### 分流落点与订阅机制
- **Context**: 在哪一层分流推送类。
- **Sources Consulted**: `control-store.ts`、`connection.ts`、`use-extension-ui.ts`。
- **Findings**: `ControlStore` 是唯一的控制旁路 store,已被 `useSyncExternalStore` 订阅、引用稳定。
- **Implications**: 在 `applyControlFrame` 的 `extension-ui` 分支按 method 分流最小且自然;无需新增 store 或新订阅通道。

### PiChat 收敛影响面
- **Context**: 把富组件设为默认 `PiChat` 是否破坏现有引用。
- **Sources Consulted**: `packages/ui/src/index.ts`、全仓 `grep PiChatPro`。
- **Findings**: `index.ts` 同时导出 `PiChat`(最小)与 `PiChatPro`(富);`PiChatPro` 在包/应用层无直接引用(app 装配点经 lib/app)。
- **Implications**: 收敛为 `PiChat`(富)/ `PiChatBasic`(最小)/ `PiChatPro`(别名)安全;仅需更新 index 与 app 装配点导入。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 单 store 双通道(选定) | 在 ControlStore 同一入帧点按 method 分流:交互→FIFO 队列,推送→ambient 切片 | 复用既有订阅;最小改动;天然修复阻塞缺陷 | ControlStore 职责略增 | 与既有不可变快照模式一致 |
| 新建独立 ambient store | 为推送类单设 store + hook | 职责更纯 | 新增订阅通道与装配接线;重复样板 | 收益不抵成本 |
| 在 hook 层过滤 | store 不变,useExtensionUI 内部分流 | store 零改动 | 推送类仍入队列 → 不能修复阻塞缺陷 | 否决 |

## Design Decisions

### Decision: 推送类不入对话框队列(修复阻塞缺陷)
- **Context**: 推送类落队首会阻塞交互对话框。
- **Alternatives Considered**: 1) hook 层过滤(store 仍入队,治标不治本);2) store 层分流(选定)。
- **Selected Approach**: `applyControlFrame` 按 method 分流,推送类写 ambient、绝不入 `extensionUiQueue`。
- **Rationale**: 一处改动同时实现呈现与缺陷修复。
- **Trade-offs**: ControlStore 体积略增,换取正确性与零新订阅。
- **Follow-up**: 单测断言交互类仍入队、推送类不入队。

### Decision: set_editor_text 用一次性 seq 信号
- **Context**: 写入输入框是命令式事件,非保留态。
- **Alternatives Considered**: 1) 仅存最新 text(无法区分"再次写入同文本");2) `{text, seq}` 信号(选定)。
- **Selected Approach**: 每次自增 seq;装配层 `useEffect([seq])` 应用一次 `setInput`。
- **Rationale**: 可重复触发、可测试、不污染用户后续编辑(Req 5.3/5.4)。
- **Trade-offs**: 需消费方按 seq 去重触发。

### Decision: 富组件收敛为默认 PiChat
- **Context**: 用户要求默认即富界面。
- **Selected Approach**: `PiChat`=富、`PiChatBasic`=最小、`PiChatPro`=废弃别名。
- **Rationale**: 默认富界面 + 非破坏保留 + 过渡别名。
- **Trade-offs**: `PiChatProps` 语义由最小变富;因无外部引用,影响可控。

## Risks & Mitigations
- 通知无限增长(元件未挂载场景) — store 设软上限(保留最近 100)+ 元件自动消失。
- 收敛改名波及测试 — 迁移 `pi-chat-pro.test.tsx` 为 `pi-chat.test.tsx`,保留别名等价测试。
- e2e stub 发帧时序 — 在 confirm 帧之前发推送帧,确保两类同窗,验证不阻塞。

## References
- `packages/protocol/src/rpc/extension-ui.ts` — 9 method 请求 schema 与 3 分支响应 schema。
- `packages/react/src/sse/control-store.ts` — 控制旁路 store(分流落点)。
- `packages/ui/src/chat/pi-chat-pro.tsx` — 富装配组件(收敛源)。
- `lib/app/stub-agent-process.mjs` — 确定性 e2e stub(发帧点)。
