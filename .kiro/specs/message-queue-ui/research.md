# Gap 分析：message-queue-ui

> 目的：分析「pi message queue 前端接线 + 取回回环」相对现有代码库的实现缺口，为 design 提供接缝、方案与风险。信息与选项优先，不做最终决策。

## 1. 现状总览（按层）

### protocol（`packages/protocol`）
- `PromptRequestSchema.streamingBehavior: "steer"|"followUp"`（`transport/rest-dto.ts:71`）— 忙时排队行为，已在 `/messages` 契约。
- `SteerRequestSchema = { message, images? }`（`rest-dto.ts:81-85`）— **无 `attachmentIds`**：忙时排队只能带文本+内联图片。
- `control:"queue"` 帧 `{ steering[], followUp[] }`（`transport/sse-frame.ts:26-31`）。
- `data-pi-queue` 数据部件 `{ type, data:{steering[],followUp[]} }`（`transport/data-part.ts`）。
- `queue_update` 事件 + `pendingMessageCount`（`rpc/event.ts:152-154`、`rpc/session-state.ts:30`）。
- **自定义子进程行 schema 模板**：`web-ext/state.ts` 的 `StateLineSchema`（stdout 上报）/ `StateSetLineSchema`（stdin 下发）——clearQueue 的自定义行可照此新增。
- `rpc/command.ts` / `rpc/response.ts` 的 `RpcCommand`/`RpcResponse` 判别联合**不含 `clear_queue`**。

### server（`packages/server`）
- `/steer`、`/follow_up` handler（`http/routes/command-routes.ts:138-174`，validate→requireSession→`session.steer/followUp`→ack），注册于 `http/create-handler.ts` 的 `builtins: RouteSpec[]`（`:118-124`）。新端点直接追加一条 `RouteSpec` 即可。
- `PiSession.steer/followUp/forward`（`session/pi-session.ts:710-769`）；`SessionChannel` 接口（`session/session.types.ts:84-91`）——**无 clearQueue**。
- `PiSession.handleRawLine`（`pi-session.ts:527+`）已截获子进程自定义 stdout 行 `piweb_state` → 翻译 `control:"state"` 帧；`control:"ui-rpc"` 用 `correlationId` 做请求/响应配对（`:524-570`）。这是 clearQueue 请求/响应关联的现成范式。
- **自定义 runner 持有 `runtime.session`（AgentSession）**：`runner/runner.ts:289` `createAgentSessionRuntime` → `runtime.session`；`:319` `wireStateBridge` 在 `:348 runRpcMode(runtime)` **之前**给 `process.stdin` 挂**第二个 JSONL 读取器**并经 `fs.writeSync(1)` 写回 stdout（`runner/state-wiring.ts`，全套模板）。
- **子进程 spawn 仅见 custom runner 引导路径**（`runner-bootstrap.mjs`，`runner-bootstrap-path.ts`），未见 `pi --mode rpc` fallback 的 spawn 装配 → 现网基本单一走 custom runner（design 需复核）。

### react（`packages/react`）
- `PiClient.steer/followUp`（`client/pi-client.ts:99-101,238-240`，POST `/steer`、`/follow_up`）。
- `usePiControls().steer/followUp`（`hooks/use-pi-controls.ts:186-202`）、权威 `busy`（`:232 controlSnapshot?.session?.busy`）。
- control-store 维护 `queue:{steering,followUp}` 快照（`sse/control-store.ts:20-24,185-189`），经 `useSyncExternalStore` 暴露 `controlSnapshot`。**但 `usePiControls` 返回值未透出 `queue`**——组件需扩展 hook 暴露 `queue`，或直接读 `controlStore.getSnapshot().queue`。
- `data-pi-queue` 被 `decode-chunk.ts:92` 解码后进 `useChat.messages`（第二条冗余通路，与 `control:queue` 快照并存）。

### ui（`packages/ui`）—— 缺口全部在此 + 少量 react
- `PiChat.doSend`（`chat/pi-chat.tsx:618-658`）拼 `body`（images/attachmentIds）→ `useChat.sendMessage`；**从不设 `streamingBehavior`、从不调 steer/followUp**。
- `canSubmit`（`:613-616`）= transport & sessionReady & 有内容，**不看 busy**。
- `isBusy`（`:530-532`）权威取自 `controls.busy`。
- `elements/prompt-input.tsx` `handleKeyDown`（`:162-183`）仅处理 Enter 提交（受 `suppressEnterSubmit` 门控）、Shift+Enter 换行、Tab 接受 ghost；**无 Alt+Enter、无面向队列的 Esc**（Esc 目前由各补全浮层各自 `document.keydown` 处理）。
- `elements/submit-button.tsx:47` busy 时按钮切 Stop（点击 abort）——**忙时提交只能靠键盘**（Enter/Alt+Enter）。
- 队列快照**无任何组件渲染**。可复用浮层样式：`completion/pi-completion-popover.tsx`、`controls/pi-command-palette.tsx`（z-30 rounded border shadow + caret 锚定）。

### pi SDK（`@earendil-works/pi-coding-agent@0.80.3`）
- `AgentSession.clearQueue(): { steering[], followUp[] }` **存在**（`core/agent-session.d.ts:392`），另有 `steer/followUp/getSteeringMessages/getFollowUpMessages/pendingMessageCount`、`prompt(text, {streamingBehavior})`（`:330`，`@throws Error if streaming and no streamingBehavior specified`）。
- **`clear_queue` 不在 pi 的 RPC 命令集**（`modes/rpc/rpc-types.d.ts` 的 `RpcCommand`、`rpc-client.d.ts` 的 `RpcClient` 均无）。⇒ 走标准 RPC 命令拿不到 clearQueue。

## 2. 需求可行性

| 需求 | 结论 | 关键依据 |
| --- | --- | --- |
| R1 忙时按语义排队 | ✅ 低风险 | busy/steer/followUp 全就绪，仅接线 composer + 键盘 |
| R2 队列可视化/计数 | ✅ 低风险 | `control:queue` 快照就绪，仅需透出+渲染 |
| R3 取回（clearQueue） | ⚠️ 中风险 | clearQueue 不在 pi RPC，但 custom runner 持 `runtime.session` 可直接调，经 state-bridge 式自定义帧闭环（见下）|
| R4 忙时错误防护 | ✅ 低风险 | R1 附带排队行为即根治 SDK 报错 |
| R5 附件/补全退化 | ✅ 低风险 | 补全链路复用；`att_` 附件受 SteerRequest 无 attachmentIds 约束需降级 |
| R6 契约/测试 | ✅ | 端点走 protocol schema；测试模板齐备（见 §5）|

## 3. 实现方案选项

### R1/R2/R4/R5（接线）— 推荐 **Option A 扩展 + 小新增**
- `PiChat.doSend` 增排队分支：`isBusy` 时按提交意图（Enter=steer / Alt+Enter=followUp）改调 `controls.steer/followUp`（或给 `sendMessage` body 注 `streamingBehavior`）；`canSubmit` 解除 busy 阻断。
- `prompt-input.tsx.handleKeyDown` 增 Alt+Enter 分支（透出提交意图给 `onSubmit`）。
- **队列展示区**：新增小组件 `PiQueuePanel`（复用 popover 样式），数据源取**权威 `control:queue` 快照**；`usePiControls` 结果透出 `queue`（或组件直读 `controlStore`）。带稳定 `data-*`（如 `data-pi-queue-count`）供 e2e。
- **数据通路取舍（design 决策）**：`control:queue`（粘性、权威、订阅回放）优先；`data-pi-queue`（进 messages）冗余，建议忽略/停消费，避免双源。

### R3 取回（clearQueue）— 三子选项
- **A3a（推荐）自定义帧 + 请求/响应关联**：新增 `runner/clear-queue-wiring.ts`（照 `state-wiring.ts`）——第二 stdin reader 截获 `{type:"piweb_clear_queue", id}` → 调 `runtime.session.clearQueue()` → `writeSync(1)` 回 `{type:"piweb_clear_queue_result", id, steering, followUp}`；`PiSession.handleRawLine` 按 `id` 配对 pending промise（照 `ui-rpc`/`pendingExtensionUI` 范式）→ 作 `POST /sessions/:id/clear_queue` 同步响应体返回。protocol 加自定义行 schema（照 `web-ext/state.ts`）+ REST `ClearQueueResponse`；react 加 `client.clearQueue` + `usePiControls.clearQueue`；ui 接 Esc/Alt+Up。**pi 上游零改动**，与既有桥接一致，server 权威。
- **A3b 上游 pi RPC `clear_queue`**：最干净的协议形态，但不在本仓可控范围、需 pi 发版，**当前不选**。
- **A3c 复用 abort 近似**：不引 clearQueue，Esc→abort。语义与 pi 不符、丢失队列文本，**已在需求阶段否决**。

## 4. 关键风险与研究项（design 阶段处理）
1. **模式覆盖（R3）**：A3a 仅在 custom runner 模式生效；design 须复核是否仍存 `pi --mode rpc` fallback spawn，若在则该模式取回降级（隐藏取回入口或提示）。当前搜查仅见 custom runner 引导路径。
2. **请求/响应关联**：clearQueue 是请求→响应，比 state 单向 push 复杂；需引入 `id` + pending map + 超时/失败兜底（照 `ui-rpc` correlationId）。
3. **Esc 冲突**：补全/命令浮层已占用 Esc（`document.keydown`）；取回 Esc 必须让位——仅在浮层关闭且队列非空时触发。
4. **`att_` 附件降级（R5.2）**：SteerRequest 无 `attachmentIds`；忙时带引用附件须阻止排队并提示（不静默丢弃）。
5. **双 stdin reader**：pi 自身 reader 会对自定义行回无害 `Unknown command`（server 端 id=undefined 丢弃），与 state 桥同已知无害行为。
6. **双队列通路去冗余**：确认停用/忽略 `data-pi-queue` 进 messages 的路径，避免与 `control:queue` 快照重复渲染。

## 5. 测试脚手架（已就绪，可复用）
- 命令路由单测：`packages/server/test/http/command-routes.test.ts`（MockSession 记录调用 + createPiWebHandler）。
- 会话命令单测：`packages/server/test/session/pi-session.commands.test.ts`（mock-channel 驱动转发/生命周期/帧）。
- 集成 e2e：`packages/server/test/http/http.e2e.test.ts`（建会话→订阅流→POST→增量帧）。
- Node stub e2e：`PI_WEB_STUB_AGENT=1` + `packages/server/test/session/fixtures/session-stub-process.mjs`（需扩展：发 `queue_update`/`control:queue`、模拟 busy、应答自定义 clear_queue 行）。
- 浏览器 e2e：`NEXT_DIST_DIR=.next-e2e` + external server（skill §3）；参考 `packages/react/test/e2e/*`。

## 6. 复杂度与工作量
- R1/R2/R4/R5：**S**（既有接缝，接线为主）。
- R3：**M**（跨 4 层 + 请求/响应关联 + runner 新桥）。
- 总体：**M（约 3–5 天）**，主要成本在 R3 的 clearQueue 闭环与 e2e stub 扩展。

---

## 7. Design Synthesis（design 阶段）

### 泛化（Generalization）
- steer / followUp / 常规 prompt 是「按投递意图提交」的三个变体 → composer 统一为单一提交入口，按 `(isBusy, altKey)` 派生投递意图（idle→prompt；busy+Enter→steer；busy+Alt+Enter→followUp）。接口泛化，实现只覆盖当前三态。
- 队列展示只消费**单一权威源** `control:queue` 快照（粘性/订阅回放），不再从冗余 `data-pi-queue` messages 通路渲染。

### Build vs Adopt
- **Adopt**：`control:queue` 快照（react control-store 已就绪）、state-bridge 的「第二 stdin reader + `writeSync(1)`」接缝范式、`pendingExtensionUI`/`ui-rpc` 的 correlationId 请求/响应范式、popover 样式（PiCompletionPopover）。
- **Build（最小）**：`PiQueuePanel` 组件、`wireClearQueueBridge`（runner）、`PiSession.clearQueue` 请求/响应关联、composer 提交意图分支。
- **Reject**：上游 pi RPC 新增 `clear_queue`（不可控/需发版）；abort 近似取回（语义错、丢文本）。

### 简化（Simplification）
- 不建通用「自定义命令 over stdin」框架——clearQueue 只此一个方法，走专用自定义行对（`piweb_clear_queue` / `piweb_clear_queue_result`）。
- 关联 id 隔离在 `PiSession.pendingClearQueue`（独立于 `PiRpcProcess` 的 RPC pending map），pi 自身 stdin reader 对该行回无害 `Unknown command`（id 不匹配→丢弃），与 state-bridge 同已知无害行为。
- 不改 `SessionChannel` 接口：clearQueue 请求经既有 `channel.send(rawLine)` 下发（与 `setState`/`uiRpc` 同）。
