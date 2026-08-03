# Requirements Document

## Project Description (Input)

给会话加一顶「帽子」：在**不破坏 pi 会话 jsonl 格式**的前提下，为每个会话保存一份可快速读取的展示元数据（标题、所属 agent-source），供会话列表一眼看清每条会话是什么；同时让会话列表能显示会话当前的工作状态（工作中 / 等待用户交互 / 异常），使用户在多会话并行时知道哪条在跑、哪条在等自己。

今天的痛点：列表要显示自动标题只能**逐项顺读整份 jsonl**（`session-list-routes.ts:137` 自述），带搜索关键字时还要对全量会话先富集；`SessionListItem.source` 字段与其 UI 渲染早已存在，但服务端从未有人填过它，是个空壳；会话工作状态只存在于单会话的权威快照里，列表 DTO 无任何活跃态字段。

## Introduction

本特性引入**会话展示元数据的集中索引**（下称「元数据索引」）与**会话列表的工作状态显示**两块能力。

元数据索引是一份与会话 jsonl 并存、但**独立于 jsonl** 的展示元数据存储：按会话标识归键，承载标题与所属 agent-source。它的定位是**缓存而非权威**——标题的权威仍是会话自身持久化的历史（现有自动标题链路不变），索引丢失或损坏时系统退化到今天的读取路径，不产生新的单点故障。

工作状态则**完全不持久化**：它是运行中会话的运行时投影。列表在读取时聚合当前正在运行的会话状态，未加载的历史会话一律视为空闲。

两者共同的消费者是会话列表：列表项显示标题、来源标识、来源色条，并在会话非空闲时显示相应状态指示。

## Boundary Context

- **In scope**:
  - 会话展示元数据（标题、agent-source 标识）的保存、读取、更新与清理。
  - 元数据缺失 / 损坏 / 并发写入下的可观察降级行为。
  - 会话列表读取元数据时**不读取会话正文**。
  - 会话列表显示三种非空闲状态：工作中、等待用户交互、异常。
  - 状态发生变化时列表的刷新时机。
  - 列表项按来源显示稳定的来源色条（取代原设想的图标）。
- **Out of scope**:
  - 修改会话 jsonl 的格式或语义（外部契约，只做兼容性验证）。
  - 会话图标与图标选择器（本期以来源色条替代，不做图标）。
  - 用户手动编辑标题（沿用既有改名交互，不新增编辑入口）。
  - 「工具调用中」「排队中」等更细状态（信号未归约进权威快照，本期不做）。
  - 工作状态的**服务端主动推送**通道（本期为读取时聚合 + 既有刷新信号 + 客户端按需轮询）。
  - 会话列表的分页、排序、系统视图门控、名称搜索的既有行为（不变）。
  - 跨机器元数据同步、远端会话聚合。
- **Adjacent expectations**:
  - 依赖既有的自动标题链路产生标题：本特性只在其产生标题时同步一份到索引，不改其产生方式，也不接管标题的权威。
  - 依赖既有的会话运行时状态权威（轮次是否进行中、会话生命周期是否异常、是否有待用户回应的交互挂起）：本特性只**投影**这些既有事实，不新增状态字段、不自行从消息流推断。
  - 依赖既有的会话删除交互：本特性在其链路上挂元数据清理，不重做交互。
  - 依赖既有的会话列表端点与面板：本特性扩展其数据与渲染，不改其分页/排序/门控语义。

## Requirements

### Requirement 1: 会话展示元数据的持久保存

**Objective:** 作为 pi-web 用户，我想让每个会话记住自己的标题与所属 agent-source，以便在会话列表上一眼分辨每条会话是什么、来自哪个 agent。

#### Acceptance Criteria

1. When 一个新会话被创建, the Session Meta Index shall 为该会话保存其所属 agent-source 标识（无所属来源的会话不保存该项，而非保存空值）。
2. When 会话的标题被自动标题链路产生或更新, the Session Meta Index shall 为该会话保存最新标题。
3. When 会话被改名, the Session Meta Index shall 保存改名后的标题。
4. The Session Meta Index shall 仅保存展示所需的轻量字段，不保存会话消息内容、不保存任何会话正文派生的摘要。
5. The Session Meta Index shall 不修改会话自身的持久化历史文件的格式与内容。
6. While 会话的运行进程已结束, the Session Meta Index shall 保留该会话已保存的元数据，使其在列表中仍可正确展示。

### Requirement 2: 快速读取与不读正文

**Objective:** 作为 pi-web 用户，我想让会话列表在会话数量很多时也能快速出结果，以便不必等待即可定位目标会话。

#### Acceptance Criteria

1. When 会话列表请求一页会话, the Sessions List Service shall 从元数据索引取得该页各会话的标题与来源，且不读取任何会话的正文历史。
2. Where 某会话在元数据索引中存在标题, the Sessions List Service shall 使用索引中的标题，不再为该会话读取其历史文件以派生标题。
3. If 某会话在元数据索引中没有标题, then the Sessions List Service shall 退回到既有的标题派生方式取得标题，使该会话的显示不因索引缺失而变差。
4. When 用户带名称关键字搜索会话, the Sessions List Service shall 依据索引中的标题进行匹配，且保持既有的匹配语义（名称与标识的大小写不敏感子串匹配）不变。
5. The Sessions List Service shall 使「列出一页会话」所需读取的会话历史文件数量随索引命中率提高而减少，并在验收时以改造前后的实测读取次数或耗时作为证据。

### Requirement 3: 元数据索引的健壮性与降级

**Objective:** 作为 pi-web 用户，我想让会话列表在元数据出问题时仍然可用，以便任何元数据故障都不会让我看不到或打不开自己的会话。

#### Acceptance Criteria

1. If 元数据索引不存在, then the Sessions List Service shall 正常返回会话列表（标题退回既有派生方式、来源留空），不报错、不返回空列表。
2. If 元数据索引的内容无法解析, then the Sessions List Service shall 按「索引不存在」处理并继续服务，且不因此使任何列表请求失败。
3. If 元数据索引中某个会话的条目字段不完整或类型不符, then the Sessions List Service shall 跳过该条目的不可用字段、保留其可用字段，并继续处理其余会话。
4. When 元数据索引被判定为不可用后又需要写入, the Session Meta Index shall 能重建索引并继续保存后续元数据，无需人工干预。
5. The Session Meta Index shall 使元数据的任何读写失败都不改变会话本身能否被列出与恢复。
6. Where 索引中某会话的元数据缺失而其历史文件仍可读, the Session Meta Index shall 能从该会话的历史重建其标题，使索引丢失最坏只表现为一次性的读取变慢。

### Requirement 4: 多写入者并发下不丢元数据

**Objective:** 作为同时开着多个 pi-web 实例（含桌面版）与命令行会话的用户，我想让各处产生的会话元数据都能保留，以便不会因为在另一处开了会话而丢掉这一处刚保存的标题。

#### Acceptance Criteria

1. While 多个写入者同时保存不同会话的元数据, the Session Meta Index shall 保留所有写入者保存的元数据，不因并发而丢失其他写入者已保存的会话条目。
2. While 元数据正在被写入, the Sessions List Service shall 读到写入前或写入后的完整元数据之一，不读到部分写入的中间状态。
3. If 并发写入无法在限定时间内取得写入机会, then the Session Meta Index shall 放弃本次元数据写入并保持已有元数据不变，且不阻塞会话本身的运行与列表请求。
4. When 同一会话的同一字段被先后写入不同值, the Session Meta Index shall 以后写入者的值为该字段的最终值。

### Requirement 5: 元数据的生命周期一致

**Objective:** 作为部署方，我想让元数据随会话一同消亡，以便元数据不会无限增长、也不会残留已删除会话的信息。

#### Acceptance Criteria

1. When 一个会话被删除, the Session Meta Index shall 一并清除该会话的元数据条目。
2. If 元数据中存在对应会话已不存在的条目, then the Session Meta Index shall 不将其呈现在会话列表中（列表以实际存在的会话为准，元数据只做富集）。
3. The Session Meta Index shall 提供清除已不存在会话的残留条目的手段，使元数据规模不随时间无界增长。

### Requirement 6: 列表项显示标题、来源与来源色条

**Objective:** 作为 pi-web 用户，我想在列表项上直接看出会话的标题与它属于哪个 agent，以便在多个 agent 的会话混排时快速定位。

#### Acceptance Criteria

1. When 会话列表渲染某会话项且该会话有标题, the Sessions List Panel shall 显示该标题。
2. Where 某会话有所属 agent-source 标识, the Sessions List Panel shall 在该会话项上显示该来源标识。
3. Where 某会话有所属 agent-source 标识, the Sessions List Panel shall 为该会话项显示一条来源色条，且**同一来源的所有会话色条颜色相同、不同来源尽可能不同**。
4. While 同一来源的会话在不同时间被查看, the Sessions List Panel shall 为其显示相同的色条颜色（颜色对来源稳定，不随会话、排序或刷新变化）。
5. Where 某会话无所属 agent-source 标识, the Sessions List Panel shall 不显示来源标识与色条，且列表项布局不因缺少这两项而错位。
6. The Sessions List Panel shall 保持既有列表项信息（时间、所属工作目录）与既有交互（整行点击恢复、列表项操作菜单）不变。
7. Where 某会话已有标题（由自动标题产生或由用户改名）, the Sessions List Panel shall 显示该标题；where 某会话尚无标题, the Sessions List Panel shall 显示「新对话」占位名，而**不**显示会话标识本身。
8. The Sessions List Panel shall 使会话标识在列表项的悬停提示中仍可查得（不占用主标题位）。

### Requirement 7: 列表项显示会话工作状态

**Objective:** 作为同时跑多个会话的 pi-web 用户，我想在列表上看出哪条会话在干活、哪条在等我回应、哪条出错了，以便不必逐个点进去查看。

#### Acceptance Criteria

1. While 某会话的轮次正在进行, the Sessions List Panel shall 在该会话项上显示「工作中」状态指示。
2. While 某会话正在等待用户回应其发起的交互（询问、选择、确认一类）, the Sessions List Panel shall 在该会话项上显示「等待用户交互」状态指示。
3. While 某会话的运行进程处于异常态, the Sessions List Panel shall 在该会话项上显示「异常」状态指示，且该会话仍可被点击恢复。
4. While 某会话同时满足「轮次进行中」与「等待用户回应」, the Sessions List Panel shall 显示「等待用户交互」而非「工作中」（需要用户行动的状态优先）。
5. While 某会话当前没有正在运行的进程, the Sessions List Service shall 将其状态视为空闲，且不为此启动或加载任何会话。
6. While 某会话处于空闲, the Sessions List Panel shall 不显示任何状态指示（不以额外视觉噪声表示空闲）。
7. The Sessions List Service shall 依据既有的会话运行时权威事实判定状态，不从消息流文本或时序推断状态。
8. The Sessions List Service shall 不持久化任何工作状态，使进程异常退出后不残留虚假的「工作中」。

### Requirement 8: 状态变化的可见时机

**Objective:** 作为 pi-web 用户，我想让列表上的状态在会话开始和结束干活时都及时变化，以便状态指示可被信任而不被当成故障。

#### Acceptance Criteria

1. When 某会话的轮次开始, the Sessions List Panel shall 触发一次会话列表刷新，使该会话项在轮次开始后即显示「工作中」。
2. When 某会话的轮次结束, the Sessions List Panel shall 触发一次会话列表刷新，使「工作中」指示随之消失。
3. When 某会话开始等待用户回应, the Sessions List Panel shall 触发一次会话列表刷新，使「等待用户交互」及时可见。
4. While 列表正在刷新, the Sessions List Panel shall 保持已显示的列表项可见与可点击，不因刷新而闪空或丢失滚动位置。
5. Where 状态变化发生在**当前未被查看**的其他会话上, the Sessions List Panel shall 在下一次列表刷新或下一个状态轮询周期内反映该变化（不保证服务端主动推送的即时性）。
6. While 会话列表可见, the Sessions List Panel shall 周期性重新查询会话状态，使其他会话的状态变化无需用户操作即可显现。
7. While 列表中存在至少一个非空闲会话, the Sessions List Panel shall 以较短周期查询；while 列表中所有会话均空闲, the Sessions List Panel shall 以较长周期查询（降低开销但**不停止** —— 停止会使「其他会话开始忙」永远无法被发现）。
7.1. While 会话列表不可见（如页面处于后台）, the Sessions List Panel shall 不进行周期性查询。
8. When 周期性查询返回, the Sessions List Panel shall 更新已显示会话的状态，并把查询中出现而列表尚无的会话加入列表；同时 shall 不移除任何已显示的会话、不改变其相对顺序、不丢弃已加载的分页内容（避免把用户已「加载更多」的内容打回首页）。
9. Where 部署方将查询周期配置为关闭, the Sessions List Panel shall 不进行任何周期性查询，行为回到仅由既有刷新信号驱动。

### Requirement 9: 兼容与不回归

**Objective:** 作为部署方，我想让这次改动不影响命令行侧对同一批会话的读写，也不改变会话列表既有行为，以便升级无需任何数据迁移与操作变更。

#### Acceptance Criteria

1. The Session Meta Index shall 不改变会话历史文件的存放位置、命名与内容格式。
2. While pi 命令行工具与 pi-web 读写同一批会话, the Session Meta Index shall 不使命令行工具对会话的列出、读取、恢复出现错误或行为变化。
3. When 系统首次在已有大量历史会话的环境上启用本特性, the Session Meta Index shall 无需任何迁移步骤即可工作，且既有会话在元数据补齐前仍按既有方式正确显示。
4. The Sessions List Service shall 保持既有的分页、排序、系统视图门控、名称搜索语义不变。
5. Where 某存储后端已自行维护会话名称, the Session Meta Index shall 不使同一事实产生两个互相冲突的来源（该后端下以其自身维护的名称为准）。
6. Where 会话在本特性启用**之前**已创建, the Session Meta Index shall 不保证能补齐其所属 agent-source（该事实从未被记录、无从重建）；此类会话按「无所属来源」展示，不显示来源标识与色条，且这不视为缺陷。
7. Where 会话在本特性启用之前已创建且其历史中已有标题, the Session Meta Index shall 能在首次列出时按既有派生方式取得其标题，并可将其补入索引以避免重复的历史读取。
