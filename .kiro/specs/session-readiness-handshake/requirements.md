# Requirements Document

## Introduction

pi-web 的会话在子进程启动后存在**就绪竞态**:服务端把会话标记为可用、把 RPC 进程标记为 ready 都发生在 agent 真正能处理命令**之前**(进程构造 / 操作系统 spawn 事件即标记),而 agent 的 `runRpcMode` 读循环与 session 绑定尚未完成。pi 的事件流中**不存在**可作为就绪锚点的 `session_start` / `ready` 事件(首个事件 `agent_start` 仅在每轮对话开始时才发出)。

该竞态导致两类用户可见失败:

1. **丢帧**:UI 在 agent 就绪前订阅事件流,agent 在订阅建立前发出的早期帧因无订阅者而丢失,界面看不到本应出现的内容。
2. **过早发送失败**:UI 在 agent 就绪前发送 prompt,命令在 agent 尚未能处理时抵达而失败。

本特性采用**探针模式**彻底消除该竞态:服务端在子进程启动后主动发送一条**只读 RPC 探针**,以其**首条成功响应**作为真实就绪锚点;会话升级为可观测的**生命周期状态机**;新增**粘性的会话状态通告**,使任何订阅者(无论连接早晚)都能立即获知当前状态;前端把"可发送 / 已连接"门控在收到就绪通告之后。机制目标是**让正确性与发送/订阅时机无关**:迟到的订阅得到状态回放,过早的发送被门控阻止。

## Boundary Context

- **In scope**:基于只读探针的真实就绪判定;会话生命周期状态机(`initializing → ready`,及错误/终止终态);粘性会话状态通告 + 新订阅者订阅即回放;前端就绪门控;探针失败 / 超时 / 进程早退的可观测降级;runner restart 后复用同一机制重新握手。
- **Out of scope**:上行 prompt 队列(过早发送由前端门控阻止,而非服务端缓冲;队列作为后续独立 UX 优化);断线重连的逐帧游标回放(replay-from-cursor / Last-Event-ID);与 `ctx.ui.custom` 桥接相关的任何改动。
- **Adjacent expectations**:复用既有的"日志 ring buffer 在订阅时回填给新订阅者"的回放范式作为粘性状态实现参照;就绪后的 prompt / 事件 / 历史路径行为保持不变;状态通告为协议增量帧,既有帧解析不受影响。

## Requirements

### Requirement 1: 真实就绪判定(只读探针 + 单向迁移)
**Objective:** As a 会话编排服务, I want 仅在 agent 真正能处理命令后才判定会话就绪, so that 早期交互不会因 agent 未初始化而失败。

#### Acceptance Criteria
1. When 会话子进程被启动, the 会话引擎 shall 将会话生命周期状态初始化为 `initializing`。
2. While 会话处于 `initializing`, the 会话引擎 shall 不对外宣告会话已就绪。
3. When 会话进入 `initializing`, the 会话引擎 shall 向 agent 发出一条只读、不改变会话历史、不产生副作用的就绪探测命令。
4. When agent 首次对就绪探测命令返回成功响应, the 会话引擎 shall 将会话生命周期状态由 `initializing` 迁移为 `ready`。
5. When 会话已处于 `ready`, the 会话引擎 shall 不因后续探测或事件重复触发就绪迁移(就绪判定幂等、单向)。

### Requirement 2: 会话状态可观测(粘性通告 + 订阅即回放)
**Objective:** As a 前端订阅者, I want 无论何时连接事件流都能立即获知会话当前生命周期状态, so that 迟到的订阅不会错过就绪通告而使界面卡在未就绪。

#### Acceptance Criteria
1. When 会话生命周期状态发生变化, the 会话引擎 shall 向所有当前订阅者广播一条携带最新状态的会话状态通告。
2. When 新订阅者订阅会话事件流, the 会话引擎 shall 立即仅向该订阅者回放当前生命周期状态,而不重复广播给既有订阅者。
3. The 会话状态通告 shall 携带足以区分 `initializing`、`ready` 及错误/终止终态的状态标识。
4. If 会话在某订阅建立之前已变为 `ready`, then the 会话引擎 shall 在该订阅建立时使其仍获得当前 `ready` 状态(就绪通告不因订阅晚于状态变化而丢失)。

### Requirement 3: 前端就绪门控
**Objective:** As a 用户, I want 在 agent 就绪前界面明确处于"连接中"且不能发送, so that 我不会发出注定失败的 prompt。

#### Acceptance Criteria
1. While 聊天界面尚未收到会话 `ready` 状态, the 聊天界面 shall 禁用消息发送并呈现"连接中 / 未就绪"指示。
2. When 聊天界面收到会话 `ready` 状态, the 聊天界面 shall 启用消息发送并移除未就绪指示。
3. When 聊天界面在收到 `ready` 前发生刷新或重新订阅, the 聊天界面 shall 依据回放得到的当前状态重新确定发送可用性,而不停留在过期的未就绪判断。

### Requirement 4: 就绪失败的可观测降级
**Objective:** As a 用户, I want 在 agent 无法就绪时看到明确的失败提示而非静默卡死, so that 我能理解发生了什么并采取后续动作。

#### Acceptance Criteria
1. If 就绪探测在配置的超时时间内仍未成功, then the 会话引擎 shall 将会话生命周期状态置为错误态并通过状态通告对外告知。
2. If 会话子进程在进入 `ready` 之前退出, then the 会话引擎 shall 将状态置为终止/错误态并通告订阅者,而不停留在 `initializing`。
3. While 会话处于错误就绪态, the 聊天界面 shall 呈现可理解的失败提示并保持发送处于禁用,而非无限"连接中"。

### Requirement 5: 生命周期完整性与重握手
**Objective:** As a 会话编排服务, I want 状态机在重启与终止场景下保持自洽, so that 握手机制在会话全生命周期内都不留竞态缺口。

#### Acceptance Criteria
1. When 底层 runner 子进程因热重载或安装等原因 restart, the 会话引擎 shall 重新执行就绪握手,并在重新就绪前不宣告 `ready`。
2. When 会话进入停止流程或已停止, the 会话引擎 shall 将生命周期状态置为对应终态并停止后续就绪迁移。
3. The 会话引擎 shall 保证生命周期状态迁移有序且不回退到更早的就绪阶段(终态除非经 restart 重握手不复位)。

### Requirement 6: 非回归与范围边界
**Objective:** As a 维护者, I want 握手机制以增量方式落地且不破坏既有行为, so that 现有会话路径与 API 消费者不受影响。

#### Acceptance Criteria
1. The 会话引擎 shall 不引入上行 prompt 队列;过早发送由前端门控阻止,而非在服务端缓冲 prompt。
2. While 会话已处于 `ready`, the 会话引擎 shall 保持既有的 prompt、事件流、历史行为不变(对就绪后路径零回归)。
3. The 会话状态通告 shall 作为协议增量帧引入,使未消费该帧的既有客户端仍能正常解析事件流(向后兼容)。
