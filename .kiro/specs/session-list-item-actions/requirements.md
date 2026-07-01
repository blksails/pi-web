# Requirements Document

## Introduction

会话列表（`SessionListPanel`）当前每个会话项仅是「整行点击恢复」的单一按钮，无任何项级管理能力；历史会话只能恢复、无法删除、无法改名、也无法置顶收藏，用户面对大量历史会话时缺乏整理手段。本特性为会话列表的每个会话项增加**右侧操作菜单**，提供三项管理能力——**删除会话**、**重命名会话**、**收藏/置顶会话**——让用户在不离开聊天界面的前提下整理自己的会话历史。

本特性只增强会话列表项的交互与其后端读写接缝，不改动会话运行 / 流式内核，不改动会话恢复链路，不改动底层会话事件的持久化格式。

## Boundary Context

- **In scope**：
  - 每个会话项右侧的操作菜单入口（hover / 键盘聚焦显现），及其三项操作：删除、重命名、收藏/置顶。
  - 删除会话为**不可逆的物理删除**，删除后该会话不再出现在任一视图，且无法再被恢复。
  - 重命名后的名称需持久化、跨刷新与跨视图一致显示。
  - 收藏状态持久化，收藏的会话在列表顶部以独立「收藏」分区置顶展示。
  - 三项写操作均可由部署方通过配置整体关闭（面向只读 / 受限部署）。
- **Out of scope**（首期不做）：
  - 会话分叉（fork）、导出（下载 jsonl / markdown）、归档（archive 状态）。
  - 批量选择 / 批量删除。
  - 收藏项的手动拖拽排序、分组、打标签。
  - 跨机器 / 远端会话的管理。
- **Adjacent expectations（相邻系统预期，非本特性拥有）**：
  - 会话恢复仍由既有 `/session/:id` 冷恢复链路负责；删除 / 改名 / 收藏均不改变恢复行为。
  - 会话名称的展示口径沿用会话列表既有「显示名」口径（创建时头部名 → 最新会话信息名），本特性只新增「写入新名称」的入口，不改变既有读取与派生规则。
  - 列表的排序 / 分页 / 搜索 / 两类视图（当前目录 / 全部）等既有行为保持不变；收藏分区叠加于既有列表之上，不替换既有排序。
- **决策记录（可在审批时否决）**：
  - D1 删除**当前正在查看**的会话：允许；删除后导航至新会话空态，不破坏其余进行中的会话。
  - D2 收藏以 `sessionId` 为键持久化，为用户偏好，独立于只读的会话枚举；收藏分区在「当前目录」视图仅展示归属当前目录的收藏会话，在「全部」视图展示全部收藏会话。
  - D3 三项写操作默认**启用**；部署方可经配置整体关闭（关闭后既隐藏写入口、也拒绝对应写请求）。

## Requirements

### Requirement 1: 会话项操作菜单入口
**Objective:** 作为使用会话列表的用户，我想在每个会话项上打开一个操作菜单，以便对该会话执行管理操作，而不必离开聊天界面。

#### Acceptance Criteria
1. Where 会话管理写操作已启用，the SessionListPanel shall 为列表中每个会话项渲染一个操作菜单触发入口（如右侧 `⋯` 按钮）。
2. When 用户悬停某会话项或以键盘聚焦到该会话项，the SessionListPanel shall 显现该项的操作菜单触发入口；未悬停 / 未聚焦时入口可隐藏以保持列表整洁。
3. When 用户激活某会话项的操作菜单触发入口（点击或键盘操作），the SessionListPanel shall 展开一个包含「删除」「重命名」「收藏/取消收藏」项的菜单。
4. When 用户激活操作菜单触发入口，the SessionListPanel shall 不触发该会话项的「恢复会话」行为（菜单交互与整行恢复互不误触）。
5. When 菜单已展开且用户点击菜单外区域或按 Esc，the SessionListPanel shall 关闭该菜单且不产生任何副作用。
6. The SessionListPanel shall 为操作菜单入口、各菜单项及其展开态提供稳定的 `data-*` 定位属性，以支持端到端测试与宿主定位。

### Requirement 2: 删除会话
**Objective:** 作为用户，我想删除不再需要的历史会话，以便整理会话列表、移除无关记录。

#### Acceptance Criteria
1. When 用户在会话项菜单中选择「删除」，the SessionListPanel shall 先弹出二次确认，且在用户确认前不发起删除。
2. If 用户在二次确认中取消，then the SessionListPanel shall 中止删除、保留该会话且列表不变。
3. When 用户确认删除，the 会话管理服务 shall 从持久化存储中物理删除该会话（含其头部与全部事件条目），使其之后不再出现在任一视图、也无法被恢复。
4. When 删除成功，the SessionListPanel shall 将该会话项从当前列表中移除，且移除结果在无需整页手动刷新的情况下即时可见。
5. If 被删除的会话是用户当前正在查看的会话，then the 宿主 shall 在删除成功后导航至新会话空态，且不破坏其它正在进行的会话。
6. If 目标会话在存储中已不存在，then the 会话管理服务 shall 将该删除视为已达成目标状态（幂等成功）而非报错，the SessionListPanel 相应地将其从列表移除。
7. If 删除请求因存储错误失败，then the SessionListPanel shall 展示可感知的错误提示且保留该会话项，而非静默丢失或误报成功。
8. Where 会话管理写操作已禁用，the 会话管理服务 shall 拒绝删除请求且不改动存储。

### Requirement 3: 重命名会话
**Objective:** 作为用户，我想给会话起一个可辨识的名称，以便在众多历史会话中快速定位。

#### Acceptance Criteria
1. When 用户在会话项菜单中选择「重命名」，the SessionListPanel shall 进入该项的名称内联编辑态，并以当前显示名作为初始值。
2. When 用户在编辑态提交一个非空名称（去除首尾空白后非空），the 会话管理服务 shall 持久化该名称，使其成为该会话的最新显示名。
3. When 重命名成功，the SessionListPanel shall 立即以新名称展示该会话项，且该名称在页面刷新后与切换视图后仍保持一致。
4. If 用户提交的名称去除首尾空白后为空，then the SessionListPanel shall 不提交写请求、退出编辑态并保留原显示名。
5. If 用户在编辑态按 Esc 或点击取消，then the SessionListPanel shall 放弃编辑、保留原显示名且不发起写请求。
6. If 重命名请求因存储错误失败，then the SessionListPanel shall 展示可感知的错误提示并保留原显示名。
7. Where 会话管理写操作已禁用，the 会话管理服务 shall 拒绝重命名请求且不改动存储。

### Requirement 4: 收藏 / 置顶会话
**Objective:** 作为用户，我想收藏常用会话并让它们置顶显示，以便一眼找到并快速进入。

#### Acceptance Criteria
1. When 用户在会话项菜单中选择「收藏」，the 会话管理服务 shall 持久化该会话为已收藏状态，使其在页面刷新后仍为已收藏。
2. When 用户在已收藏会话的菜单中选择「取消收藏」，the 会话管理服务 shall 移除该会话的收藏状态并持久化。
3. While 存在已收藏且属于当前视图范围的会话，the SessionListPanel shall 在列表顶部以独立「收藏」分区置顶展示这些会话，且不从既有普通列表中重复渲染同一会话。
4. While 当前视图无属于其范围的已收藏会话，the SessionListPanel shall 不渲染「收藏」分区（不留空占位）。
5. The SessionListPanel shall 在「收藏」分区与普通列表中一致地展示会话名称、恢复入口与操作菜单（收藏项同样可被重命名、删除、取消收藏）。
6. When 用户在「当前目录」视图收藏 / 取消收藏，the SessionListPanel shall 仅按 `sessionId` 维护收藏，使同一会话在「全部」视图中呈现一致的收藏状态。
7. If 某个已收藏的 `sessionId` 对应的会话已不存在（如已被删除），then the SessionListPanel shall 不因该失效收藏项而报错或渲染空条目。
8. If 收藏状态的读取或写入因存储错误失败，then the SessionListPanel shall 展示可感知的错误提示，且写入失败时不改变界面上的收藏状态。
9. Where 会话管理写操作已禁用，the 会话管理服务 shall 拒绝收藏 / 取消收藏的写请求且不改动存储；已持久化的收藏仍可被读取用于置顶展示。

### Requirement 5: 列表状态一致性与并发安全
**Objective:** 作为用户，我希望每次管理操作后列表都准确反映最新状态，以免看到过期或错乱的数据。

#### Acceptance Criteria
1. When 任一管理操作（删除 / 重命名 / 收藏 / 取消收藏）成功，the SessionListPanel shall 使列表展示与最新持久化状态一致，且无需用户手动整页刷新。
2. While 某会话项正有一个管理请求在途，the SessionListPanel shall 向用户提供该操作进行中的可感知反馈（如禁用重复触发），避免对同一项重复发起冲突请求。
3. If 管理操作过程中列表因其它原因发生刷新，then the SessionListPanel shall 保证不因过期响应覆盖较新的列表状态（沿用既有竞态守卫语义）。
4. The SessionListPanel shall 在展开菜单 / 内联编辑 / 二次确认等瞬态交互进行时，保持既有的「当前会话高亮」「当前所在视图 Tab」等状态不被打断。

### Requirement 6: 部署门控与安全
**Objective:** 作为部署方，我想能在受限 / 只读环境中关闭会话管理写操作，以避免用户误删或改动会话历史。

#### Acceptance Criteria
1. Where 部署方通过配置关闭会话管理写操作，the SessionListPanel shall 不渲染删除 / 重命名 / 收藏的写入口。
2. Where 部署方通过配置关闭会话管理写操作，the 会话管理服务 shall 对删除 / 重命名 / 收藏写请求返回拒绝且不改动任何存储。
3. The 会话管理服务 shall 将删除 / 重命名 / 收藏写操作限定在会话既有的持久化范围内（对应会话的存储条目与用户收藏偏好），不触及无关会话或无关存储。
4. If 删除 / 重命名 / 收藏请求的参数非法（如缺失会话标识、名称超出允许长度），then the 会话管理服务 shall 返回可辨识的校验错误而不改动存储。
