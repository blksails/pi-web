# Implementation Plan

## 1. Foundation：协议契约

- [x] 1.1 定义 clearQueue 自定义行与 REST 响应契约
  - 新增子进程内部行 schema：`piweb_clear_queue`（含关联 id）请求行、`piweb_clear_queue_result`（含 id + steering + followUp 字符串数组）结果行。
  - 新增 REST `ClearQueueResponse` schema（`{ steering: string[], followUp: string[] }`）；请求为空体。
  - 从 protocol 包桶文件导出三者，`pnpm --filter @blksails/pi-web-protocol test` 与 typecheck 通过。
  - 观察完成：新 schema 可被 server/react 导入并对合法/非法样例 `safeParse` 给出正确结果。
  - _Requirements: 3.1, 6.1_
  - _Boundary: queue-line schema, ClearQueueResponse_

## 2. Core：server clearQueue 通道

- [x] 2.1 (P) 实现并装配 clearQueue runner 桥
  - 新增 `wireClearQueueBridge`：在 `runRpcMode` 前挂第二个 stdin JSONL 读取器，截获 `piweb_clear_queue{id}` → 调 `runtime.session.clearQueue()` → 经 `writeSync(1)` 写回 `piweb_clear_queue_result{id,…}` 结果行；仅消费自身行，其余交 pi。
  - 在 runner 启动流程装配该桥并接入 SIGTERM/SIGINT/beforeExit cleanup；装配失败记 stderr、能力降级、不抛（会话仍启动）。
  - 观察完成：向桥注入一条 `piweb_clear_queue` 行，stdout 出现对应 `piweb_clear_queue_result` 行（steering/followUp 来自 stub session）。
  - _Requirements: 3.1_
  - _Boundary: wireClearQueueBridge_
  - _Depends: 1.1_

- [x] 2.2 (P) 实现 PiSession.clearQueue 请求/响应关联
  - 新增 `clearQueue()`：assertActive→生成隔离 reqId→登记 pendingClearQueue→`channel.send(piweb_clear_queue)`→超时兜底（默认约 5s reject）。
  - 在 `handleRawLine` 增 `piweb_clear_queue_result` 分支：按 reqId 配对 resolve；未知 id 忽略；结果行经 schema 校验后再 resolve。
  - 观察完成：mock-channel 回灌结果行时 `clearQueue()` resolve 被清文本；无结果行时按超时 reject；reqId 与 RPC pending map 不冲突。
  - _Requirements: 3.1, 3.6_
  - _Boundary: PiSession_
  - _Depends: 1.1_

- [x] 2.3 暴露 POST /sessions/:id/clear_queue 端点
  - 新增 clearQueue handler：requireSession→`session.clearQueue()`→以**同步响应体**返回 `ClearQueueResponse`；错误经既有 `mapEngineError`（404 无会话 / 409 已停 / 504 超时 / 500）。
  - 在内置路由表注册该端点。
  - 观察完成：对活跃会话 `POST /clear_queue` 返回 200 + `{steering,followUp}`；会话已停返回 409。
  - _Requirements: 3.1_
  - _Boundary: server/http Route Layer_
  - _Depends: 2.2_

## 3. Core：react 客户端与控制透出

- [x] 3.1 (P) 新增 PiClient.clearQueue
  - `clearQueue(id)` 发 `POST /sessions/:id/clear_queue`，解析响应体为 `ClearQueueResponse`（非仅 ack）。
  - 观察完成：调用后返回被清 steering/followUp 数组；错误状态码抛出可辨错误。
  - _Requirements: 3.1, 3.2_
  - _Boundary: PiClient_
  - _Depends: 1.1_

- [x] 3.2 usePiControls 透出 queue 快照与 clearQueue 动作
  - 返回值新增只读 `queue`（取自 control:queue 快照，无连接回退空）与 `clearQueue`（经 requireReady 包装 client.clearQueue）。
  - 观察完成：control:queue 帧到达后 `queue` 更新；`clearQueue()` 透传返回被清文本；既有 steer/followUp/busy 不受影响。
  - _Requirements: 2.1, 3.2_
  - _Boundary: usePiControls_
  - _Depends: 3.1_

## 4. Core：UI 组件与提交意图

- [x] 4.1 (P) 实现 PiQueuePanel 队列展示组件
  - **纯 props 呈现组件**（不引入数据源）：入参 `queue` 由挂载方注入；渲染 steering / follow-up 分组条目与 pending 合计计数；`total===0` 返回 null（空队列不占布局）；复用 popover 样式。
  - 暴露稳定标记：容器 `data-pi-queue`、计数 `data-pi-queue-count`。
  - 观察完成：给定非空 queue props 渲染条目与计数节点；空 queue 渲染为空。数据注入延后到集成任务 5.1（此处不依赖 usePiControls）。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: PiQueuePanel_

- [x] 4.2 (P) 扩展 PromptInput 键盘语义
  - Enter 提交透出 `followUp = e.altKey` 意图；Shift+Enter 仍换行；队列非空且无补全浮层时 Esc/Alt+Up 触发 `onRequestRetrieve`（让位补全浮层的 Esc）。
  - 观察完成：Alt+Enter 触发带 followUp 意图的提交回调；队列非空时 Esc 触发 onRequestRetrieve，空队列或浮层开启时不触发。
  - _Requirements: 1.1, 1.2, 3.5_
  - _Boundary: PromptInput_

- [x] 4.3 PiChat 提交意图派生与忙时守卫
  - `doSend` 按 `(isBusy, followUp)` 派生投递：idle→常规 prompt（含附件/补全，零回归）；busy+Enter→`steer`；busy+Alt+Enter→`followUp`，提交后清空输入框；忙时始终携带排队行为（消除 SDK 报错）。
  - `canSubmit` 解除隐式 busy 阻断（仍要求 transport & sessionReady & 有内容）；未就绪仍拒绝提交。
  - 忙时若含 `att_` 引用附件→阻止排队并提示改空闲发送（不静默丢弃）；排队投递失败→可见反馈且不清输入。
  - 观察完成：busy 下 Enter/Alt+Enter 分别触发 controls.steer/followUp；idle 走既有 prompt；busy+att_ 被拦截提示。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 4.1, 4.2, 5.1, 5.2, 5.3_
  - _Boundary: PiChat_
  - _Depends: 3.2, 4.2_

## 5. Integration：取回回环与面板挂载

- [x] 5.1 接线取回回环并挂载队列面板
  - 挂载 `PiQueuePanel` 于 composer 上方；`onRequestRetrieve` → `controls.clearQueue()` → 空框回填 / 非空追加（换行，先 steering 后 followUp，多条稳定顺序）；端点失败提示且不改编辑器现有内容。
  - 保持排队与中止并存（Stop/abort 能力不受影响）；取回后队列面板随 control:queue 清空而隐藏。
  - 观察完成：队列非空时 Esc 取回，被清文本进入编辑器且 `data-pi-queue-count` 归零；clearQueue 失败时编辑器内容不变并有提示。
  - _Requirements: 1.5, 2.1, 3.2, 3.3, 3.4, 3.6_
  - _Boundary: PiChat_
  - _Depends: 2.3, 3.2, 4.1, 4.3_

## 6. Validation：测试

- [ ] 6.1 单元测试
  - 覆盖：protocol 行/响应 schema 解析；`PiQueuePanel` 非空/空渲染与 data-* 值；`PiSession.clearQueue` reqId 关联 resolve / 超时 reject / 迟到结果丢弃；`doSend` 意图派生（idle/steer/followUp/att_ 拦截）；取回回填（空框/追加/多条顺序）。
  - 观察完成：相关包 `pnpm test` 新增用例全绿。
  - _Requirements: 3.1, 3.6, 5.2, 6.1, 6.2_
  - _Depends: 4.3, 5.1_

- [ ] 6.2 集成测试与 stub 扩展
  - `command-routes` 集成：`POST /clear_queue` 调 session.clearQueue 并返回响应体，409/404 分支；`wireClearQueueBridge` 注入 stdin 请求行→断言 stdout 结果行；`usePiControls` queue 随帧更新。
  - 扩展 stub agent：可发 `control:queue`/模拟 busy/应答 `piweb_clear_queue` 行。
  - 观察完成：集成用例全绿；stub 能驱动 busy + 队列 + clear_queue 回环。
  - _Requirements: 3.1, 6.2_
  - _Depends: 2.1, 2.3, 3.2_

- [ ] 6.3 浏览器端到端关键回环
  - 隔离构建（`NEXT_DIST_DIR=.next-e2e`）+ external server：选源 → 触发 busy → 输入并 Enter 排队 → `data-pi-queue-count` 增 → Esc 取回 → 文本回编辑器且队列清空。
  - 观察完成：Playwright 用例走通「忙时排队→可视化→取回」全回环并断言 data-* 状态。
  - _Requirements: 1.1, 2.2, 3.2, 6.3_
  - _Depends: 5.1, 6.2_
