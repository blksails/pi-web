# Requirements Document

## Introduction

pi-web 的 web 会话面目前无法安装 agent source——安装能力分裂在三张脸上:agent 子进程内的 `/plugin` 扩展命令(仅 pi 资源,受 pending 卡顿限制默认隐藏)、REST `POST /extensions`(程序化面,仅 pi 资源)、以及 CLI 的 `pi-web install`(有 agent/plugin 双通道但只在终端可用)。本特性新增 host 命令 **`/install`**(用户拍板命名,分析报告 `docs/plugin-command-kind-install-analysis.md` 方案②):在 web 聊天输入框按 kind 安装/卸载/列出/更新 agent 与 plugin,实现复用 CLI install 子域,门控沿用 web 面既有三门,并摘除旧的 agent 侧 `/plugin` 命令。

## Boundary Context

- **In scope**:host 命令 `/install` 的全部子动作(install/uninstall/list/update);kind 自动判别与 `--kind` 覆盖;web 面安装门控(与 REST 安装端点共享同一份);生效语义分道(plugin→当前会话 reload,agent→选择器刷新+指引);`kind:"component"` 包在 web `/install` 与 CLI `pi-web install` 两个通道的显式拒绝与指引;旧 agent 侧 `/plugin` 命令摘除;命令补全词条迁移;安装结果的结构化卡片呈现。
- **Out of scope**:REST `POST /extensions` 增加 agent 通道(REST 保持程序化面现状);安装授权粒度细化(沿既有全局管理员判定);component 包经 `/install` 安装(仍走 CLI `pi-web add` 车道);registry/marketplace 远端解析;`pi-web add` 车道本身的任何变更。
- **Adjacent expectations**:本特性直接复用 CLI install 子域的既有实现(kind 分派安装器、agent 落盘与注册表登记、plugin 安装器),不复制第二份安装逻辑;agent source 列表沿既有「目录扫描 ∪ 注册表」只读语义,本特性不改变其数据来源,只要求装后可见;host 命令同步执行通道(决策A)是既有骨架,本特性向其注册新命令而不改变通道语义。

## Requirements

### Requirement 1: /install 命令与子动作面

**Objective:** 作为 web 会话操作者,我想在聊天输入框用 `/install` 管理 agent 与 plugin 的安装,以便不离开会话就能装卸包。

#### Acceptance Criteria

1. When 用户提交 `/install install <source>`,the /install 命令 shall 按判别出的 kind 执行安装,并在当前请求内同步返回结果(不进入 agent 回合、不产生流式回复)。
2. When 用户提交 `/install uninstall <name>`,the /install 命令 shall 按 kind 卸载对应包并同步返回结果。
3. When 用户提交 `/install list`,the /install 命令 shall 返回已安装 plugin 清单(含 id、版本、作用域);当附带 `--outdated` 时 shall 如实转达底层能力的结果(底层不支持过时检测时如实报告不支持,不得谎报可更新性)。
4. When 用户提交 `/install update [id]`,the /install 命令 shall 对指定包(缺省为全部可更新包)执行更新并逐项返回结果;update 仅支持 plugin 通道。
5. When 用户提交裸 `/install` 或未知子动作,the /install 命令 shall 返回用法帮助文本且不执行任何安装动作。
6. If 子动作的必需参数缺失(如 `install` 无 `<source>`),then the /install 命令 shall 返回该子动作的用法说明并以失败结束。
7. While 命令执行期间,the /install 命令 shall 不向会话消息流注入任何消息(结果只经同步响应返回)。

### Requirement 2: kind 判别与覆盖

**Objective:** 作为 web 会话操作者,我想让系统自动识别包的种类并允许我显式覆盖,以便同一个命令面统一安装 agent 与 plugin。

#### Acceptance Criteria

1. When source 为本地目录且其 `pi-web.json` 清单声明了 kind,the /install 命令 shall 以清单声明的 kind 为准。
2. When source 为 npm 或 git 形态且用户未指定 `--kind`,the /install 命令 shall 缺省按 plugin 处理。
3. When 用户指定 `--kind agent` 或 `--kind plugin`,the /install 命令 shall 以该值覆盖自动判别结果。
4. If `--kind` 取值不是 agent 或 plugin,then the /install 命令 shall 返回用法错误且不执行安装。
5. If 判别结果为 component,then the /install 命令 shall 拒绝安装并在错误信息中指引「组件包请在目标 source 目录用 `pi-web add` 安装」。
6. If 判别结果为 component,then CLI 的 `pi-web install` shall 同样拒绝安装并给出相同指引(当前会误按 plugin 通道安装,属须修复的邻接缺陷)。

### Requirement 3: 安装授权与来源门控

**Objective:** 作为部署运维者,我想让 web 面的安装动作沿用既有的管理员判定与来源白名单,以便新增命令面不扩大攻击面。

#### Acceptance Criteria

1. The /install 命令 shall 与既有 REST 安装端点共享同一份安装门控配置(管理员判定、来源白名单、环境变量放行),不产生第二份独立配置。
2. If 发起者未通过管理员判定,then the /install 命令 shall 拒绝执行并返回可读的授权错误。
3. If 安装来源不在白名单放行范围内(如本地目录来源在缺省配置下),then the /install 命令 shall 拒绝安装并在错误信息中说明对应的环境变量放行途径。
4. The /install 命令 shall 不引入 CLI 面的本地来源缺省放行裁决(CLI 的单用户信任模型不得进入 web 面)。
5. When 安装请求被授权拒绝或来源拒绝,the /install 命令 shall 记录与既有 REST 安装一致的审计事件。

### Requirement 4: 生效语义分道

**Objective:** 作为 web 会话操作者,我想让 plugin 装后立即在当前会话生效、agent 装后出现在 source 选择器里,以便两种包各自以正确的方式变得可用。

#### Acceptance Criteria

1. When plugin 安装、卸载或更新成功,the /install 命令 shall 在结果中提示成功并触发当前会话重载,使能力变更在本会话生效。
2. When agent 安装成功,the /install 命令 shall 不重启当前会话,并在结果中给出安装落点与「在 source 选择器中切换使用」的指引。
3. When agent 安装成功,the source 选择器 shall 无需刷新页面即可见新安装的 agent source。
4. When agent 卸载成功,the source 选择器 shall 在其后的列表读取中不再出现该 source,且当前会话不被重启。

### Requirement 5: 结果呈现与信息安全

**Objective:** 作为 web 会话操作者,我想以结构化卡片看到安装结果与过程步骤,以便判断装到了哪里、失败在哪一步,且不泄露凭据。

#### Acceptance Criteria

1. When 安装、卸载或更新执行完成(无论成败),the /install 命令 shall 以结构化卡片呈现结果(动作、kind、目标位置、过程步骤明细)。
2. The /install 命令的帮助与用法文本 shall 以纯文本消息形态呈现(不使用结构化卡片)。
3. The /install 命令 shall 对结果消息与步骤明细统一脱敏(令牌、Bearer 凭据、URL 内嵌凭据不得出现在任何输出中)。
4. If 安装过程在任一阶段失败,then the /install 命令 shall 在卡片中标明失败阶段与原因,并以失败语义结束(不呈现为部分成功)。

### Requirement 6: 旧 /plugin 摘除与命令补全迁移

**Objective:** 作为 web 会话操作者,我想让命令面板引导我使用 `/install`,旧的 `/plugin` 命令干净退场,以便命令面没有两套安装入口。

#### Acceptance Criteria

1. The 系统 shall 摘除 agent 侧 `/plugin` 扩展命令及其命令放行项,新装配的会话中不再出现 `/plugin`。
2. The 系统 shall 不保留 `/plugin` 的提示型残根命令(发现路径靠 `/install` 的补全引导)。
3. When 用户在输入框键入 `/install ` 前缀,the 命令面板 shall 提供子动作补全(install/uninstall/list/update)。
4. When 用户处于 `/install uninstall` 的参数位,the 命令面板 shall 以已安装包清单作为补全候选。
5. When 用户处于 `/install install` 的参数位,the 命令面板 shall 以可发现的本地源作为补全候选。
6. While 存在尚未重启的旧会话(其中残留旧 `/plugin` 命令),the /install 命令 shall 与之共存且互不影响(名字不同,无仲裁)。

### Requirement 7: 端到端验收与回归护栏

**Objective:** 作为维护者,我想让关键旅程有浏览器端到端验证、既有测试面不回归,以便重构可安全合入。

#### Acceptance Criteria

1. The 系统 shall 通过浏览器端到端验证「`/install install <本地 agent 源>` → 结果卡片呈现 → source 选择器可见新 source」的完整旅程。
2. The 系统 shall 通过浏览器端到端验证「component 包经 `/install` 被拒绝且错误信息含 `pi-web add` 指引」。
3. The 系统 shall 通过浏览器端到端验证 `/install` 的子动作补全与参数位补全。
4. When 本特性全部落地,the 既有 CLI 测试面与既有浏览器端到端测试 shall 保持通过(旧 `/plugin` 相关端到端用例随迁移改写而非删除覆盖面)。
