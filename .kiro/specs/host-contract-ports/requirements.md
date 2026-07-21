# Requirements Document

## Project Description (Input)

pi-web 宿主契约 v1 的中间标准落地（M1）：为 pi-web 定义四个宿主端口的类型契约与可执行一致性测试套件，使 pi-clouds（云端）与 desktop（桌面）两端能据同一标准并行开工。

### 谁有问题

- **pi-clouds（云端宿主实现者）**：无法从 pi-web 继承能力面，只能「照蓝本重写」装配数组。
- **desktop（桌面宿主实现者）**：无标准接缝可注入云端能力，只能在宿主层打特例。
- **pi-web 维护者**：无契约可依，每次新增能力面都无法得知两端是否需要跟进。

### 现状

1. pi-web 的能力面只有一处权威装配点（17 个注入式路由工厂 + handler options）。pi-clouds 重写该数组后只有 5 项，**12 个路由工厂「默认消失」**，且 pi-web 新增工厂时两端**无任何编译期或运行期信号**。「漏掉」与「有意弃用」在架构上不可区分。
2. 宿主状态无存储端口：配置落盘器是具体类而非接口，路径写死。这是配置面无法上云的唯一技术阻塞——不是没人做，是没有接缝可注入。
3. 云端能力（LLM 出口、agent source registry、附件远端后端）在 pi-web 侧只能经环境变量静态读取，没有可替换的授予端口。
4. 配置域是硬编码字面量联合，新增一个域需改 4 处、跨 3 个包，宿主与 source 均无法扩展；且工具领域 `aigc` 与宿主关切 `auth`/`logging` 并列，属分层错误。

### 应当改变什么

按已冻结的 `docs/pi-web-host-contract-v1.md`（v1）交付**中间标准本体**：四个宿主端口的类型契约，加一套**可执行的一致性测试套件**，使两端各自的实现能被同一标准验收。

### 权威依据

- **契约（冲突时以此为准）**：`docs/pi-web-host-contract-v1.md`（v1 已冻结，2026-07-21）
- 设计动机与取舍：`docs/desktop-cloud-integration-design.md`

---

## Introduction

本特性交付 pi-web 与其两类宿主（云端 pi-clouds、桌面 desktop）之间的**中间标准**：四个宿主端口的契约定义，以及一套可被任意实现引用的一致性测试套件。

标准的价值在于**可验收**而非仅可阅读：契约的核心交付物之一是一致性测试套件，任何宿主实现都必须通过同一套用例。契约冲突因此暴露在各实现自己的测试里，而不是等到联调。

本期只交付标准本体与纯逻辑实现，**不迁移任何既有存储**、**不改变任何既有可观测行为**。目的是尽快解除两端阻塞，而非一次做完全部改造。

---

## Boundary Context

- **In scope**：
  - 四个宿主端口的契约定义：宿主状态存储（Workspace）、能力授予（CapabilityProvider）、能力面清单、配置域注册表
  - 上述端口中可由纯逻辑实现的部分：能力面组装、配置域注册、键校验、值上限校验
  - 一致性测试套件本体及其对外导出
  - 契约版本标识与兼容策略

- **Out of scope**（本期明确不做，避免范围蔓延）：
  - 宿主状态存储的**任何非本地后端**实现（租户后端归云端宿主）
  - **迁移既有存储**到新端口（配置落盘器、收藏、信任库、附件描述符等的改建属后续阶段）
  - 改动现有能力面装配点，使其经新清单组装（属后续阶段）
  - **会话条目存储**——契约已判定其语义与宿主状态存储正交（追加日志 + 索引 vs 文档存储），三个后端均不迁移
  - 附件**字节**存储——已有独立可插拔端口，保持独立
  - agent 运行时的真实文件系统与进程传输（不可虚拟化，另有端口承载）

- **Adjacent expectations**：
  - 本特性**不拥有**任何宿主的具体实现；两端各自实现端口并各自通过一致性套件
  - 本特性**不拥有**鉴权策略。配置写面在多租户环境下的鉴权是宿主责任，且必须先于配置面上云落地
  - 本特性**不拥有**登录状态机。能力加载失败时「不进入已登录状态」是宿主的义务；本特性只保证失败以错误形式呈现且不返回部分快照（Requirement 5），使宿主有据可依
  - 本特性**不拥有**降级行为本身。能力缺失时「退回本地形态并保持可用」由各能力的消费方实现；本特性只保证不可用以字段缺失表达（Requirement 5），使降级可被触发
  - 本特性**依赖**契约文档 `docs/pi-web-host-contract-v1.md` 作为唯一权威；任何实现与文档冲突，以文档为准

---

## Requirements

### Requirement 1: 键空间规则（安全边界）

**Objective:** As a 宿主实现者, I want 键空间规则被契约强制而非各实现自行解释, so that 本地实现把键落成真实路径时不会因越权键造成路径穿越

#### Acceptance Criteria

1. When 宿主以含 `.` 或 `..` 段的键调用宿主状态存储的任一方法, the Host Contract Kit shall 抛出键非法错误且不触及任何存储内容
2. When 宿主以绝对路径形式（前导 `/`）的键调用任一方法, the Host Contract Kit shall 抛出键非法错误
3. When 宿主以含空段（连续分隔符）、空字符或反斜杠的键调用任一方法, the Host Contract Kit shall 抛出键非法错误
4. When 宿主以空字符串作为键调用任一方法, the Host Contract Kit shall 抛出键非法错误
5. The Host Contract Kit shall 将键视为大小写敏感
6. The Host Contract Kit shall 接受以分隔符连接的多段相对键作为合法键
7. When 宿主写入的键的任一严格前缀已是一个既有值键，或该键本身是某个既有值键的严格前缀, the Host Contract Kit shall 抛出键非法错误且错误说明与哪个既有键冲突
8. When 宿主读取一个只是分组前缀、并非值键的键, the Host Contract Kit shall 返回空对象而不抛出错误

> **7、8 的来由（2026-07-21，任务 4.1 复核升级，契约勘误⑧）**：层级载体上 `g/a.json` 一旦是值，
> 其下就放不下 `g/a.json/x.json`；扁平 KV 载体上两者能并存。不把它定为**键空间约束**，就等于
> 承认「同一份配置搬到另一端会炸」是合法状态——而消灭这种状态正是本契约存在的理由。
> 8 是 7 的另一面：规则保证分组永不是值键，故读分组即读一个不存在的键，按 2.1 返回空对象。

### Requirement 2: 宿主状态的读写语义

**Objective:** As a 宿主实现者, I want 读写语义在契约层被规定, so that 不同实现之间的行为差异不会在迁移或跨端复用时才暴露

#### Acceptance Criteria

1. When 宿主对不存在的键请求读取, the Host Contract Kit shall 返回空对象而不抛出错误
2. If 既有值不是合法的结构化文档, then when 宿主请求读取, the Host Contract Kit shall 抛出内容损坏错误
3. When 宿主写入且未指定合并方式, the Host Contract Kit shall 与既有值深度合并并保留既有值中未被本次写入涉及的字段
4. When 宿主写入且指定不合并, the Host Contract Kit shall 整体覆盖，使既有值中本次未提供的字段被删除
5. When 宿主完成一次写入后经同一实例请求读取同一键, the Host Contract Kit shall 返回本次写入后的值
6. While 针对同一键存在并发写入, the Host Contract Kit shall 保证读取方只观察到某一次写入的完整值，不得观察到部分写入的结果
7. When 宿主以某前缀请求列举, the Host Contract Kit shall 只返回该前缀下的直接子键，不返回更深层级的键
8. When 宿主删除一个不存在的键, the Host Contract Kit shall 幂等成功且不抛出错误
9. When 宿主查询一个键是否存在, the Host Contract Kit shall 返回其存在性

> **说明（第 2 条）**：读取遇损坏必须抛错而非返回空对象。若静默返回空对象，一次内容损坏会被视为「空配置」，随后被下一次写入覆盖，造成静默数据丢失。

### Requirement 3: 单键值上限

**Objective:** As a 运维者, I want 单键值上限可按部署环境调整且不会让既有数据变得不可达, so that 不同规模的部署都能安全设限

#### Acceptance Criteria

1. The Host Contract Kit shall 在未配置时采用 1 MiB 作为单键值上限
2. Where 环境变量 `PI_WEB_WORKSPACE_MAX_VALUE_BYTES` 被设为正整数, the Host Contract Kit shall 以该值作为单键值上限
3. If 该环境变量的值不可解析、非整数或不为正, then the Host Contract Kit shall 在装配期抛出错误，而不是静默回落到默认值
4. When 宿主写入的值**在合并之后**的紧凑序列化超过当前上限, the Host Contract Kit shall 抛出超限错误且不写入任何内容
5. When 宿主读取一个体积超过当前上限的既有值, the Host Contract Kit shall 正常返回该值

> **说明（第 5 条）**：上限只在写入时校验。若读取也校验，则把上限调小之后，既有的超限值将无法读出——数据仍在存储中却不可达，且用户无法自救（要缩小它必须先读到它）。
>
> **说明（第 4 条的计量口径，2026-07-21，任务 4.2 复核升级，契约勘误⑨a）**：计量的是**合并之后的整值**，
> 不是本次写入的入参——只量入参的话，反复用小补丁 `merge` 能让实际值无限膨胀而每次都"合规"，
> 上限形同虚设。序列化取**紧凑**形式；落盘表示（缩进等）可以更大，不算超限。
> 该口径须由契约而非某个实现钉死，否则扁平 KV 实现者照字面只量入参就会与本地实现分道扬镳。

### Requirement 4: 双根命名空间

**Objective:** As a 宿主实现者, I want 用户级与项目级状态从一开始就是两个隔离的命名空间, so that 同时存在两种作用域的配置不会相互覆盖

#### Acceptance Criteria

1. The Host Contract Kit shall 提供用户级与项目级两个命名空间
2. When 宿主以同一键分别写入两个命名空间, the Host Contract Kit shall 使两者各自独立读回且互不覆盖
3. When 宿主在一个命名空间中删除某键, the Host Contract Kit shall 不影响另一命名空间中的同名键
4. When 宿主在一个命名空间中列举, the Host Contract Kit shall 不返回另一命名空间中的键

### Requirement 5: 能力授予

**Objective:** As a 桌面用户, I want 云端能力不可用时应用退回本地形态并保持可用, so that 未登录、登录过期或云端故障都不会让我无法工作

#### Acceptance Criteria

1. The Host Contract Kit shall 允许能力快照中的每一项能力独立缺失
2. When 某项能力不可用, the Host Contract Kit shall 以该能力在快照中缺失来表达，而不以抛出错误来表达
3. When 宿主不带会话标识请求能力, the Host Contract Kit shall 不返回附件能力授予
4. When 宿主带会话标识请求能力, the Host Contract Kit shall 使返回的附件授予作用域限定于该会话
5. If 能力加载整体失败, then the Host Contract Kit shall 以错误形式告知调用方，且不返回部分能力快照
6. The Host Contract Kit shall 不将能力快照中的任何凭据写入宿主状态存储、日志或其它持久介质
7. The Host Contract Kit shall 使能力快照中每项授予都带有可被调用方读取的失效时刻

> **说明（第 2/5 条）**：「能力不可用」与「加载失败」必须可区分。前者是正常状态（未登录、云端未启用），以字段缺失表达，宿主据此退回本地形态；后者是异常（网络故障、凭据非法），以错误表达，宿主据此拒绝进入已登录状态。若两者都用错误表达，未登录将无法与故障区分；若都用缺失表达，伪造凭据会被当作「未启用」而静默放行。
>
> **说明（第 3/4 条）**：附件授予必须带会话作用域。若允许签发不含会话标识的公司级附件授权，同一租户内任意用户即可读取彼此所有会话的附件，直接击穿既有隔离。

### Requirement 6: 能力面清单与显式表态

**Objective:** As a pi-web 维护者, I want 宿主必须对每个能力面显式表态, so that 新增能力面时「被漏掉」与「有意弃用」不再无法区分

#### Acceptance Criteria

1. The Host Contract Kit shall 提供一份默认能力面清单，其中每一项具有稳定标识
2. When 宿主组装能力面而清单中存在未被表态的标识, the Host Contract Kit shall 在组装时抛出错误并指明缺少表态的标识
3. When 宿主对某标识表态为沿用, the Host Contract Kit shall 采用默认实现
4. When 宿主对某标识表态为替换, the Host Contract Kit shall 采用宿主提供的实现而不采用默认实现
5. When 宿主对某标识表态为弃用, the Host Contract Kit shall 要求同时提供弃用原因
6. When 宿主对某标识表态为弃用, the Host Contract Kit shall 使该原因可被启动期记录，且不产出该能力面的任何端点
7. If 宿主的表态引用了清单中不存在的标识, then the Host Contract Kit shall 在组装时抛出错误

> **说明（第 2 条）**：失败必须发生在组装时而非请求时。当前云端缺失的能力面表现为运行期 404 或「命令不存在」，与有意关闭无法区分；组装期失败才能把遗漏变成必须处理的信号。

### Requirement 7: 配置域运行时注册

**Objective:** As a 宿主实现者与 agent source 作者, I want 配置域可在运行时注册, so that 新增配置域不必改动跨包的硬编码清单，且宿主与 source 可注册各自的域

#### Acceptance Criteria

1. When 注册方注册一个新配置域, the Host Contract Kit shall 使该域随即可被查询与列举
2. If 以已存在的标识重复注册配置域, then the Host Contract Kit shall 抛出错误而不是静默覆盖
3. The Host Contract Kit shall 默认注册宿主关切的配置域：鉴权、通用设置、沙箱、日志
4. The Host Contract Kit shall 不默认注册任何具体工具领域的配置域
5. If 配置域标识不满足键空间规则或包含分隔符, then the Host Contract Kit shall 拒绝注册

### Requirement 8: 一致性测试套件（契约的可执行部分）

**Objective:** As a 两端宿主实现者, I want 契约附带一套可直接引用的一致性用例, so that 我的实现是否符合契约由测试判定，而不是由各自对文档的解读判定

#### Acceptance Criteria

1. The Host Contract Kit shall 对外导出一套可被任意宿主状态存储实现引用的一致性测试套件
2. When 某实现引用该套件, the Host Contract Kit shall 对该实现执行覆盖 Requirement 1 至 Requirement 4 全部验收行为的用例
3. The Host Contract Kit shall 在套件中包含上限的三种情形：写入超限报错、上限被覆盖后新上限生效、上限调小后既有超限值仍可读
4. The Host Contract Kit shall 在套件中包含并发写入的原子可见性用例
5. When 对内建的本地实现执行该套件, the Host Contract Kit shall 使全部用例通过
6. The Host Contract Kit shall 使套件能以指定的上限取得被测实例，而不依赖修改进程环境

> **说明（第 3/6 条）**：套件验证的是**上限行为**，不是上限的来源。上限经环境变量配置（Requirement 3.1–3.3）是各实现的装配细节——云端实现未必读同名环境变量。若套件为构造「上限调小」的场景而改写进程环境，既违反 env 装配期 fail-fast 的纪律，也对不读该变量的实现无意义。故套件须能向工厂**指定上限**取得被测实例。

### Requirement 9: 契约版本与兼容

**Objective:** As a 两端宿主实现者, I want 契约版本可被程序检出且不兼容时立即失败, so that 版本错配不会以难以定位的运行期异常呈现

#### Acceptance Criteria

1. The Host Contract Kit shall 暴露可被程序读取的契约版本标识
2. When 宿主声明的契约版本与 pi-web 当前契约版本不一致, the Host Contract Kit shall 拒绝启动而不是降级运行
3. The Host Contract Kit shall 允许以新增可选成员或新增端口的方式在同一版本内演进

### Requirement 10: 既有行为不变

**Objective:** As a pi-web 现有用户与维护者, I want 本期交付不改变任何既有可观测行为, so that 标准化过程不以现有功能的稳定性为代价

#### Acceptance Criteria

1. The Host Contract Kit shall 不改变 pi-web 任何既有的用户可观测行为
2. When 本期交付完成后执行既有全量单元与集成测试, the Host Contract Kit shall 使其全部通过
3. When 本期交付完成后执行既有浏览器端到端检阅, the Host Contract Kit shall 使其全部通过
4. The Host Contract Kit shall 不在本期修改既有能力面的装配方式

> **说明**：本期交付的是新增的独立契约模块。既有装配点接入新清单属后续阶段，故本期的既有行为回归必须完全为绿；任何行为变化都应视为本期缺陷而非契约需要放宽。
