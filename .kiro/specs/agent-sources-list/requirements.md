# Requirements Document

## Introduction

本特性为 pi-web 的"新建会话"入口(`components/agent-source-picker.tsx` 的 `AgentSourcePicker`)补上一个**可浏览的 agent source 列表**。当前用户只能在文本框里手输一个 source 字符串(本地目录路径或 git URL)才能开始会话;当用户不记得路径、或想在若干个常用 agent 之间快速切换时,手输体验很差。

本特性新增一个**只读**的后端枚举端点,把"当前环境下可用的 agent source"聚合成一个列表返回给前端;数据来源为两路合并:对配置根目录的**目录扫描**与一个显式**注册表文件**。前端在原有手输框之上展示这个列表,点击任一项即以该项的 source 字符串走既有的提交路径创建会话。本特性不改动会话创建引擎、协议的会话流、也不引入任何写操作。

## Boundary Context

- **In scope**:
  - 只读枚举端点 `GET /agent-sources`,聚合"目录扫描"与"注册表文件"两路来源、去重后返回轻量元数据列表。
  - 目录扫描发现:扫描配置的一个或多个根目录的一级子目录,识别其中的有效 agent source 及其模式(custom/cli)。
  - 注册表文件发现:读取一个 JSON 清单里显式登记的源。
  - 前端 `AgentSourcePicker` 在手输框之上展示可选源列表并支持点击选取。
  - 只读安全边界:路径遍历防护、缺失/损坏来源的容错。
  - 相关单元/集成测试与浏览器 e2e。
- **Out of scope**:
  - 任何写操作:不新增/删除/编辑注册表、不 clone git、不改信任策略。
  - 不触发 `AgentSourceResolver.resolve()`(该动作会 clone/装配子进程);枚举仅读元数据。
  - 不改 `POST /sessions` 会话创建链路、`usePiSession`、REST/SSE 协议的会话流语义。
  - 不改会话列表(`sessions-list`)相关的任何行为。
- **Adjacent expectations**:
  - 依赖既有 `AgentSourcePicker.onSubmit(source)` 提交路径:选中列表项等价于把该项 source 字符串交给 `onSubmit`,后续会话创建行为与手输完全一致。
  - 依赖既有 `agent-source` 模块的源探测语义(是否含 `index.[jt]s` 入口、custom/cli 模式判定)作为"有效源"的判据,枚举结果须与真正创建会话时的判定一致。
  - 端点通过既有的路由注入 seam 装配进主 handler,与 `sessions-list` 等注入式端点并列共存,互不影响。

## Requirements

### Requirement 1: 浏览可用的 agent source 列表

**Objective:** As a 使用 pi-web 新建会话入口的用户, I want 看到一份当前环境下可用的 agent source 列表, so that 我无需记住并手输路径就能选一个 agent 开始会话。

#### Acceptance Criteria
1. When 前端请求 agent source 列表, the Agent Sources 端点 shall 返回一个包含零个或多个源条目的列表,每个条目至少含稳定标识、可直接提交的 source 字符串、显示名、来源类型(dir/git)、来源渠道(scan/registry)与解析模式(custom/cli)。
2. While 未配置任何扫描根目录且注册表文件不存在, the Agent Sources 端点 shall 返回一个空列表且以成功状态响应(不报错)。
3. When 请求参数非法(如 limit 非正整数、cursor 无法解码), the Agent Sources 端点 shall 以客户端错误状态拒绝并给出可识别的错误信息,且不返回部分列表。
4. Where 列表项数量超过单页上限, the Agent Sources 端点 shall 返回一个不透明续取游标,使前端可据此拉取后续页且不重复已返回的条目。

### Requirement 2: 目录扫描发现源

**Objective:** As a 部署 pi-web 的运维者, I want 把一个存放多个 agent 的目录配置为扫描根, so that 该目录下的每个 agent 子目录自动出现在列表里而无需逐个登记。

#### Acceptance Criteria
1. Where 配置了一个或多个扫描根目录, the 目录扫描发现 shall 枚举每个根目录的一级子目录,并对每个子目录按既有源探测语义判定其是否为有效 agent source。
2. When 某个子目录含有效入口文件(如 `index.ts`/`index.js`), the 目录扫描发现 shall 将其纳入列表并标注解析模式为 custom。
3. If 某个子目录不含有效入口文件, then the 目录扫描发现 shall 依据既有源探测语义将其纳入为 cli 模式或排除(与真正创建会话时的判定保持一致),不得把无法作为源的目录误报为可用源。
4. When 为扫描发现的源生成可提交的 source 字符串, the 目录扫描发现 shall 使用可被会话创建链路直接接受的路径形态(选中后创建会话应成功,不因路径形态而失败)。
5. If 某个候选子目录经真实路径解析后不落在配置的扫描根之内(如经符号链接逃逸), then the 目录扫描发现 shall 拒绝将其纳入列表。

### Requirement 3: 注册表文件发现源

**Objective:** As a 用户, I want 在一个清单文件里显式登记我常用的 agent source(含自定义名称), so that 无论它们是否在扫描根下都能稳定出现在列表里。

#### Acceptance Criteria
1. Where 配置的注册表文件存在且为合法清单, the 注册表发现 shall 读取其中每一条登记项并纳入列表,采用登记项声明的 source 字符串与显示名等元数据。
2. If 注册表文件不存在, then the 注册表发现 shall 视为零条登记项并成功返回(不报错)。
3. If 注册表文件存在但内容无法解析或结构非法, then the 注册表发现 shall 不使整个列表请求失败,而是跳过无法解析的内容并使端点仍返回其余可用来源。
4. Where 注册表登记项声明了 git source, the 注册表发现 shall 将其纳入列表并标注来源类型为 git,且在枚举阶段不执行任何 clone。

### Requirement 4: 合并与去重

**Objective:** As a 用户, I want 同一个源在扫描与注册表两路都命中时只出现一次, so that 列表不含重复项且我登记的元数据优先生效。

#### Acceptance Criteria
1. When 目录扫描与注册表两路发现了指向同一个源的条目, the Agent Sources 端点 shall 在返回列表中将其合并为单一条目(按稳定标识去重)。
2. When 两路对同一源提供了不同的显示名或描述, the Agent Sources 端点 shall 采用注册表登记项提供的元数据(注册表覆盖扫描)。
3. The Agent Sources 端点 shall 以稳定、可预期的顺序返回列表条目(如注册表来源优先,其后按显示名排序),使同一环境下多次请求的相对顺序一致。

### Requirement 5: 在选择器中展示并选取源

**Objective:** As a 用户, I want 在新建会话界面直接从列表点选一个源, so that 我一键即可用该 agent 开始会话,而不必手输路径。

#### Acceptance Criteria
1. While 新建会话选择器可见, the AgentSourcePicker shall 在既有手输框之上展示可选源列表,每项显示其显示名、解析模式标识与(可选)描述。
2. When 用户点击列表中的某一项, the AgentSourcePicker shall 以该项的 source 字符串走既有 `onSubmit` 提交路径创建会话,行为与在手输框输入等价字符串再提交完全一致。
3. While 列表正在加载, the AgentSourcePicker shall 显示加载指示;When 加载失败, the AgentSourcePicker shall 显示可识别的错误且不阻断手输框的正常使用。
4. If 列表为空(无任何可用源), then the AgentSourcePicker shall 显示空态提示并保留手输框作为兜底入口。
5. While 一次会话正在创建中, the AgentSourcePicker shall 禁用列表项的重复点击(与既有提交按钮的加载态一致)。

### Requirement 6: 只读与安全边界

**Objective:** As a pi-web 维护者, I want 枚举端点严格只读且不可被用于探测任意文件系统路径, so that 引入列表功能不扩大攻击面、也不产生副作用。

#### Acceptance Criteria
1. The Agent Sources 端点 shall 在处理任一枚举请求时不产生任何写副作用(不创建/修改注册表、不 clone、不 spawn 会话子进程、不改信任库)。
2. The 目录扫描发现 shall 仅枚举配置的扫描根之内的目录,不得因请求参数而枚举配置范围之外的任意路径。
3. While 富集源的显示名/描述需读取子目录内的元数据文件, the Agent Sources 端点 shall 以有界并发读取,避免因根目录条目过多导致单次请求长时间不响应。
4. Where 前端未启用源列表入口或后端未配置任何来源, the 系统 shall 表现为"无列表可浏览"(前端不显示列表、后端返回空),而不暴露报错或半成品状态。
