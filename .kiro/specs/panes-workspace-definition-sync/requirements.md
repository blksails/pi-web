# Requirements Document

## Introduction

会话面板（Pane 面板）在装载 agent 声明的 pane 时存在一处时序缺陷：面板的**已打开集合**只在
会话首次呈现的那一刻按当时可见的 pane 清单确定一次，此后即使 agent 声明的 pane 清单补齐，
已打开集合也不再跟进。对于需要异步取得 UI 声明的 agent（webext 经在线解析装载），
首次呈现时其 pane 清单尚未到达，面板遂只打开宿主内置 pane；随后清单补齐也无济于事。
更糟的是该结果会被写入**跨会话保留的布局记录**，下次进入时读回并通过校验，形成自我固化——
用户从此再也看不到该 agent 声明的 pane，且无法通过刷新或新建会话恢复。

真机实测同一时刻：面板已知的 pane 清单为 `[host:session-info, search, materials, canvas, logs]`、
声明的初始打开集合为 `[search, materials, canvas, logs]`，而实际打开的只有 `[host:session-info]`。

本特性要求会话面板的已打开集合与 pane 清单保持一致，同时不得因此破坏「用户手动关闭的 pane
下次不再自动出现」这一既有体验，并且要能纠正已经写坏的存量布局记录。

## Boundary Context

- **In scope**
  - 会话面板的**已打开集合**在 pane 清单补齐后的跟进行为。
  - 跨会话布局记录在「记录内容与当前 pane 清单不相称」时的纠正行为。
  - 上述行为对两类装载方式（清单在首次呈现时即已就绪 / 需异步取得）的一致性。

- **Out of scope**
  - **pane 清单的合成规则本身**。合成结果已被实测证明正确（返回全部 5 个 pane、
    零拒绝、初始打开集合正确），既有约定（agent 的初始集合优先保留、内置项仅在不超上限时追加）
    保持不变，本特性不修改它。
  - **agent UI 声明的解析与装载链路**。解析、下载、完整性校验、装载门控均已实测正常，
    不在本次改动范围。
  - **pane 自身的运行时行为**（连接握手、隐藏/销毁状态机、路由授权、主题下发）。
  - 跨会话保留布局这一能力的**存废**——该能力由 agent 自行声明是否启用，本特性不得将其移除
    或默认关闭来规避问题。

- **Adjacent expectations**
  - 本特性依赖「pane 清单会在会话存续期间从不完整变为完整」这一既有事实，但**不负责**加快
    或保证该过程的时机。
  - 本特性依赖既有的 pane 唯一标识与命名空间约定来判断某个 pane 是否仍然存在，
    但不引入新的标识规则。
  - 桌面外壳下的原生 pane 呈现路径与浏览器下共用同一套已打开集合，本特性的行为在两者上
    必须一致，但不改变原生呈现自身的实现。

## Requirements

### Requirement 1: agent 声明的初始 pane 必须被打开

**Objective:** As a 使用 agent 的最终用户, I want agent 声明为「初始打开」的 pane 在我进入会话后确实出现, so that 我能直接使用该 agent 提供的工作面板，而不必自己逐个手动打开

#### Acceptance Criteria

1. When 会话面板已知的 pane 清单从不含某 agent 声明的 pane 变为包含它，且该 pane 属于声明的初始打开集合，the Pane 面板 shall 将该 pane 加入已打开集合并使其在面板上可见。
2. While agent 的 pane 清单需要异步取得，when 清单最终到达，the Pane 面板 shall 使最终的已打开集合与清单声明的初始打开集合一致，其结果与清单在首次呈现时即已就绪的情形没有可观察差异。
3. The Pane 面板 shall 在补齐已打开集合时保持既有的 pane 排列顺序约定，不因补齐时机不同而产生不同的排列结果。
4. If 声明的初始打开集合中某个 pane 已经处于打开状态，the Pane 面板 shall 不因补齐动作而重复打开它或产生第二个副本。
5. If 补齐后的已打开数量将超过允许同时打开的上限，the Pane 面板 shall 按既有上限规则取舍，且不得因超限而丢弃已经打开且用户可见的 pane。

### Requirement 2: 用户手动关闭的 pane 不得被重新打开

**Objective:** As a 使用 agent 的最终用户, I want 我手动关掉的 pane 保持关闭, so that 修复「pane 打不开」不会反过来变成「pane 关不掉」

#### Acceptance Criteria

1. When 用户手动关闭某个 pane，且此后 pane 清单没有发生变化，the Pane 面板 shall 在同一会话内不再自动打开该 pane。
2. When 用户手动关闭某个 pane 后重新进入会话，且该 agent 的 pane 清单与关闭时相同，the Pane 面板 shall 保持该 pane 关闭。
3. If 无法区分「用户主动关闭」与「因清单不完整而未曾打开」，the Pane 面板 shall 不得默认按「用户主动关闭」处理而放弃补齐，也不得默认按「未曾打开」处理而覆盖用户意图；该区分必须成立。
4. When 用户手动关闭 pane 后 agent 的 pane 清单发生实质变化（新增或移除了 pane），the Pane 面板 shall 明确其取舍并保持行为可预期，不得在两次相同操作下给出不同结果。

### Requirement 3: 已写坏的存量布局记录必须可纠正

**Objective:** As a 曾经打开过受影响 agent 的用户, I want 我这台机器上已经记坏的面板布局能自行恢复正常, so that 我不需要清理浏览器数据或换一台机器才能用上该 agent 的 pane

#### Acceptance Criteria

1. When 跨会话保留的布局记录与当前 agent 的 pane 清单不相称（记录中缺少清单声明为初始打开的全部 pane，且记录内容仅由宿主内置 pane 构成），the Pane 面板 shall 不沿用该记录，而是按当前清单声明的初始打开集合呈现。
2. The Pane 面板 shall 在纠正存量记录后，将纠正结果作为此后的布局记录，使纠正只发生一次而非每次进入都重来。
3. If 布局记录内容与当前清单相称，the Pane 面板 shall 沿用该记录，不得借纠正之名丢弃用户既有布局。
4. Where 用户此前从未打开过受影响的 agent（不存在布局记录），the Pane 面板 shall 直接按清单声明的初始打开集合呈现，无需任何纠正动作。

### Requirement 4: 既有能力与既有行为不得回退

**Objective:** As a 维护者, I want 这次修复不以牺牲其他 agent 或其他形态为代价, so that 一处时序修复不会换来更大面积的回归

#### Acceptance Criteria

1. When agent 的 pane 清单在会话首次呈现时即已就绪，the Pane 面板 shall 保持与本次修复前完全相同的可观察行为。
2. The Pane 面板 shall 保留「跨会话记住用户面板布局」这一能力，且该能力是否启用仍由 agent 自行声明决定。
3. When 会话在桌面外壳中以原生方式呈现 pane，the Pane 面板 shall 表现出与浏览器形态一致的已打开集合行为。
4. Where 会话中不存在任何 agent 声明的 pane（仅有宿主内置 pane），the Pane 面板 shall 保持与本次修复前相同的呈现结果。
5. If 某个 agent 的 pane 清单在会话存续期间始终未能到达，the Pane 面板 shall 保持可用并呈现当前已知的 pane，不得空白、报错或阻塞会话其余部分。

### Requirement 5: 修复必须以「非侥幸」的方式被验证

**Objective:** As a 维护者, I want 验收证据能区分「真的修好了」与「这一次恰好赢了时序」, so that 一个竞态缺陷不会因为偶然跑绿而被误判为已修复

#### Acceptance Criteria

1. The 验收证据 shall 覆盖「pane 清单在首次呈现之后才到达」这一情形，并在该情形下证明已打开集合与声明的初始打开集合一致。
2. The 验收证据 shall 覆盖「布局记录中仅含宿主内置 pane」这一存量污染情形，并证明其被纠正。
3. The 验收证据 shall 覆盖「用户手动关闭后重新进入」这一情形，并证明该 pane 保持关闭。
4. If 某项验收仅在特定时序下才成立，the 验收证据 shall 显式呈现该时序条件，不得以单次通过充当稳定通过的证明。
