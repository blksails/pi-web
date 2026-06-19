# Requirements Document

## Introduction
为 pi-web 设置中心提供 schema 驱动的「沙箱」与「扩展」配置能力,覆盖**全局**(`~/.pi/agent/*.json`)与
**项目**(`<cwd>/.pi/*.json`)两个作用域,并在设置页以「一个菜单项 + 全局/项目 Tab」的分组布局呈现。
同时保证沙箱 enforcement **不依赖** pi 的默认扩展发现(强制注入),以及每个 agent 进程在文件可见性上
彼此隔离(只读得到自己项目的配置)。

本特性大部分已实现(沙箱配置域、强制注入、可见性隔离、Tab 布局);剩余为「扩展」配置域(Slash 命令
可用性限制 + per-扩展 KV 参数)与整体 e2e 测试。

## Boundary Context
- **In scope**:
  - 沙箱配置的读写(全局 + 项目),经 schema 表单。
  - 沙箱扩展在 cli / custom 两种 spawn 模式的强制注入。
  - 设置页同类配置的 Tab 分组(全局/项目)。
  - 扩展配置域:Slash 命令前端可用性 allow/deny 限制 + per-扩展 KV 参数,全局 + 项目作用域。
  - node e2e(配置端点往返、强制注入映射、沙箱拦截语义)与 browser e2e(设置页 Tab 切换 + 表单保存)。
- **Out of scope**:
  - 扩展的安装/卸载(归既有 `extension-management`:`POST/DELETE /extensions`)。
  - 沙箱策略的运行时交互式授权弹窗(headless 下为硬拦截或经既有 ui-response 机制)。
  - 前端 chat 实际消费「Slash 命令可用性」「前端工具开关」的渲染过滤(本特性只负责**写**该设置)。
- **Adjacent expectations**:
  - 依赖既有 `schema-config-ui`(`zodToFormSchema`/`FormSchema`/`SchemaForm`/`field-registry`/
    `GET·PUT /config/:domain`/`SettingsShell`/`settings-registry`)。
  - 依赖 pi-sandbox(`pi install npm:pi-sandbox`,user-scope)作为沙箱 enforcement 引擎;
    其配置文件为 `<agentDir>/sandbox.json`(全局)+ `<cwd>/.pi/sandbox.json`(项目),深合并、项目优先。
  - 依赖 pi SDK(`@earendil-works/pi-coding-agent`)的扩展加载器(`-e` flag、`additionalExtensionPaths`、
    `extensionsOverride` 白名单语义)。

## Requirements

### Requirement 1: 沙箱全局配置(方案 A)
**Objective:** 作为运维者,我想在设置页编辑全局沙箱策略,以便对所有 agent 统一施加文件/网络限制。

#### Acceptance Criteria
1. When 客户端 GET `/config/sandbox`,the 配置服务 shall 返回 `domain` 为 `sandbox` 的 `formSchema` 与 `<agentDir>/sandbox.json` 的当前值。
2. When 客户端 PUT `/config/sandbox` 且值通过 `sandboxConfigSchema` 校验,the 配置服务 shall 将值写入 `<agentDir>/sandbox.json`。
3. If PUT 的值未通过 `sandboxConfigSchema` 校验,the 配置服务 shall 返回 422 且不写盘。
4. The 沙箱配置 schema shall 暴露 `enabled`、`network.{allowedDomains,deniedDomains}`、`filesystem.{allowRead,allowWrite,denyRead,denyWrite}` 字段,且全部可选以支持稀疏/空配置。

### Requirement 2: 沙箱项目配置(方案 B)
**Objective:** 作为开发者,我想为某个项目单独覆盖沙箱策略,以便该项目的 agent 得到更宽/更严的限制。

#### Acceptance Criteria
1. When 客户端 GET `/config/sandbox/project`(可带 `?cwd=`),the 配置服务 shall 返回该项目 `<cwd>/.pi/sandbox.json` 的值、绝对路径与 `exists` 标记;`cwd` 缺省时取所服务项目根。
2. When 客户端 PUT `/config/sandbox/project` 且值合法,the 配置服务 shall 将值写入 `<cwd>/.pi/sandbox.json`(必要时创建 `.pi/` 目录)。
3. If 请求的 `cwd` 不是绝对路径或落在允许根(默认 `[defaultCwd]`)之外,the 配置服务 shall 返回 403 且不读写。
4. If PUT 的值未通过校验,the 配置服务 shall 返回 422 且不写盘。
5. The 项目沙箱路由 shall 与通用 `/config/:domain` 路由不冲突(路径段数不同)。

### Requirement 3: 沙箱扩展强制注入
**Objective:** 作为运维者,我想让沙箱 enforcement 不依赖 pi 默认扩展发现,以便即使注册表/白名单变化也始终生效。

#### Acceptance Criteria
1. While 沙箱入口可解析(env `PI_WEB_SANDBOX_ENTRY` 或 `<agentDir>/npm/node_modules/pi-sandbox/index.ts` 存在),when 以 cli 模式创建会话通道,the 主进程 shall 在 spawn 参数追加 `-e <entry>`。
2. While 沙箱入口可解析,when 以 custom 模式创建会话通道,the 主进程 shall 经 env `PI_WEB_SANDBOX_ENTRY` 下传,且 runner shall 将该入口追加到 `additionalExtensionPaths`。
3. Where agent 定义设置了 `allowExtensions` 白名单,the runner shall 在 `extensionsOverride` 中豁免被强制注入扩展的 basename,使其不被白名单过滤。
4. If 沙箱入口无法解析,the 主进程 shall 跳过注入且不报错(回退到默认发现)。
5. The 强制注入 shall 不影响 stub(离线)模式的会话装配。

### Requirement 4: 可见性隔离
**Objective:** 作为多项目使用者,我想让每个 agent 只能读到自己项目的沙箱配置,以便彼此不可见。

#### Acceptance Criteria
1. While 全局沙箱策略采用严格默认(`allowRead` 仅含 `"."`),when agent 经 read 工具读取自己项目目录内的文件,the 沙箱 shall 放行。
2. While 采用严格默认,if agent 经 read 工具读取项目目录之外的路径(含 `~/.pi/agent/sandbox.json` 与其它项目的 `.pi/sandbox.json`),the 沙箱 shall 拦截或转交权限提示(不静默放行)。
3. The 沙箱扩展自身 shall 仍能读取全局与项目配置文件以执行策略(该读取不经 read 工具、不受拦截)。
4. Where 某项目把 `allowRead` 放宽到项目目录之外,the 文档 shall 说明该保证随之失效(本要求不强制阻止该配置)。

### Requirement 5: 设置页 Tab 分组布局
**Objective:** 作为使用者,我想把「同类、不同作用域」的配置合并为一个菜单项并用 Tab 切换,以便导航更清晰。

#### Acceptance Criteria
1. Where 多个设置面板声明了相同的 `group`,the 设置外壳 shall 在左侧仅渲染一个菜单项(标题取 `groupTitle`)。
2. While 某分组含多于一个面板,when 该分组被选中,the 设置外壳 shall 渲染 Tab 切换器(标签取各面板 `tabLabel`,按 `tabOrder` 排序)。
3. When 用户切换 Tab,the 设置外壳 shall 加载并渲染对应面板的表单。
4. Where 某面板未声明 `group`,the 设置外壳 shall 保持其为独立菜单项(向后兼容)。

### Requirement 6: 扩展配置域 — Slash 命令可用性(固定区)
**Objective:** 作为运维者,我想限制前端可见的 slash 命令,以便收敛工具暴露面。

#### Acceptance Criteria
1. The 扩展配置 schema shall 暴露 `commands.allow` 与 `commands.deny` 两个命令名列表字段(均可选)。
2. When 客户端 GET 扩展配置(全局或项目),the 配置服务 shall 从对应 `settings.json` 的 `commands` 对象返回该值。
3. When 客户端 PUT 扩展配置且合法,the 配置服务 shall 将 `commands` 写回对应 `settings.json` 的 `commands` 键,且保留 `settings.json` 中其它键不丢失。
4. If PUT 的值未通过 `extensionsConfigSchema` 校验,the 配置服务 shall 返回 422 且不写盘。

### Requirement 7: 扩展配置域 — per-扩展 KV 参数(KV 区)
**Objective:** 作为运维者,我想编辑每个扩展自己的键值参数(如代理),以便向扩展传参。

#### Acceptance Criteria
1. The 扩展配置 schema shall 暴露 `extensions` 字段,其形状为「扩展 id → 字符串键值表」,并以自定义控件 `extensionsKv` 渲染。
2. When 客户端 GET 扩展配置,the 配置服务 shall 把对应 `settings.json` **顶层**的 per-扩展 KV 块(非保留键的对象值)收敛进 `extensions` 字段返回。
3. When 客户端 PUT 含 `extensions` 的扩展配置,the 配置服务 shall 把每个 `extensions[<extId>]` 写回 `settings.json` 的**顶层** `<extId>` 键,使 pi 能据此向扩展传参。
4. When 写回时,the 配置服务 shall 保留 `settings.json` 中保留键(如 `packages`、`defaultProvider`、`defaultModel`、`theme`、`lastChangelogVersion`、`commands`)与未在表单中出现的扩展键不被破坏。
5. The `extensionsKv` 控件 shall 支持在「扩展条目」与「键值对」两个层级增删。
6. The 扩展配置 shall 同时支持全局(`~/.pi/agent/settings.json`)与项目(`<cwd>/.pi/settings.json`)两个作用域,并以一个「扩展」菜单 + 全局/项目 Tab 呈现。

### Requirement 8: 端到端测试覆盖
**Objective:** 作为维护者,我想用 e2e 锁定关键链路,以便回归可被自动捕获。

#### Acceptance Criteria
1. The node e2e shall 验证沙箱全局/项目配置端点的读写往返与校验(含 422、403)。
2. The node e2e shall 验证扩展配置端点的 `commands` 与 per-扩展 KV 与 `settings.json` 结构互映(含保留键不丢)。
3. The node e2e shall 验证强制注入的 option-mapper 行为(置前追加、noExtensions 仍在、白名单豁免)。
4. The browser e2e shall 验证设置页「沙箱」「扩展」分组的 Tab 切换与表单保存往返。
5. While e2e 运行,the 测试 shall 使用隔离构建/临时目录,不污染共享 `.next` 与用户级 `~/.pi/agent`。
