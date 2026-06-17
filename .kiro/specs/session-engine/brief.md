# Brief — session-engine

> 语言:zh。权威设计:`PLAN.md` §3.2(SessionRegistry)、§4(事件→UIMessage 翻译)、§11.3(生命周期)、§14.1①②。

## 问题
- **谁**:HTTP 层与前端,需要"一个会话"的抽象:发命令、订阅流式事件、拿到可直接渲染的 UIMessage。
- **现状**:有了通道(rpc-channel)与源解析(agent-source),但缺把它们组装成会话、广播事件、并把 pi 事件翻译成 AI SDK UIMessage 的中枢。
- **改变**:`PiSession` + `SessionStore`(接口 + 内存实现)+ `event-to-uimessage` 翻译层。

## 方法 / 范围
- **PiSession**:持有 `PiRpcChannel`、`EventEmitter`(广播给多个订阅者)、extension UI 挂起表、最近状态缓存;暴露命令转发与 `subscribe()`。
- **生命周期**:创建→idle 计时回收→`stop()`;进程崩溃广播错误并清理;`SIGTERM` 优雅停机停所有会话。
- **SessionStore / Registry**:`Map<sessionId, PiSession>` 内存实现,但**按接口**(`get/create/delete/list`)外置,为未来 Redis/DO 留口(§14.1②)。
- **event-to-uimessage**(纯函数翻译层):text_delta→text-delta、thinking_*→reasoning-*、tool_execution_*→tool-input/output、partialResult→data-part、queue/compaction/auto_retry/error→旁路 control 帧;严格产出 protocol 定义的帧。
- **范围外**:不开 HTTP(http-api 做);不 spawn(channel 做)。

## 依赖
- rpc-channel、agent-source-resolver、protocol-contract。

## 测试 + e2e(硬性)
- **单元**:`event-to-uimessage` 对每种 pi 事件→正确 chunk(表驱动用例);生命周期(idle 回收、崩溃清理、stop 幂等)。
- **集成**:真实 channel(stub agent)→ PiSession 广播 → 多订阅者一致;extension UI 往返。
- **e2e**:create→prompt→订阅者收到完整 UIMessage 流(start→text-delta…→finish)+ stats 可取。

## 约束
- 翻译层必须纯函数、无副作用(可单测);并发上限/资源回收为非功能要求(§11.3)。
