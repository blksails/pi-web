# Research Log — session-engine

## Discovery Scope

- **Feature type**:Greenfield 后端引擎组件(新建模块),处于依赖图内核层(`Depends on: rpc-channel, agent-source-resolver`,二者均 `Depends on: protocol-contract`)。
- **Discovery 类型**:Full(新组件、跨多上游契约、含纯函数翻译核心 + 有状态生命周期)。
- **权威来源**:`PLAN.md` §3.2(SessionRegistry)、§4(事件→UIMessage 映射表)、§11.3(生命周期)、§14.1①②;上游三份 design.md(protocol-contract / rpc-channel / agent-source-resolver)。

## 上游契约对齐(消费,不重定义)

| 上游 spec | 本特性消费的契约 | 形状要点 |
|-----------|------------------|----------|
| protocol-contract | `AgentEvent` 可辨识联合 | 判别键 `type`;子类 `agent_start`/`agent_end`/`turn_end`/`message_update`(子事件 `text_*`/`thinking_*`)/`tool_execution_start|update|end`/`compaction_*`/`auto_retry_*`/`queue_update`/`extension_ui_request` |
| protocol-contract | SSE 帧 `SseFrameSchema` | `kind=uiMessageChunk|control`;`uiMessageChunk` 内嵌 text/reasoning/tool/data-part;`control` 内含 extension-ui/queue/stats/error;含 `protocolVersion` |
| protocol-contract | data-part `DataPartSchema` | `data-pi-queue`/`data-pi-compaction`/`data-pi-auto-retry`/`data-pi-tool-partial` |
| rpc-channel | `PiRpcChannel` 接口 | `send`/`onLine`/`close`/`health`;`PiRpcProcess` 另暴露 `onEvent`/`onExtensionUIRequest`/`respondExtensionUI`/`onStderr`/`onExit` 与 18 个命令方法 |
| agent-source-resolver | `ResolvedSource` | `{ mode, spawnSpec, cwd, trust }` |

## 关键设计决策

1. **翻译层做成纯函数(核心)**:输入单个 `AgentEvent` + 不可变翻译上下文(partId 计数器、当前 step 状态),输出 `SseFrame[]`。不持有计时器/进程/网络。状态推进通过返回更新后的上下文(或由 `PiSession` 持有上下文实例)实现,但翻译函数本身不做 I/O。理由:Req 4.1/10.1 硬性要求可独立单测;PLAN §4 是确定映射,天然适合表驱动。
   - 取舍:partId 分配需要状态。决策:把状态放进显式传入的 `TranslationContext`,翻译函数读它并返回需要的更新指令,由 `PiSession` 应用;翻译函数保持无副作用。
2. **广播用 `node:events` EventEmitter**(PLAN §3.2 明确)。多订阅者一致性来自单一事件源 + 同步顺序分发;订阅者异常用 try/catch 隔离(Req 3.5)。
3. **`SessionStore` 接口外置 + 内存实现**(§14.1②)。`PiSession` 逻辑只依赖接口;内存实现挂 `globalThis` 以抗 Next dev 热重载(PLAN §3.2)。
4. **生命周期单点**:idle 计时器、崩溃清理、stop 幂等集中在 `PiSession` + `SessionManager`。`stop()` 用状态机(active/stopping/stopped)保证幂等(Req 7.4)。优雅停机由 `SessionManager` 遍历 store(Req 8)。
5. **边界纪律**:不 spawn(rpc-channel)、不开 HTTP(http-api)、不解析源(agent-source-resolver)。`PiSession` 接收已建立的 `PiRpcChannel` 与 `ResolvedSource` 注入。

## 架构模式评估

- 候选 A:把翻译逻辑内联进 `PiSession` 的事件回调。否决——违反 Req 4.1 纯函数可单测。
- 候选 B(选定):翻译层 = 独立纯函数模块;`PiSession` = 有状态外壳(通道 + emitter + 挂起表 + 缓存 + 生命周期);`SessionManager` + `SessionStore` 接口 = 注册/检索/全局停机。三层职责分离,翻译可脱离运行时单测。

## 风险与缓解

- **pi 事件子类型形状漂移** → 翻译表驱动用例 + 依赖 protocol-contract 的 schema(上游契约测试already防漂移);本层只引用 protocol 类型。
- **partId/step 状态错乱导致前端渲染断裂** → 翻译上下文显式建模 step/text/reasoning 开闭状态,表驱动用例覆盖乱序/重复 start。
- **idle 计时器与 stop 竞态** → stop 状态机 + 清理计时器在 stop 首步执行。
- **崩溃与 stop 并发** → 二者都走统一清理路径,由状态机去重(幂等)。

## Synthesis 结果

- **泛化**:`stop()`、崩溃清理、优雅停机内的单会话停止共用同一"清理"原语(关通道 + 清挂起表/缓存 + 移除注册 + 广播结束),避免三处重复。
- **build-vs-adopt**:广播采用 Node 内置 `EventEmitter`(adopt),不自造发布订阅。
- **简化**:不引入并发上限/限额实现(留接缝,属生产硬化非功能项),避免本 spec 膨胀。
