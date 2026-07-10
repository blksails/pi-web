# 22 · 消息队列

pi coding agent 在处理某个轮次(turn)时是「忙碌」的。此时用户若想继续引导任务,不必等待——可以把后续消息**排队**:`steering`(插话)消息会在当前 assistant 轮的工具调用间隙投递,`follow-up`(跟进)消息会在 agent 全部工作结束后投递。用户还能把尚未投递的排队消息**取回**编辑器继续修改或撤回。

本章讲述 pi-web 如何把 pi 的 message queue 能力接线到 Web 前端:忙时按投递语义排队、可视化待投递队列与 pending 计数、取回回填编辑器。这套交互对齐 pi 原生 TUI。对应 spec 见 `.kiro/specs/message-queue-ui/`。

---

## 1. 它解决什么 / 能力边界

**解决的问题**:agent 处理长任务时,用户此前只能干等。忙时若直接提交,还会触发 pi SDK「streaming 时缺少 `streamingBehavior`」的底层报错。本特性让忙时提交按「插话 / 跟进」意图排队,消除该报错,并补齐「取回」回环。

**队列的权威源在 agent 子进程**。pi SDK 决定排队与投递策略(`steeringMode` / `followUpMode` 的 `one-at-a-time` / `all`);pi-web 只**消费**其发出的队列快照并**触发**取回,不改变投递算法。

**能力边界(In / Out of scope)**:

| 能力 | 状态 | 说明 |
|---|---|---|
| 忙时 Enter 插话 / Alt+Enter 跟进排队 | ✅ | 派生投递意图,始终携带排队行为 |
| 队列可视化 + pending 计数 | ✅ | `PiQueuePanel`,空队列不占布局 |
| Esc / Alt+↑ 取回到编辑器 | ✅ | 空框回填 / 非空追加 |
| 排队与中止(Stop/abort)并存 | ✅ | 忙时主按钮仍是 Stop,排队靠键盘 |
| 忙时排队承载 `att_…` 引用附件 | ❌ | `steer`/`follow_up` 端点仅收 `message`+内联图片;忙时带引用附件 → 阻止排队并提示 |
| 队列内单条删除 / 重排 | ❌ | 快照仅为字符串数组,无稳定条目 id |
| 切换 `steeringMode` / `followUpMode` | ❌ | pi 子进程权威,前端不干预 |

底层管道(protocol 的 `streamingBehavior` / `control:queue` / `data-pi-queue` / `queue_update`、server 的 `/steer` `/follow_up` 路由、react 的 `steer`/`followUp`)早已就绪;本特性补齐前端接线与 `clearQueue` 取回端点。

---

## 2. 排队交互(忙时提交)

投递意图由 `(isBusy, altKey)` 单点派生:

| 会话状态 | 提交键 | 投递意图 |
|---|---|---|
| idle | Enter / Alt+Enter | 常规 `prompt`(不排队,既有链路完全不变) |
| busy | Enter | `steer`(插话) |
| busy | Alt+Enter | `follow-up`(跟进) |

键位在 `packages/ui/src/elements/prompt-input.tsx` 的 `handleKeyDown` 中解析:普通 Enter 透出常规意图,`Alt+Enter` 透出 `{ followUp: true }`,`Shift+Enter` 仍为换行。补全 / 命令浮层捕获时(`suppressEnterSubmit`)Enter 让位给浮层。

派生与守卫在 `PiChat.doSend`(`packages/ui/src/chat/pi-chat.tsx`):

- **idle** → 走既有 `sendMessage` / prompt 链路(含附件、`@` 补全解析),字节级零回归。
- **busy** → `opts.followUp ? controls.followUp(req) : controls.steer(req)`,请求体为 `{ message }`(有内联图片时加 `images`);投递成功后清空输入框。
- **忙时带 `att_…` 引用附件** → 阻止排队并提示 `chat.queue.attachmentUnsupported`(不静默丢弃)。
- **投递失败** → 提示 `chat.queue.enqueueFailed` 且**不清空输入**(不丢用户输入)。

`canSubmit` 不再因 busy 被阻断——只要 `transport && sessionReady && 有内容` 即可提交(会话未就绪的门控**不放宽**)。忙时主按钮仍是 Stop,排队与中止并存。

---

## 3. control:queue 协议与粘性帧

### 3.1 队列快照的下行(双帧)

agent 子进程每次队列变化都发 `queue_update` 事件(`packages/protocol/src/rpc/event.ts`,含 `steering: string[]` 与 `followUp: string[]`)。server 的 `translateEvent`(`packages/server/src/session/translate/translate-event.ts`)把它翻译为**两帧**:

| 帧 | 通道 | 用途 |
|---|---|---|
| `data-pi-queue` | 进消息流(uiMessageChunk) | 历史 / 渲染兼容 |
| `control:"queue"` | 旁路控制帧 | **权威快照**,供 control-store 维护 `queue` → `usePiControls().queue` → 队列面板 |

`control:queue` 帧结构(`packages/protocol/src/transport/sse-frame.ts`):

```
{ control: "queue", steering: string[], followUp: string[] }
```

前端 control-store(`packages/react/src/sse/control-store.ts`)在 `case "queue"` 分支把 `{ steering, followUp }` 写入不可变快照;`usePiControls` 纯投影出只读 `queue`(无连接 / 无帧时回退空)。

### 3.2 为什么登记为粘性帧(重连收敛)

`control:queue` 被登记为**粘性帧**(sticky frame),与 `session-state` 对称。见 `packages/server/src/session/pi-session.ts`:每次广播帧时,若 `frame.payload.control === "queue"` 就写入 `StickyFrameRegistry` 的 `"queue"` 键;新订阅者(含**重连 / 迟到订阅**)订阅时,`sticky.replayInto(...)` 会一次性重放该键的最新帧。

**为何必须粘性**:忙时若不粘,用户重连后 SSE 从头订阅,`busy` 会作为粘性态回放为 `true`,但 `queue` 因无重放而为**空**——队列面板消失、`canRetrieve` 为假、取回回环静默不可用。粘性化让重连即得当前排队快照,收敛到最新 last-value。

`StickyFrameRegistry`(`packages/server/src/session/sticky-registry.ts`)只承载 **last-value** 语义(同键多次写入仅留最新);`logs` 那种 ring-buffer 历史语义不并入本表。

---

## 4. clearQueue 闭环(取回)

### 4.1 为什么走 state-bridge 式自定义帧而非 pi RPC

pi 的 `AgentSession.clearQueue()` **不在 pi 的 RPC 命令集内**。为了 pi 上游零改动,`clearQueue` 复用 state-injection-bridge 的接缝——「第二个 stdin 读取器 + 自定义 stdout 行」——在 pi-web 内部闭环。这是一条**请求 / 响应**通道(带关联 `id`),而非 state 桥的单向下行。

契约定义在 `packages/protocol/src/web-ext/queue-line.ts`,两条内部行:

| 行 type | 方向 | 字段 |
|---|---|---|
| `piweb_clear_queue` | server → runner(经 stdin) | `id` |
| `piweb_clear_queue_result` | runner → server(经 stdout) | `id` + `steering: string[]` + `followUp: string[]` |

REST 响应契约 `ClearQueueResponse`(`packages/protocol/src/transport/rest-dto.ts`):`{ steering: string[], followUp: string[] }`。

### 4.2 端到端流程

```
PiChat(Esc/Alt+↑)
  → usePiControls().clearQueue()
  → PiClient.clearQueue(id)  POST /sessions/:id/clear_queue(空体)
  → makeClearQueueHandler → PiSession.clearQueue()
      · assertActive → 生成隔离 reqId → 登记 pendingClearQueue[reqId]
      · channel.send  {"type":"piweb_clear_queue","id":reqId}   ← 经 stdin
  → runner wireClearQueueBridge 第二个 stdin 读取器截获
      · runtime.session.clearQueue()  ← 求值取当前绑定 session
      · fs.writeSync(1, {"type":"piweb_clear_queue_result",id,steering,followUp}\n)
  → PiSession.handleRawLine 按 id 配对 pending → resolve
  → 200 ClearQueueResponse(同步响应体)
  → PiChat 回填编辑器
```

关键实现点:

- **结果行必须直写 fd1**(`fs.writeSync(1, …)`)。见 `packages/server/src/runner/clear-queue-wiring.ts`:pi 的 `runRpcMode` 会 `takeOverStdout()` 把 `process.stdout.write` 重定向到 stderr;RPC 帧经原始 fd1 写出,server 读的也是子进程 fd1,故本桥也必须直写 fd1,不能用 `process.stdout.write`。
- **在 `runRpcMode(runtime)` 之前装配**(`packages/server/src/runner/runner.ts`),并接入 SIGTERM/SIGINT/beforeExit 的 `cleanup()`。
- **`runtime.session` 于调用时求值**,以覆盖进程内 `new_session` / `switchSession` / `fork` 换 session 的情形。
- **关联 id 隔离**于 `PiRpcProcess` 的 RPC pending map(独立的 `pendingClearQueue`)。pi 自身 stdin 读取器也会看到 `piweb_clear_queue` 请求行并回无害 `Unknown command`(id 不匹配 server 端 RPC pending → 丢弃),不影响本路径。
- **同步 HTTP 响应体**返回被清文本(非 SSE 空闲控制流),避免重蹈 prompt 流冲突,对齐 unified-command-result-layer 决策。
- **超时兜底**:`CLEAR_QUEUE_TIMEOUT_MS = 5000`(5s),子进程无回写即 reject;迟到结果行因 pending 已删除被安全丢弃(`handleRawLine` 未知 id 直接忽略,置于 active gate 之前)。会话收尾时即时 reject 所有在途请求。
- **优雅降级**:`wireClearQueueBridge` 装配失败 → 记 stderr、能力降级、**不抛**(会话仍启动);`runtime.session.clearQueue()` 抛错时回**空结果行**(不吞队列语义,UI 侧编辑器不变、面板保持)。

### 4.3 端点错误码

| 场景 | 状态码 |
|---|---|
| 无会话 | 404 |
| 会话已停 | 409 |
| 桥超时(子进程无回写) | 504 |
| 一般失败 | 500 |

经既有 `mapEngineError` 归一。前端一律「提示 + 不修改编辑器现有内容」。

---

## 5. 前端面板与取回

### 5.1 PiQueuePanel(队列可视化)

`packages/ui/src/chat/pi-queue-panel.tsx` 是**纯 props 呈现组件**(不引入数据源),由 `PiChat` 注入 `queue` 快照,挂载于编辑器上方。行为:

- 渲染 `steering`(插话)与 `follow-up`(跟进)**分组**待投递条目,及 pending **合计**计数。
- 合计为 0 → 返回 `null`,**不占布局**(不出现空白占位)。
- 队列快照仅字符串数组、无稳定条目 id;顺序稳定,以 index 作 key。

稳定 `data-*` 标记(供 e2e / 验收断言):

| 标记 | 含义 |
|---|---|
| `data-pi-queue` | 面板容器 |
| `data-pi-queue-count` | pending 合计计数(值为字符串数字) |
| `data-pi-queue-group="steering"｜"followUp"` | 分组 |
| `data-pi-queue-item="steering"｜"followUp"` | 单条 |

文案走 i18n:`chat.queue.title` / `chat.queue.steering` / `chat.queue.followUp`(见 `packages/ui/src/i18n/messages.ts`,zh/en 双语)。

### 5.2 取回(Esc / Alt+↑)

取回入口在 `PromptInput.handleKeyDown`:队列非空(`canRetrieve`)且无补全浮层(`!suppressEnterSubmit`)时,`Escape` 或 `Alt+ArrowUp` 触发 `onRequestRetrieve`。队列为空或浮层开启时,Esc 保持既有默认行为(如关闭补全弹层)——不误触取回。

`PiChat.onRequestRetrieve` 调 `controls.clearQueue()`,拿回被清文本后回填:

- **顺序**:先 `steering` 后 `followUp`,各自保持原有先后,以换行 `\n` 连接。
- **空框** → 直接回填;**已有未提交文本** → 追加(换行分隔),不覆盖 / 不丢弃用户已输入内容。
- 端点失败 → 提示 `chat.queue.retrieveFailed` 且不改编辑器。

取回后 agent 队列被清空 → 新的 `control:queue` 帧到达 → 面板随快照清空而隐藏、`data-pi-queue-count` 归零。

`usePiControls`(`packages/react/src/hooks/use-pi-controls.ts`)透出只读 `queue` 与 `clearQueue` 动作;`PiClient.clearQueue`(`packages/react/src/client/pi-client.ts`)POST `/sessions/:id/clear_queue` 并解析响应体(非仅 ack)。

---

## 6. 配置 / 环境变量

本特性**无专属环境变量或功能开关**——排队与取回随 `PiChat` 默认可用。行为依赖既有的两项能力:

- **会话就绪握手**(session-readiness):提交仍受就绪门控约束(见 [02 核心概念](./02-core-concepts.md))。
- **busy 权威快照**(session-snapshot-authority):忙 / 闲判定来自 `control:session-state` 粘性快照。

底层排队策略(`steeringMode` / `followUpMode`)由 pi 子进程决定,pi-web 不暴露切换入口。

---

## 7. 故障排查

- **忙时提交无反应 / 报「streaming 缺 streamingBehavior」**:确认前端已接线本特性(忙时应走 `steer` / `followUp` 而非裸 prompt)。dev 若在本特性合入前启动,handler 单例可能是旧逻辑——重启 dev。
- **重连后队列面板消失、取回不可用**:检查 `control:queue` 是否被登记为粘性帧(`pi-session.ts` 的 `sticky.set("queue", …)`)。若忙时重连后 `busy` 回放为 true 但 `queue` 为空,即粘性化缺失。
- **取回请求返回 504**:`wireClearQueueBridge` 未装配或子进程未回写结果行。确认桥在 `runRpcMode` 之前装配;非 custom runner 模式(如 `pi --mode rpc` fallback)下桥不生效——当前引导路径仅 custom runner,若引入 fallback 需给取回入口加门控降级。
- **取回文本没回填 / 回填错乱**:结果行须经 `ClearQueueResultLineSchema` 校验;顺序恒为先 steering 后 followUp。若结果行写到了 stderr 而非 fd1,说明误用了 `process.stdout.write`(被 `takeOverStdout` 劫持)——须 `fs.writeSync(1, …)`。
- **忙时带附件排队被拦截**:这是**预期行为**(`chat.queue.attachmentUnsupported`)——`steer`/`follow_up` 端点不收 `att_…` 引用附件,请在会话空闲时发送。
- **stub 测不到桥行为**:自定义 stdout 行的直写 fd1 只有**真实子进程集成测试**能抓到,stub 抓不到(同 state 桥的已知坑)。

---

## 下一步 / 相关

- `/steer` `/follow_up` `/clear_queue` 端点与 SSE 帧 → [24 HTTP/SSE API 参考](./24-http-api-reference.md)
- 会话就绪握手与 busy 权威快照 → [02 核心概念](./02-core-concepts.md)
- state-injection-bridge(自定义帧接缝的同源范式) → [12 Web UI 扩展](./12-web-ui-extension.md)
- 分层 `@blksails/*` 包职责 → [05 包结构](./05-packages.md)
