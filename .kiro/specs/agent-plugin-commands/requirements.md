# Requirements Document

## Project Description (Input)

把单一 `/install` host 命令拆分为 `/agent` 与 `/plugin` 两条 host 命令。

- **谁有问题**：pi-web 的 web 面用户（自托管/单用户 dev 场景的管理员）在聊天框里安装 agent 源与 plugin。
- **现状**：只有一条 `/install` 命令（spec `install-host-command`，`lib/app/install-host-command.ts`），子动作为
  `install|uninstall|list|update`，安装对象类别靠 `--kind agent|plugin` 显式覆盖或由 installer 自动判别。
  命令名不表达意图；补全树把 agent/plugin 两条语义不同的路径挤在同一命令下，甚至要靠给候选拼接
  `" --kind agent"` 才能保证走对通道。
- **应当变成**：两条语义明确的命令，各自锁定类别——`/agent <install|uninstall|list>` 只作用于 agent 源，
  `/plugin <install|uninstall|list|update>` 只作用于 plugin。子动作形态保留；`--kind` 与 kind 自动判别一并去除；
  旧 `/install` 干净摘除（不保留别名）。

**已确定的产品决策**（本 spec 的输入前提，非待议项）：
1. 保留子动作形态（`/agent install <source>` 而非 `/agent <source>`）。
2. 旧 `/install` 直接摘除，不做过渡别名。
3. `/plugin install` 的参数补全沿用本地目录扫描端点，与 `/agent install` 同源。
4. 子命令阶段的候选说明改为中文一句话，接入既有 i18n 字典。

## Introduction

本特性把 `/install` 一条多态命令拆成 `/agent` 与 `/plugin` 两条单态命令，使"装什么"由命令名而非参数
决定。安装/卸载/列出/更新的真实逻辑、治理门控（管理员校验、来源白名单、凭据脱敏）与生效分道
（agent → 面板刷新；plugin → 会话重载）全部沿用现状，本次只改**命令面（argv 形态、补全树、结果卡片
归属、文案）**与由此连带的类别锁定。

## Boundary Context

- **In scope**：`/agent` 与 `/plugin` 两条 host 命令的定义、注册与执行；argv 解析（去 `--kind`）；命令面板的
  子命令/参数分阶段补全（provider 的 spec 分道与候选来源分道）；结果卡片的命令归属与说明文案；旧
  `/install` 的摘除；相关单测与 e2e 的迁移。
- **Out of scope**：
  - CLI 侧 `pi-web install` 子命令（`server/cli/`）的形态不变，本 spec 不动；
  - `Installer`/`PluginInstaller` 内部的安装实现、白名单判定、注册表安装路径不变；
  - 不新增在线注册表搜索端点——npm/git/registry 目标仍只能手输，补全不覆盖；
  - REST `/extensions` 系列端点的形态与治理不变。
- **Adjacent expectations**：
  - 命令面板"有 argSpec 的命令不得裸执行"这一行为已作为独立热修落地（`pi-command-palette` 的
    `select()` 中 argSpec 分支先于 builtin 分支）。本 spec **继承**该行为，两条新命令都必须落在其保护之下，
    但不重复实现它。
  - 候选数据只有三个现成来源：`GET /sessions/:id/install-sources`（扫会话 cwd 出 `local:` 候选）、
    `GET /extensions`（已装 plugin）、`GET /agent-sources`（已装 agent 源）。其中后两者已各有可替换端口
    （`AgentSourceProvider`、`PiCli`），本 spec 只消费、不改其接口；第一条无抽象，见 Requirement 8。
  - 宿主状态端口 `Workspace` 只承载 JSON 文档状态（契约 §3 与 `workspace/types.ts` 的边界宣言），
    **不**承载来源枚举与包列举。本 spec 不扩展 `Workspace` 契约。

## Requirements

### Requirement 1: `/agent` 命令 —— agent 域的装/卸/列

**Objective:** As a pi-web 管理员, I want 一条只作用于 agent 源的 `/agent` 命令, so that 我无需再用 `--kind`
或依赖隐式判别就能确定操作对象。

#### Acceptance Criteria

1. The pi-web host 命令层 shall 提供名为 `agent` 的 host 命令，其子动作为 `install`、`uninstall`、`list`。
2. When 用户提交 `/agent install <source>`, the host 命令层 shall 以 agent 类别执行安装，并且不接受任何
   类别覆盖参数。
3. When 用户提交 `/agent uninstall <id>`, the host 命令层 shall 以 agent 类别执行卸载。
4. When 用户提交 `/agent list`, the host 命令层 shall 返回已安装的 agent 源清单。
5. If 用户在 `/agent` 的任一子动作上传入 `--kind`, then the host 命令层 shall 拒绝执行并返回说明该选项已
   移除的用法文本。
6. If 用户提交裸 `/agent` 或未知子动作, then the host 命令层 shall 返回 `/agent` 专属用法文本且不产生任何
   安装副作用。
7. When `/agent install` 或 `/agent uninstall` 成功, the host 命令层 shall 产出面板刷新效果与"在 source 选择器
   中切换即可使用、无需重启会话"的指引，且不重载当前会话。

### Requirement 2: `/plugin` 命令 —— plugin 域的装/卸/列/更新

**Objective:** As a pi-web 管理员, I want 一条只作用于 plugin 的 `/plugin` 命令, so that plugin 的安装与更新
路径与 agent 源彻底分开。

#### Acceptance Criteria

1. The pi-web host 命令层 shall 提供名为 `plugin` 的 host 命令，其子动作为 `install`、`uninstall`、`list`、`update`。
2. When 用户提交 `/plugin install <source>` 或 `/plugin uninstall <id>`, the host 命令层 shall 以 plugin 类别执行
   对应操作，并且不接受任何类别覆盖参数。
3. When 用户提交 `/plugin list`, the host 命令层 shall 返回已安装 plugin 清单；Where 底层不支持 `--outdated`,
   the host 命令层 shall 如实转达该限制而非静默忽略。
4. When 用户提交 `/plugin update [id]`, the host 命令层 shall 执行 plugin 更新，并在全部成功时重载当前会话。
5. When `/plugin` 的 install/uninstall/update 成功, the host 命令层 shall 在返回前恰重载一次当前会话，并给出
   "当前会话已重新加载，变更已生效"的指引。
6. If 用户提交裸 `/plugin` 或未知子动作, then the host 命令层 shall 返回 `/plugin` 专属用法文本且不产生任何
   安装副作用。

### Requirement 3: 旧 `/install` 摘除

**Objective:** As a pi-web 维护者, I want `/install` 连同 kind 自动判别一起消失, so that 不留下两套等价入口
与需要长期同步的重复文案。

#### Acceptance Criteria

1. The pi-web 命令面 shall 不再注册名为 `install` 的 host 命令。
2. When 用户在命令面板中查看可用命令, the 命令面板 shall 列出 `/agent` 与 `/plugin` 且不列出 `/install`。
3. The pi-web 命令面 shall 不为 `/install` 保留别名、兼容跳转或迁移提示词条。
4. The pi-web 代码库 shall 不残留仅服务于 `/install` 的 kind 判别分支、`--kind` 解析与其专属文案。

### Requirement 4: 命令面板的分道补全

**Objective:** As a pi-web 用户, I want 两条命令各自给出对路的候选, so that 我不必人工分辨某个候选属于
agent 还是 plugin，也不必手工补类别参数。

#### Acceptance Criteria

1. When 用户输入 `/agent ` 或 `/plugin `, the 命令面板 shall 展示该命令自身的子动作候选，且两者的候选集
   互不混入。
2. When 用户停在 `/agent install` 或 `/plugin install` 的参数位, the 命令面板 shall 展示按会话 cwd 扫描得到的
   本地来源候选。
3. When 用户停在 `/agent uninstall` 的参数位, the 命令面板 shall 只展示已安装的 agent 源候选，且候选插入
   文本 shall 只含标识本身、不含任何类别参数后缀。
4. When 用户停在 `/plugin uninstall` 或 `/plugin update` 的参数位, the 命令面板 shall 只展示已安装的 plugin
   候选。
5. When 用户停在 `/agent list` 或 `/plugin list`, the 命令面板 shall 按终态子动作处理（不索取参数、关闭浮层
   以便回车执行）。
6. When 命令面板展示子动作候选, the 命令面板 shall 为每个子动作显示一句中文说明，取自既有 i18n 字典
   而非硬编码占位符。
7. If 候选取数失败或返回空, then the 命令面板 shall 降级为不展示候选并允许用户自由输入，不得阻断提交。

### Requirement 5: 结果呈现与文案

**Objective:** As a pi-web 用户, I want 两条命令的执行结果卡片仍然可读且归属清晰, so that 拆分不降低现有
反馈质量。

#### Acceptance Criteria

1. When `/agent` 或 `/plugin` 执行完成且结果带结构化数据, the 聊天视图 shall 追加一张结果卡片，其呈现的
   字段（成功/失败、落点、指引、步骤、列表）与拆分前保持一致。
2. When 执行结果只含消息文本（如用法文本）, the 聊天视图 shall 以纯文本追加而不产出卡片。
3. The 结果卡片 shall 在拆分后仍能标明本次操作的类别与子动作。
4. The pi-web i18n 字典 shall 同时提供中英两套新增/变更文案，不得只补一侧。

### Requirement 6: 治理与安全不回归

**Objective:** As a pi-web 运维者, I want 拆分不削弱既有治理, so that 命令面依然不是绕过白名单与鉴权的
后门。

#### Acceptance Criteria

1. While 管理员校验未通过, when 用户提交 `/agent` 或 `/plugin` 的任一执行类子动作, the host 命令层 shall
   拒绝执行、返回放行指引，并记录一条被拒审计事件。
2. If 来源被白名单拒绝, then the host 命令层 shall 返回带对应放行途径说明的失败结果，并记录被拒审计事件。
3. The host 命令层 shall 对一切输出面（结果卡片字段、审计事件、错误消息）使用脱敏副本，即使用户输入
   本身内嵌凭据。
4. When 执行 `/agent install`, the host 命令层 shall 以当前会话的工作目录作为本地来源解析基准，与参数补全
   的扫描基准一致。

### Requirement 7: 验证与迁移

**Objective:** As a pi-web 维护者, I want 现有针对 `/install` 的测试资产被迁移而非丢弃, so that 拆分后的行为
仍有等强度的回归保护。

#### Acceptance Criteria

1. The pi-web 测试套件 shall 覆盖 `/agent` 与 `/plugin` 各自的 argv 解析、类别锁定、成功/失败结果与生效分道。
2. The pi-web 测试套件 shall 覆盖两条命令各自的补全分道（子动作候选、参数候选来源、agent 候选不再拼接
   类别后缀）。
3. The pi-web 测试套件 shall 包含一条断言 `/install` 已不存在于可用命令列表的回归用例。
4. The pi-web e2e 套件 shall 以 `/agent` 与 `/plugin` 覆盖原 `/install` e2e 用例所验证的端到端路径。

### Requirement 8: 可安装来源枚举的端口化

**Objective:** As a pi-web 维护者, I want `install` 参数补全的来源枚举有一个可替换端口, so that 非本地形态
（云端 / 沙箱）能换上自己的实现，而不必绕过或重写整条补全链路。

#### Acceptance Criteria

1. The pi-web 服务端 shall 提供一个只读、无副作用的可安装来源枚举端口，其形态与既有 `AgentSourceProvider`
   同族（一个 `list` 方法，按查询前缀返回候选记录）。
2. The 现有按会话工作目录浅层扫描的实现 shall 成为该端口的本地实现，其可见行为（标志文件判定、深度与
   条数上限、噪声目录跳过、符号链接越界防护、`local:` 插入文本）保持不变。
3. When 装配层未注入自定义实现, the pi-web 服务端 shall 默认使用该本地实现，使既有部署行为零变化。
4. The `GET /sessions/:id/install-sources` 端点 shall 只经该端口取数，不再直接触碰文件系统。
5. If 注入的实现抛错或超时, then the 端点 shall 降级为返回空候选而非失败，与命令面板的空候选降级一致。
6. The pi-web 服务端 shall 不为此新增对 `Workspace` 契约的扩展。
