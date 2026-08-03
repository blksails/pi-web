# Requirements Document

## Project Description (Input)

**谁有问题**:任何使用 pi-web 但没有(也不想)写 web extension 的 agent 的使用者 ——
包括内置 default-agent、第三方 agent source、以及用户临时起的 agent 目录;以及想提供
「对所有会话都成立」的通用能力(文件浏览、编辑、日志、浏览器)的宿主自身。

**现状**:panes 只经 agent 的 web extension 装载 —— `.pi/web/web.config.tsx` 的
`slots.panelRight` 渲染 `PanesHost`,`definition` 全部来自 agent 侧的 `pane-meta.ts` /
`PaneAgentModule`。后果有三:① 没写 web extension 的 agent 一个 pane 也看不到;
② 宿主的通用能力无处安放,只能伪装成某个 agent 的领域声明;③ `isolated-panes`
Wave 0–4 建成的整套地基(panes-kit 契约、`PanesHost`、Guest SDK、authorization、
`PaneAgentModule`、桌面 relay/Tauri adapter)使用面极窄。宿主侧当前**零**默认 pane
(全仓 grep 无 `builtinPanes`/`BUILTIN_PANES` 任何形态),`PanesHost` 没有宿主自己的装载
时机,也不存在「宿主定义 ⊕ agent 定义」的合并语义。

**该改成什么**:宿主默认给每个会话装载一组内置 pane 定义,任何 agent(含完全没有 web
extension 的、含 cli 模式的)零改动即可见 panes;agent 若声明 pane,其 pane 在内置集合
之上追加合并,冲突语义明确且可测;内置 pane 的**内置身份不产生额外权限** —— 与第三方
pane 走同一 grant 路径,`isolated-panes` Req 4.1/4.2 的默认拒绝对内置同样成立;既有
agent 侧 panes(`examples/panes-agent` / `examples/aigc-canvas-agent`)行为不回退。

本 spec 只建**机制**:内置 pane 定义注册表、宿主装载点、合并与冲突语义、不提权保证。
具体 pane 的 UI 归 `builtin-pane-suite` / `builtin-pane-browser`;文件与日志等宿主能力
route 与授权归 `pane-host-capabilities`。

> 详细背景、被否方案与约束见 `.kiro/specs/host-builtin-panes/brief.md` 与
> `.kiro/steering/roadmap.md` 的「宿主内置 panes + 形态化登录 + 会话活跃态波次」。

## Introduction

本特性把 panes 从「agent 的私有装饰」提升为「宿主对所有会话都成立的能力」。

需求勘察发现的关键事实,决定了本特性的范围比 brief 初稿更宽:**今天右侧面板整体的启用
判据是「agent 是否声明了 panelRight 槽」**(`components/chat-app.tsx:654`、
`packages/ui/src/chat/pi-chat.tsx:902`)。这个判据一旦不成立,不只是没有 pane —— 面板
容器、显示/隐藏开关、连续宽度拖拽、比例切换器、以及**只注入给该槽的 agent 状态访问**
与空闲控制流,全部都不存在。因此「让所有 agent 都能见 panes」等价于「把这一整套面板
基础设施的启用条件从 agent 声明改为宿主装载」,而不只是补一份默认 pane 列表。

第二个事实:agent 今天的 pane 定义只活在它自己槽渲染器的闭包里,宿主**无从枚举** ——
所以「合并」不仅是算法问题,还要求 agent 的 pane 声明对宿主可见。宿主对该声明保持领域
中立(只搬运与合并,不解释 pane 内部语义),先例是既有的 canvas 插件捆声明键。

## Boundary Context

- **In scope**:宿主内置 pane 集合的注册与枚举;宿主侧面板装载时机与启用判据;
  内置 ⊕ agent 声明的合并与冲突语义(标识冲突、顺序、初始打开集合、同时打开上限);
  「内置身份不提权」的授权保证;既有 agent 侧 panes 的不回退;内置集合为空或某份定义
  非法时的降级;一个不依赖任何新宿主能力的最小内置 pane,作为机制的可取证载体。
- **Out of scope**:file_explorer / code_editor / logging 三个内置 pane 的实现
  (→ `builtin-pane-suite`);browser 内置 pane(→ `builtin-pane-browser`);
  文件系统与日志等宿主能力的接口与鉴权(→ `pane-host-capabilities`);
  pane 与宿主之间既有五种 guest 操作与四种下行消息的协议改动(除合并语义确有必要,
  且须在设计阶段显式论证);agent 侧 pane 工具与路由的绑定校验(既有能力,本特性不改)。
- **Adjacent expectations**:
  - 本特性**依赖**既有的默认拒绝授权模型(能力只源于已装载的 pane 定义,pane 自报的任何
    标识不产生权限),并要求该性质在内置 pane 上同样成立;本特性**不**放宽它。
  - 本特性**不拥有**任何具体 pane 的领域行为,也不拥有宿主能力接口 —— 下游 spec 各自负责。
  - 本特性**不拥有**部署形态(本地 web / 桌面 / 云端)的判定,该判定归 `desktop-account-login`。
  - 会话工作目录、会话标识等宿主已有信息属于会话装配的产物,本特性只消费、不重新定义。

## Requirements

### Requirement 1: 内置 panes 的默认可见性

**Objective:** 作为使用任意 agent 的用户,我希望不论该 agent 是否自带 web extension、
以何种模式运行,都能看到宿主提供的 panes,以便通用能力随处可用而不必逐 agent 适配。

#### Acceptance Criteria

1. The 宿主 pane 装载器 shall 在每个会话中装载宿主内置 pane 集合,且不以 agent 是否提供
   web extension、以何模式运行为前提。
2. Where agent 自带右侧面板槽渲染器(既有形态), the 宿主 pane 装载器 shall 让内置 panes
   让位于该渲染器,并给出说明迁移途径的诊断信息。
   > 理由:槽渲染器占满整个面板区域,内置 panes 无处安放;两套面板并存会让用户看到分裂的
   > 标签页与两套实例生命周期。让位是 agent 作者的显式选择(声明了槽),而非本特性的缺陷 ——
   > agent 改用可枚举的 pane 声明后即与内置合并。既有形态的不回退见 Requirement 5。
3. When 用户打开一个由**不带 web extension** 的 agent source 创建的会话, the 会话外壳
   shall 呈现右侧面板容器、其显示/隐藏开关,以及其中的内置 panes。
4. Where 会话的 agent 以 cli 模式运行, the 宿主 pane 装载器 shall 与 custom 模式一样
   装载内置 panes。
5. While 内置 panes 可见, the 会话外壳 shall 提供与既有 agent 侧 panes 相同的面板宽度
   调整与比例切换能力。
6. When 内置 panes 已装载而 agent 未声明任何 pane, the 会话外壳 shall 默认打开内置集合
   中被标记为默认打开的 pane;若无任何标记项,则面板保持可开启但初始为空态提示,而不是
   显示一块无内容的空白区域。
7. If 宿主内置 pane 集合为空且 agent 亦未声明任何 pane, then the 会话外壳 shall 保持与
   本特性实施前逐字一致的外观 —— 不出现空的右侧面板容器、不出现无用的开关控件。

### Requirement 2: 内置与 agent 声明的合并语义

**Objective:** 作为 agent 作者,我希望自己声明的 pane 与宿主内置 pane 并存于同一面板,
且合并规则明确、可预期、不会随宿主内置集合的增减而改变我的 pane 的行为。

#### Acceptance Criteria

1. When agent 声明了 pane, the 宿主 pane 装载器 shall 把 agent 的 pane 追加在内置 pane
   之后,内置在前、agent 在后,且该顺序稳定不随装载时序变化。
2. The agent 的 pane 声明 shall 对宿主可枚举,使宿主能在装载期把它与内置集合合并;宿主
   对该声明保持领域中立,只搬运与合并,不解释 pane 的内部语义。
3. The 合并结果 shall 满足与单一来源定义相同的结构约束 —— pane 标识在合并后仍唯一、
   初始打开的 pane 均存在且不超出各自实例上限、初始打开数不超出同时打开上限。
4. When 内置集合与 agent 声明各自给出了同时打开上限, the 宿主 pane 装载器 shall 取其中
   较大者,使 agent 原有的可同时打开数量不因内置 pane 的加入而缩水。
5. When 内置集合与 agent 声明各自给出了初始打开的 pane, the 宿主 pane 装载器 shall 完整
   保留 agent 的初始打开集合;内置的默认打开项仅在追加后仍不超出同时打开上限时才被追加,
   超出则丢弃内置的默认打开项而非丢弃 agent 的。

### Requirement 3: 标识冲突的结构性排除

**Objective:** 作为宿主的维护者,我希望 agent 无法冒用或顶替宿主内置 pane 的身份,因为
内置 pane 将承载文件读写等宿主能力,身份被顶替等于权限被窃取。

#### Acceptance Criteria

1. The 宿主内置 pane 的标识 shall 使用一个保留命名空间,使其与 agent 声明的标识在结构上
   不可能相同。
2. If agent 声明的 pane 使用了保留命名空间, then the 宿主 pane 装载器 shall 拒绝该 pane
   的声明、给出能定位到具体 pane 标识与冲突原因的诊断信息,并保持内置 panes 与该 agent
   的其余合法 pane 可用。
3. The 宿主 pane 装载器 shall 在任何情况下都不允许 agent 的声明替换、遮蔽或改写某个内置
   pane 的定义。
4. When 保留命名空间的规则被违反, the 宿主 pane 装载器 shall 让该违反在会话装载期即可
   观察到,而不是等到用户点开某个 pane 才表现为异常。

### Requirement 4: 内置身份不产生额外权限

**Objective:** 作为对安全负责的维护者,我希望内置 pane 与第三方 pane 走同一条授权路径,
使「内置」只意味着来源,不意味着特权。

#### Acceptance Criteria

1. The 宿主 pane 装载器 shall 令内置 pane 的能力仅来自其已装载定义中逐项声明的授权,
   与第三方 pane 完全同路。
2. If 某内置 pane 未被授予某项能力, then the 宿主 shall 拒绝该 pane 对该能力的调用,
   拒绝行为与第三方 pane 在相同情形下逐字一致。
3. The 宿主 shall 不因某 pane 属于内置集合而跳过、放宽或额外授予任何能力检查。
4. While 内置 pane 与 agent 声明的 pane 同时在世, the 宿主 shall 保持两者之间的隔离
   边界 —— 一方不能读取或影响另一方的运行环境。

### Requirement 5: 既有 agent 侧 panes 不回退

**Objective:** 作为已经写了 pane 的 agent 的作者,我希望这次提层不改变我的 pane 的任何
既有行为,因为我没有参与这次改动、也无从预知它。

#### Acceptance Criteria

1. The 会话外壳 shall 保持既有 agent 侧 panes 的装载、连接、重连、多开与关闭行为不变。
2. The 会话外壳 shall 继续向承载 panes 的面板注入 agent 状态访问与轮末同步信号,其时序
   与本特性实施前一致。
3. When agent 自带右侧面板槽渲染器, the 会话外壳 shall 使该形态继续可用,不要求 agent
   改写为新的声明方式。
4. If 某 agent 的 pane 声明不合法, then the 宿主 pane 装载器 shall 保留内置 panes 可用、
   报告该 agent 的声明错误,而不是让整个面板不可用。

### Requirement 6: 机制的可取证载体

**Objective:** 作为需要验收本特性的人,我希望「零改动即可见」这句话有一个真实可点开的
东西可验,而不是只有一份空的注册表。

#### Acceptance Criteria

1. The 宿主内置 pane 集合 shall 至少包含一个 pane,其内容只依赖宿主已有的会话信息,
   不依赖任何本特性范围外的新能力。
2. When 用户在一个不带 web extension 的会话中打开该内置 pane, the 该 pane shall 显示
   可辨识的真实会话信息,使「装载链路通了」与「装载链路断了」在观察上可区分。
3. The 该内置 pane shall 与第三方 pane 同构 —— 同一隔离形态、同一通信协议、同一授权路径。

### Requirement 7: 可诊断性与取证方式

**Objective:** 作为维护者,我希望本特性的失败是可诊断的,且验收判据能抓住这一类改动最
容易出的错。

#### Acceptance Criteria

1. When 装载期发生任何拒绝、降级或合并冲突, the 宿主 pane 装载器 shall 输出足以定位到
   具体 pane 标识与来源(内置 / 某 agent)的诊断信息。
2. If 内置 pane 集合中某一份定义本身非法, then the 宿主 pane 装载器 shall 报告该定义
   错误并使其余内置 panes 仍可用,而不是整体不装载。
3. The 宿主 pane 装载器 shall 在真实浏览器环境中表现出与组件级验证一致的装载与时序行为
   —— 既有同类改动曾出现「组件级测试全绿而真实浏览器全红」,故组件级验证通过不足以判定
   本特性达标,须有真实浏览器端到端证据。
4. The 宿主 pane 装载器 shall 在两种 agent 运行模式(custom 与 cli)与两种 agent 形态
   (带 web extension 与不带)下都表现出本文档规定的行为,且每一种组合都须有各自的证据 ——
   仅在其中一种组合上取证不构成覆盖。
