# Requirements Document

## Introduction

参考 Grok 侧栏的顶部导航块,本特性给 pi-web 侧栏(当前仅有 `SessionListPanel`,经宿主 slot 注入)在**会话列表之上**新增一个固定的「启动导航区」(LauncherRail)。当前用户在侧栏只能浏览/恢复历史会话,缺少快速动作入口:要搜索历史会话、要基于常用 agent 一键开新会话、要让扩展在侧栏贡献自己的入口,都无处安放。

启动导航区提供四类入口:**搜索**(在历史会话里按名称查找)、**新建聊天**(固定,回到源选择器开新会话)、**收藏的 agent source 锚点**(把常用源置顶为一键启动入口)、以及一个 **webext 贡献插槽**(扩展可在导航区挂自定义渲染)。收藏是本特性引入的、独立于只读源枚举的可读写用户偏好。

## Boundary Context

- **In scope**:
  - 侧栏启动导航区外壳:固定置于会话列表之上,分区展示下述入口。
  - 搜索历史会话:输入关键字按会话名称/显示名过滤并可从结果恢复会话。
  - 新建聊天固定入口:回到 agent source 选择器开新会话。
  - 收藏 agent source:标记/取消收藏、持久化用户收藏、把收藏渲染为可点击锚点、点击即以该源新建会话。
  - webext 导航贡献插槽:扩展经既有 web UI 扩展机制在导航区挂自定义渲染;无扩展时不占位。
  - 相关单元/集成测试与浏览器 e2e。
- **Out of scope**:
  - 不改只读源枚举端点 `/agent-sources` 的语义(收藏是独立的可读写偏好,不写回枚举来源)。
  - 不改会话创建引擎、会话流协议、恢复链路(新建/锚点/恢复均复用既有路径)。
  - 不做跨设备同步/多用户账户体系(收藏为本机 agent 目录级偏好)。
  - 不做会话正文全文检索(搜索仅限会话名称/显示名)。
  - 不新增 webext 层级或改 5 层模型;仅复用既有 Tier2 自定义渲染贡献点。
- **Adjacent expectations**:
  - 依赖既有 `sessions-list` 的列表/恢复能力;搜索在其之上按名称过滤(可经既有 REST 能力扩展一个可选过滤入参,向后兼容,不改既有默认行为)。
  - 依赖既有 `agent-sources-list` 的源 `source` 语义:收藏锚点点击后以 `source` 走既有新建路径,与手输/列表选取等价。
  - 依赖既有宿主 slot 注入与 web UI 扩展 Tier2 渲染贡献机制。

## Requirements

### Requirement 1: 侧栏启动导航区外壳

**Objective:** As a 使用 pi-web 侧栏的用户, I want 侧栏顶部有一个固定的启动导航区, so that 我能在浏览历史会话之外,快速触达搜索、新建与常用 agent。

#### Acceptance Criteria
1. While 侧栏可见, the LauncherRail shall 固定展示在会话列表区之上,包含搜索、新建聊天、收藏锚点与 webext 贡献插槽四个分区。
2. While 会话列表滚动, the LauncherRail shall 保持可见(不随会话列表一起滚出),使固定入口始终可达。
3. Where 某个分区当前无内容可展示(如无收藏、无扩展贡献), the LauncherRail shall 不为该分区占用可见空间或显示空壳。
4. Where 启动导航区特性未启用, the 侧栏 shall 退化为仅展示既有会话列表,不显示导航区(既有体验不受影响)。

### Requirement 2: 新建聊天固定入口

**Objective:** As a 用户, I want 导航区里有一个固定的「新建聊天」入口, so that 我随时能开一个新会话而不必先滚动或返回。

#### Acceptance Criteria
1. The LauncherRail shall 始终展示一个「新建聊天」入口(不随收藏/扩展有无而消失)。
2. When 用户在会话进行中点击「新建聊天」, the 系统 shall 弹出一个**悬浮的源选择对话框**(遮罩层覆于当前对话之上,可关闭),使用户无需离开当前会话即可选源。
3. When 从悬浮对话框提交/选取一个源, the 系统 shall 以该源新建会话(沿用既有提交路径),并关闭对话框。
4. When 用户点击对话框关闭按钮、点击遮罩或按 Esc, the 系统 shall 关闭对话框并保持当前会话不变。
5. While 处于初始启动屏(尚无会话), the 源选择器 shall 以整页形态展示(其身后无对话,无需悬浮遮罩)。

### Requirement 3: 搜索历史会话

**Objective:** As a 用户, I want 在导航区点击搜索并输入关键字查找历史会话, so that 我能在大量会话里快速定位想恢复的那个。

#### Acceptance Criteria
1. When 用户点击搜索入口, the LauncherRail shall 展示一个会话搜索输入。
2. When 用户在搜索输入中键入关键字, the 系统 shall 展示名称/显示名匹配该关键字的历史会话结果。
3. When 用户从搜索结果中选择一个会话, the 系统 shall 恢复该会话(复用既有会话恢复链路)。
4. If 搜索关键字无任何匹配, then the 系统 shall 展示可识别的"无结果"提示,而不使侧栏其余部分失效。
5. When 用户清空搜索关键字或退出搜索, the 系统 shall 恢复到未搜索的常态(不残留过滤态)。
6. The 会话搜索 shall 仅按会话名称/显示名匹配,不检索会话正文内容。

### Requirement 4: 收藏 agent source 并作为启动锚点

**Objective:** As a 用户, I want 把常用的 agent source 标记为收藏并置于导航区, so that 我能一键用它开新会话而不必每次去列表里找。

#### Acceptance Criteria
1. When 用户对某个 agent source 执行收藏操作, the 系统 shall 持久化该收藏(至少含其 `source` 与显示名),使之在后续加载后仍然存在。
2. When 用户对一个已收藏的 source 执行取消收藏, the 系统 shall 移除该收藏并在导航区不再展示其锚点。
3. While 存在已收藏的 source, the LauncherRail shall 在导航区把每个收藏渲染为一个可点击锚点(展示其显示名)。
4. When 用户点击一个收藏锚点, the 系统 shall 以该收藏的 `source` 新建一个会话(与手输/源列表选取等价)。
5. Where 当前没有任何收藏, the LauncherRail shall 不展示收藏分区(不占位、不显示空壳)。
6. The 收藏 shall 作为独立于只读源枚举的用户偏好持久化,收藏/取消收藏不修改源枚举的来源(扫描目录/注册表文件)。
7. If 持久化的收藏中某项无法读取或损坏, then the 系统 shall 跳过该项并仍展示其余可用收藏,而不使导航区整体失效。

### Requirement 5: webext 导航贡献插槽

**Objective:** As a 扩展作者, I want 在侧栏导航区贡献一个自定义渲染的入口, so that 我的扩展能在用户侧栏提供自己的快捷动作。

#### Acceptance Criteria
1. Where 存在为侧栏导航区贡献自定义渲染的已启用扩展, the LauncherRail shall 在导航区展示该扩展贡献的自定义渲染内容。
2. Where 没有任何扩展为导航区贡献内容, the LauncherRail shall 不为该插槽占用可见空间(不显示空壳)。
3. The webext 导航贡献 shall 复用既有 web UI 扩展的自定义渲染贡献机制,不新增扩展层级、不改既有 5 层模型。
4. If 某个扩展的导航贡献渲染失败, then the 系统 shall 不使导航区其余分区或会话列表失效(失败被隔离)。

### Requirement 6: 门控、边界与不回归

**Objective:** As a pi-web 维护者, I want 新导航区可被门控且不破坏既有侧栏与会话流, so that 引入它不影响未启用该特性的部署与既有功能。

#### Acceptance Criteria
1. Where 启动导航区未启用, the 系统 shall 表现为"侧栏只有既有会话列表",不请求收藏、不渲染导航区(前后端一致)。
2. The 搜索会话入参扩展 shall 向后兼容:未传搜索关键字时,既有会话列表行为与结果不变。
3. The 收藏读写 shall 仅作用于本机 agent 目录级偏好存储,不产生除该偏好文件外的写副作用(不 clone、不改注册表/扫描来源、不 spawn 会话之外的进程)。
4. When 收藏锚点、新建聊天或搜索结果触发新建/恢复会话, the 系统 shall 复用既有会话创建/恢复链路,不改其协议与语义。
