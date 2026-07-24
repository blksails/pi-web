# Implementation Plan

> 基于真实 pi 0.79.6 能力面。不改 pi 框架/协议、不改 agent 作者业务代码。详见 design.md / research.md。

- [x] 1. Foundation：协议契约与状态核
- [x] 1.1 在协议包定义状态注入桥的全部 schema 与类型
  - 新增状态下行帧载荷 schema：含 `key`、`value`(任意可 JSON)、`rev`(非负整数)、可选 `deleted`
  - 新增写回请求 schema（`key` + `value` + `op:set|delete`）与写回响应 schema（`ok` + 可选 `error`）
  - 新增 server↔runner 内部行 schema：下行 `piweb_state` 行与写回 `piweb_state_set|delete` 行
  - 将状态下行帧并入既有 SSE control 帧的判别联合，使旧消费者前向兼容（未知 control 命中既有兜底分支）
  - 经协议包 barrel 对外导出；新类型随既有 `protocolVersion` 承载
  - 完成态：协议包 `typecheck` 通过，schema 可被 server/react 引用
  - _Requirements: 5.1, 5.2, 5.4, 3.4_

- [x] 1.2 实现子进程内权威状态核（纯逻辑）
  - 实现一份会话级可变 KV：`get`(未初始化返回未定义)、`set`(返回新 rev)、`delete`、`snapshot`、`subscribe`
  - 每个 key 的 rev 从 0 起、跨 set/delete 严格单调递增
  - 变更时向订阅者派发结构化 `StateChange`（key/value/rev/deleted）
  - 状态核为旁路结构，永不进入 LLM 消息历史（context 外，默认不喂模型）
  - 完成态：纯函数单测覆盖「未初始化→未定义」「rev 单调连续」「subscribe 收到正确变更」全绿
  - _Requirements: 1.1, 1.4, 1.5, 3.5, 9.1_
  - _Boundary: SessionStateStore_

- [x] 2. Core：双向桥的各端组件
- [x] 2.1 实现 runner 子进程状态接线
  - 创建状态核实例，写入 globalThis seam 供工具与 helper 读取
  - 订阅状态核变更，将每次变更写为**完整** stdout JSON 行（下行 `piweb_state`）
  - 在进入 RPC 模式**之前**为 `process.stdin` 挂第二个 JSONL 行读取器，截获写回行并改权威态（pi 自身读取器对该行回无害 Unknown-command，不影响本路径）
  - 无变更不发任何帧；seam/挂载失败时记诊断并以「无状态桥」降级，不使会话启动崩溃
  - 返回 `cleanup`：取消订阅 + 卸载 stdin 读取器 + 清 seam
  - 完成态：单测/集成断言「stdin 写 set 行→seam KV 更新」「KV.set→stdout 出现下行行」「无用法→无额外行」
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 4.1_
  - _Boundary: wireStateBridge_
  - _Depends: 1.2_

- [x] 2.2 (P) 实现前端状态切片与 rev 守卫
  - 在既有 control store 快照增加 `states` 切片（key→{value,rev}），初值为空
  - 在 control 帧应用逻辑增加状态分支：`deleted` 删键；否则仅当帧 rev 大于已应用 rev 才更新（丢弃过期帧）；不变则不换引用
  - 对齐既有 ambient 的不可变快照惯例，不引入并行状态机制
  - 完成态：单测覆盖「rev 守卫丢弃乱序帧」「deleted 删键」「多次相同值引用稳定」
  - _Requirements: 3.2, 3.3, 6.4, 6.5_
  - _Boundary: ControlStore_
  - _Depends: 1.1_

- [x] 2.3 (P) 实现作者工具读写状态的 helper
  - 提供 `getSessionState()`：读 globalThis seam，返回工具可用的最小 KV 视图（get/set/snapshot）
  - seam 不存在时返回不可用语义（降级，不抛）
  - 完成态：单测断言「seam 存在时 get/set 直达状态核」「seam 缺失时优雅降级」
  - _Requirements: 1.2, 1.3_
  - _Boundary: getSessionState_
  - _Depends: 1.2_

- [x] 3. Integration：server 与传输接线
- [x] 3.1 在会话层接入下行翻译与写回转发
  - 扩展既有原始行处理：识别下行 `piweb_state` 行 → 合成状态 control 帧广播（仅加分支，不动既有 ui_rpc_response 分支）
  - 新增会话方法：把写回（set/delete）作为内部行发往子进程 stdin（仅发送，不等待；收敛靠下行帧）
  - 完成态：集成测试中工具改状态后前端收到状态帧；调用写回方法后子进程 seam 可见新值
  - _Requirements: 3.1, 4.1, 4.2, 8.3_
  - _Boundary: PiSession_
  - _Depends: 1.1, 2.1_

- [x] 3.2 新增状态写回路由并注入 handler
  - 新增 `POST /sessions/:id/state`：校验请求 schema，失败→400 不改权威态；成功→调会话写回方法→200 同步响应体 ack
  - 经既有路由注入 seam 装配（与会话列表路由同形），未知 session→404
  - 完成态：路由集成测试覆盖 合法写回 200、非法负载 400、未知会话 404
  - _Requirements: 4.1, 4.3, 4.4, 5.3_
  - _Boundary: createStateRoutes_
  - _Depends: 1.1, 3.1_

- [x] 3.3 在 runner 启动序列装配状态桥
  - 在 runner 启动中、进入 RPC 模式之前调用状态接线（位于既有 attachment/title 接线之后）
  - 完成态：真实子进程启动后 seam 就绪、下行/写回两条内部行均可工作；未用状态的会话无回归
  - _Requirements: 2.1, 2.2, 8.4_
  - _Boundary: runner startup_
  - _Depends: 2.1_

- [x] 3.4 实现前端订阅/写回 hook 与传输方法
  - 新增传输方法：`setState(sessionId,key,value,op)` → `POST /sessions/:id/state`
  - 新增 `useExtensionState(key)`：经 `useSyncExternalStore` 订阅 `states` 切片返回当前值 + 写入函数；写入走传输方法
  - 多组件订阅同一 key 读到一致值
  - 完成态：hook 单测覆盖「帧到重渲为新值」「setter 触发传输 setState」「同 key 多订阅一致」
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: useExtensionState, transport_
  - _Depends: 1.1, 2.2_

- [x] 3.5 在 web-kit 暴露 webext 状态读写
  - 在 webext 宿主上下文暴露 state 读/写/订阅，内部转调与前端同一 control store / 传输通道
  - 写回沿用既有 webext 信任门控边界，不新增绕过路径
  - 完成态：单测断言 webext state API 读写经同一通道、行为与 hook 一致
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: WebExtHostContext_
  - _Depends: 3.4_

- [x] 4. Validation：示例源、集成与端到端
- [x] 4.1 新增状态桥示例 agent 源
  - 示例注册经 helper 读写状态的工具（如 increment/read）；附 `.pi/web` 用 `useExtensionState` 渲染并可点击写回
  - 在示例索引登记一行
  - 完成态：示例可被 pi-web 加载，工具读写与 UI 控件均指向同一状态
  - _Requirements: 1.2, 1.3, 7.1_
  - _Depends: 2.3, 3.4_

- [x] 4.2 真实子进程集成测试（双向两条路径）
  - 路径一：工具 `set` → stdout 下行行 → 会话层合成状态帧
  - 路径二：写回路由/方法 → stdin 写回行 → runner 第二读取器改 KV → 工具下次 `get` 读到新值
  - 降级：无 seam/挂载失败时会话仍能正常起 prompt
  - 噪声：写回行不致 UI 可见副作用、不破坏既有帧
  - 回归：MCP 服务、内置/作者工具、ambient(`ctx.ui.*`)与既有 ui-rpc 贡献点行为不变
  - 完成态：集成测试全绿，覆盖上述各点
  - _Requirements: 1.3, 3.1, 4.1, 2.4, 8.1, 8.2, 8.3, 9.2_
  - _Depends: 3.1, 3.2, 3.3, 2.3_

- [x] 4.3 离线浏览器 e2e（双向闭环 + 回归）
  - 在隔离构建目录 + stub agent 下验证：工具改状态→UI 视图更新；UI 点击→写回→工具 `get` 读到新值并回显
  - 回归：未用状态的源端到端行为不变、无额外状态帧
  - 完成态：e2e 用真实运行输出证明双向闭环与无回归
  - _Requirements: 1.2, 1.3, 3.2, 4.2, 8.4, 9.3_
  - _Depends: 4.1, 3.4_

- [x] 4.4 质量门：typecheck 与受影响包测试
  - 全工作区 `typecheck`（strict、无 `any`）通过
  - 协议/server/react/tool-kit/web-kit 受影响包单测通过
  - 完成态：typecheck 与受影响包测试均有通过输出
  - _Requirements: 9.1, 9.4_
  - _Depends: 4.2, 4.3_

> 覆盖核对：R1.1-1.5、R2.1-2.4、R3.1-3.5、R4.1-4.4、R5.1-5.4、R6.1-6.5、R7.1-7.3、R8.1-8.4、R9.1-9.4 均已映射至上述任务。

- [x] 5. 增量：`control:"state"` 帧补通用粘性回放（Requirement 10）
  - 在 `pi-session.ts` `piweb_state` 分支，构造帧后 `this.sticky.set(\`state:${key}\`, frame)` 再广播（键前缀避免多 key 互相覆盖）
  - delete 帧（`deleted:true`）同样登记为该 key 最新粘性帧（不新增 `StickyFrameRegistry.delete()`），重放后前端沿用既有 `deleted:true` 删键语义
  - 完成态：单测覆盖「单 key set 粘性回放」「同 key 多次 set 只留最新/rev 单调」「多 key 独立」「delete 帧粘性回放」「畸形行不广播不登记」，`@blksails/pi-web-server` 全量测试与 typecheck 均绿
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - _Boundary: PiSession / StickyFrameRegistry_
  - _Depends: 2.1_

## 回勾记录(2026-07-24)

实现早已落地(spec.json 为 `implementation-complete`),但 `tasks.md` 未回勾。本次按 kiro 规范
**逐任务用代码证据核实 + 跑测试取新鲜证据**后回勾,不凭 phase 字段推断。

| 任务面 | 证据 |
|---|---|
| 1.1 协议 schema | `protocol/src/web-ext/state.ts`(`piweb_state` / `piweb_state_set` / `piweb_state_delete` 三向定义) |
| 1.2 子进程状态核 | `tool-kit/src/session-state.ts` |
| 2.1 runner 接线 | `server/src/runner/state-wiring.ts` |
| 2.2 前端切片 + rev 守卫 | `react/src/sse/control-store.ts:110`(key→{value,rev},经 `control:"state"` 帧更新) |
| 2.3 作者 helper | `tool-kit/src/session-state.ts` 导出面 |
| 3.1–3.3 会话层/路由/启动序列 | `server/src/session/pi-session.ts`、`runner/runner.ts`、`runner/state-wiring.ts` |
| 3.4 前端订阅/写回 hook | `react/src/hooks/use-extension-state.ts`(`useSyncExternalStore` 订阅下行帧) |
| 3.5 web-kit 状态读写 | `web-kit/src/state-access.ts` 的 `createWebExtStateAccess`(读/订阅/写回三原语) |
| 4.2 真实子进程集成 | `server/test/runner/state-bridge.integration.test.ts` |
| 4.3 浏览器 e2e | `e2e/browser/state-bridge.e2e.ts` + `e2e/node/state-bridge.e2e.test.ts` |

**新鲜证据**(2026-07-24):`state-wiring` + `state-bridge.integration` **6 passed**;
`tool-kit/session-state` **3 passed**;根测试面(含 control-store / use-extension-state)**46 passed**;
全部 0 failed。
