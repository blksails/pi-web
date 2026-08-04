# Requirements Document

## Introduction

pi-web 会话的业务就绪判定（spec `session-readiness-handshake`）当前依赖服务端**探针机制**：会话创建后服务端周期性发送只读探针请求，以首条响应为就绪锚点。该机制是对一个更深根因的补偿——runner 子进程在进入 RPC 服务循环**之前**就挂上了自己的 stdin 帧读取器，使 stdin 进入流动模式，此窗口内父进程写入的行（含首发探针）被提前消费而物理丢失（2026-07-30 判别实验实证：早挂读取器不暂停 → 晚挂的 RPC 读取器丢失早期行；早挂后立即暂停 → 零丢失；暂停后无人恢复 → 双向死锁）。补偿的代价：每会话三个定时器与 1 秒重发拍（dev 实测新会话就绪中约 1 秒纯耗在等重发）、190 行机制体、贯穿 5 个文件的超时配置链路。

本特性**修根因、去补偿**：① runner 侧消除 stdin 早期行丢失；② runner 在可服务后**主动上报一帧就绪通告**，服务端收帧即判定就绪；③ 删除服务端探针机制全链路；④ 以单一看门狗超时兜底「runner 版本错配 / 就绪通告缺失」，保留既有的早退与崩溃错误路径。机制目标不变（正确性与发送/订阅时机无关），但判定方向反转：由「服务端反复问」改为「runner 到点说」。

**依据的既有事实**：`session-readiness-handshake` research 当年否掉「被动等事件」的前提是「agent 侧没有就绪事件可等」——该前提已因父子 IPC 帧通道（spec `runner-frame-channel`）的建成而不成立，runner 具备装配期与运行期的上行帧能力。

## Boundary Context

- **In scope**：runner 子进程的 stdin 读取时序治理与就绪帧上报；会话服务端就绪判定的收帧化改造；探针机制（重发/探针超时/重启 settle 定时器）及其配置链路的移除；就绪看门狗兜底；重启重握手路径的同步简化。
- **Out of scope**：pi SDK（`@earendil-works/pi-coding-agent`）自身行为的任何修改；生命周期状态机的状态集合与单向迁移规则（`initializing/ready/error/ended` 不增不减）；`session-status` / `session-state` 帧的对外 schema；前端门控组件的交互形态；busy/turn/快照权威等相邻机制。
- **Adjacent expectations**：前端（`gateUntilReady` 消费者）依赖粘性 `session-status` 帧在任意订阅时刻回放当前态——本特性不得改变该契约；e2b/沙箱传输把 runner 上行行逐行转发给服务端——就绪帧沿既有上行通道传递，不新增传输层义务；cli 模式（直接跑 pi CLI，无 pi-web runner 装配层）不具备主动上报能力，本特性须为其保留可靠的就绪判定，而不得假设就绪帧全形态存在。

## Requirements

### Requirement 1: stdin 早期输入零丢失（根因修复）

**Objective:** As a pi-web 框架维护者, I want runner 子进程在 RPC 服务循环就绪前不丢失父进程写入的任何输入行, so that 上层不再需要以重发机制补偿输入丢失，会话早期通信的正确性与写入时机无关。

#### Acceptance Criteria

1. When 父进程在 spawn 后立即（RPC 服务循环尚未就绪时）向 runner 子进程写入输入行, the runner 子进程 shall 在 RPC 服务循环就绪后完整处理这些行，不丢失任何一行。
2. While runner 装配期帧读取器已挂载而 RPC 服务循环尚未就绪, the runner 子进程 shall 使早到的输入行处于缓冲状态而非被消费丢弃。
3. When RPC 服务循环的输入读取器就绪, the runner 子进程 shall 恢复输入流动，使缓冲的行与后续行都被正常分发。
4. If 输入流动恢复的判定条件永远不满足（异常路径）, the runner 子进程 shall 在有限时间内仍恢复输入流动或以可诊断的方式失败，不得使会话陷入无任何日志与错误的静默死锁。
5. The runner 子进程的装配期帧分发能力（既有各桥的帧收发）shall 在时序治理后保持不变。

### Requirement 2: runner 主动就绪上报

**Objective:** As a pi-web 用户, I want runner 在真正可服务的时刻主动通告就绪, so that 新会话的可用时刻由事实驱动，不再包含等待服务端重发拍的固定延迟。

#### Acceptance Criteria

1. When runner 完成装配并且 RPC 服务循环可接收命令, the runner 子进程 shall 经既有上行通道发送一帧就绪通告。
2. The 就绪通告帧 shall 携带足以被服务端唯一识别的类型标记，且不与既有帧类型冲突。
3. When 会话服务端收到就绪通告帧且会话处于 initializing, the 会话服务端 shall 将生命周期迁移为 ready 并按既有契约广播与粘性登记 `session-status` 帧。
4. When 会话服务端在非 initializing 状态（ready/error/ended）收到重复或迟到的就绪通告帧, the 会话服务端 shall 忽略之，不产生任何状态变更或额外帧。
5. When 新会话创建且 runner 正常启动, the 会话 shall 在 runner 可服务后的亚秒级时间内到达 ready（消除现状中约 1 秒的重发拍等待）。

### Requirement 3: 服务端探针机制移除

**Objective:** As a pi-web 框架维护者, I want 服务端不再以周期性探针请求判定就绪, so that 每会话的定时器、重发机制与配套配置链路整体消失，代码面与运维面同步收窄。

#### Acceptance Criteria

1. The 会话服务端 shall 不再向具备主动上报能力的 runner 形态会话发送任何以就绪判定为目的的探针请求（含首发与重发）；无上报能力形态的就绪判定以 Requirement 6 为准。
2. The 系统 shall 不再产生 `probe-timeout` 与 `probe-failed` 两种生命周期错误码。
3. The 系统 shall 移除探针超时的全部配置链路（会话选项、会话管理器透传、环境变量解析与其测试），使其不再出现在任何装配路径中。
4. When 就绪握手机制关闭（readinessHandshake 未开启）, the 会话 shall 与现状完全一致地保持 legacy 行为：生命周期恒为 initializing、不发任何生命周期帧、收到就绪通告帧亦不产生状态变更。

### Requirement 4: 就绪失败兜底（看门狗与既有错误路径）

**Objective:** As a pi-web 运维者, I want 就绪通告缺失时会话在有限时间内进入可观测的错误态, so that 版本错配（旧 runner 不发就绪帧）或启动异常不会表现为永久 initializing 的静默悬挂。

#### Acceptance Criteria

1. If 会话在就绪等待上限内未收到就绪通告帧且子进程仍存活, the 会话服务端 shall 将生命周期迁移为 error 并携带可区分「就绪通告缺失」的错误码与说明。
2. The 就绪等待上限 shall 可由运维配置（含合理默认值）；配置非法时回退默认值。
3. The 就绪看门狗 shall 为单一超时定时器：不发送任何请求、不重发、不阻止宿主进程退出。
4. When 会话到达 ready 或进入任何终态, the 会话服务端 shall 取消尚未触发的看门狗定时器，不残留悬挂定时器。
5. When 子进程在就绪前退出, the 会话服务端 shall 保持既有 `exit-before-ready` 错误路径的行为不变（本轮 dev 实测该路径工作正常：1.2 秒内报出 error 而非等满超时）。

### Requirement 5: 重启重握手

**Objective:** As a pi-web 用户, I want runner 重启后会话按同一机制重新就绪, so that 热重载/显式重启后的会话状态依然可信，且重启路径不再需要专用的延迟探测定时器。

#### Acceptance Criteria

1. When 会话发起 runner 重启, the 会话服务端 shall 立即复位生命周期为 initializing 并广播，使前端在重新就绪前即刻恢复门控。
2. When 重启后的新子进程完成装配并可服务, the 新子进程 shall 重新发送就绪通告帧，且会话服务端收帧后迁移为 ready。
3. The 系统 shall 移除重启路径专用的延迟探测（settle）定时器机制。
4. When 重启发起后新子进程在就绪等待上限内未通告就绪, the 会话服务端 shall 按 Requirement 4 的看门狗路径进入 error。

### Requirement 6: 非 runner 形态与传输形态的就绪兼容

**Objective:** As a pi-web 用户, I want cli 模式与沙箱传输下的会话依旧能可靠就绪, so that 去探针改造不以牺牲任何既有会话形态为代价。

#### Acceptance Criteria

1. When 以 cli 模式（无 pi-web runner 装配层，子进程无主动上报能力）创建会话且就绪握手开启, the 会话 shall 仍能在子进程可服务后到达 ready，不因就绪通告帧缺失而必然落入看门狗超时。
2. The cli 模式的就绪判定 shall 不引入周期性重发机制（该形态无早期输入丢失问题，单次判定即足够可靠）。
3. When 会话经沙箱传输（runner 跑在远端沙箱、上行行经传输层逐行转发）运行, the 就绪通告帧 shall 经既有上行通道到达会话服务端并触发与本地一致的就绪迁移。
4. Where 沙箱真机验证在本期不可达, the 交付 shall 显式记录该项为已知未验，不得默记为已验证。

### Requirement 7: 前端与协议契约保持

**Objective:** As a 前端消费者（gateUntilReady 使用方）, I want 就绪机制改造对帧契约零可见变化, so that 前端组件与既有订阅者无需任何修改。

#### Acceptance Criteria

1. The `session-status` 帧的结构（state/detail/code 字段形态）与粘性回放语义 shall 保持不变，任意时刻的新订阅者仍能立即取得当前生命周期态。
2. When 会话就绪流程发生（新建、重启、失败）, the 前端既有的门控、错误展示与重连行为 shall 无需代码修改即保持正确。
3. The 生命周期状态机的状态集合与单向迁移守卫（含 forceReset 仅限重启复位）shall 保持不变。
4. If 生命周期错误码集合发生变化（移除 probe-*、新增就绪通告缺失码）, the 前端 shall 不因错误码字符串变化而出现行为回归（前端按 state 门控、code 仅作展示）。

### Requirement 8: 回归防护与证据

**Objective:** As a pi-web 框架维护者, I want 时序治理与就绪链路有机械证据守卫, so that pause/resume 类错误（症状为静默死锁，比探针超时更难排查）在提交前即被抓住。

#### Acceptance Criteria

1. The 交付 shall 包含真实子进程级测试：验证「spawn 后立即写入的行不丢失」与「就绪通告帧在真实 runner 启动后到达」。
2. The 交付 shall 包含死锁守卫测试：输入流动恢复路径被破坏时测试必须变红（先证明判据能报红再信它报的绿）。
3. When 全部改造完成, the 既有测试面（根 vitest 与各子包测试）shall 全绿，且被删除机制的测试随机制一并移除而非跳过。
4. The 交付 shall 以日志证据核实新会话就绪时延不再包含重发拍等待（对比改造前后 spawn→ready 时间线）。
