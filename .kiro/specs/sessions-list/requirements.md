# Requirements Document

## Introduction

本特性为 pi-web 增加「会话列表」（Sessions List）能力：用户可在 Web UI 内浏览历史会话，并一键恢复任意历史会话继续对话。会话历史已由底层持久化（每个会话按其工作目录 cwd 分桶存储，含 id、cwd、创建/修改时间、可选名称等元数据），但此前从未在 Web UI 暴露——用户若要恢复会话，只能手动提供会话 id。本特性提供两类视图：**当前目录会话**（仅当前工作目录下的会话）与**系统会话**（本机全部目录下的会话），后者默认关闭、需由部署方显式开启。会话列表以可配置的展示位置嵌入聊天界面，不占用、不替换既有对话区。

## Boundary Context

- **In scope**:
  - 列出「当前目录」会话与「系统（全机器全部目录）」会话两类视图。
  - 列表项展示轻量元数据（名称/标识、创建或修改时间、所属工作目录）。
  - 从列表一键恢复某历史会话并进入该会话继续对话。
  - 系统会话视图的开/关由部署配置控制，默认关闭。
  - 会话列表的展示位置由配置控制（默认位于聊天界面左侧栏），并可重定位到其它界面区域。
  - 大规模会话集合下的分页与排序（避免一次性加载全部历史）。
- **Out of scope**:
  - 会话的删除、重命名、归档、搜索/全文检索（本期不做，留待后续）。
  - 列表项展示会话消息条数、首条消息摘要等需读取会话正文的重型字段（本期只用文件头部轻量元数据）。
  - 跨机器/远端会话聚合（仅限本机持久化的会话）。
  - 新建会话入口（已由现有界面提供，不在本特性内重做）。
- **Adjacent expectations**:
  - 依赖既有的会话持久化与「恢复会话」能力：恢复时复用现有的「按会话 id 恢复」通道；本特性只负责让用户选中某会话并触发恢复，不负责会话运行/流式本身。
  - 依赖既有的界面区域插槽（slot）机制承载展示位置；本特性以「宿主注入」的方式占用某个插槽，与既有/扩展贡献的内容按既定优先级共存，不破坏既有布局。

## Requirements

### Requirement 1: 浏览当前目录会话

**Objective:** 作为 pi-web 用户，我想看到当前工作目录下的历史会话列表，以便快速找回并继续之前在本目录进行的工作。

#### Acceptance Criteria

1. When 用户打开会话列表的「当前目录」视图, the Sessions List Service shall 返回当前工作目录下已持久化的会话集合。
2. The Sessions List Service shall 按会话的最近修改时间倒序排列返回的会话（最新在前）。
3. When 当前工作目录下不存在任何已持久化会话, the Sessions List Panel shall 展示「暂无会话」的空态提示，而非报错或空白。
4. Where 单个会话的元数据缺失或文件损坏无法解析, the Sessions List Service shall 跳过该会话并继续返回其余可用会话，不使整个列表请求失败。

### Requirement 2: 浏览系统会话（默认关闭）

**Objective:** 作为 pi-web 用户，我想在需要时浏览本机所有目录下的全部历史会话，以便跨项目找回某个会话；同时作为部署方，我希望该能力默认关闭以避免暴露全机器会话清单与扫描开销。

#### Acceptance Criteria

1. While 系统会话视图被部署配置开启, when 用户切换到「系统会话」视图, the Sessions List Service shall 返回本机全部工作目录下已持久化的会话集合（按最近修改时间倒序）。
2. While 系统会话视图未被开启（默认）, the Sessions List Panel shall 不展示「系统会话」入口（仅保留「当前目录」视图）。
3. If 在系统会话视图未开启时仍向服务请求系统会话, then the Sessions List Service shall 拒绝该请求并返回明确的「未启用」结果，而不返回任何会话数据。
4. While 系统会话视图开启, the Sessions List Service shall 以分页方式返回结果而非一次性返回全部会话，以控制大规模历史下的响应开销。

### Requirement 3: 列表项信息与轻量加载

**Objective:** 作为 pi-web 用户，我想在列表项上看到足以区分会话的关键信息，并且列表能在大量会话下快速加载，以便高效定位目标会话。

#### Acceptance Criteria

1. The Sessions List Panel shall 为每个会话项展示其名称或标识、时间（创建或最近修改）、以及所属工作目录。
2. The Sessions List Service shall 仅依据会话的轻量头部元数据构建列表项，不读取会话正文消息内容。
3. While 会话集合规模很大, the Sessions List Service shall 分页返回结果（提供可继续加载下一页的游标），单页数量受可配置上限约束。
4. When 用户请求下一页, the Sessions List Service shall 在已返回结果之后继续返回后续会话，且不重复已返回的会话。

### Requirement 4: 恢复历史会话

**Objective:** 作为 pi-web 用户，我想从列表中点选一个历史会话直接进入并继续对话，以便无需手动记忆或输入会话 id。

#### Acceptance Criteria

1. When 用户在列表中选择某个会话的「恢复」操作, the Sessions List Panel shall 以该会话的标识发起恢复，并进入该会话的对话界面。
2. When 会话被恢复后进入对话界面, the Sessions List Panel shall 展示该会话既有的历史消息上下文，使对话从中断处接续。
3. If 选中的会话已不存在或无法被恢复, then the Sessions List Panel shall 向用户展示明确的失败提示，且不丢失当前正在进行的会话。

### Requirement 5: 可配置的展示位置

**Objective:** 作为部署方/集成方，我想控制会话列表在界面中的展示位置，以便适配不同 agent 的界面布局，而非将其位置写死。

#### Acceptance Criteria

1. The Sessions List Panel shall 默认展示于聊天界面的左侧栏区域。
2. Where 部署配置指定了其它界面区域, the Sessions List Panel shall 展示于所指定的区域而非默认左侧栏。
3. The Sessions List Panel shall 以追加方式占用所在界面区域，不替换或遮挡既有的对话区与既有界面元素。
4. Where 同一界面区域同时存在扩展（webext）贡献的内容, the Sessions List Panel shall 遵循既定的宿主优先级与既有内容共存，不破坏既有布局行为。

### Requirement 6: 视图切换与状态可见性

**Objective:** 作为 pi-web 用户，我想在「当前目录」与「系统会话」之间清晰切换并感知加载状态，以便明确自己正在浏览的范围与进度。

#### Acceptance Criteria

1. While 系统会话视图已开启, the Sessions List Panel shall 提供「当前目录」与「系统会话」之间的可见切换控件，并指示当前所处视图。
2. While 列表正在加载, the Sessions List Panel shall 展示加载中的状态指示。
3. If 列表数据加载失败, then the Sessions List Panel shall 展示可重试的错误提示，而非静默空白。
