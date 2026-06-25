# Requirements Document

## Project Description (Input)

为 pi-web harness 新增「内置斜杠命令层」，首个成员是 `/plugin` 命令，用于安装/管理 plugin。

### 背景与定位
对标 Claude Code 的 `/plugin`。pi-web 当前所有斜杠命令都来自 pi agent（`RpcSlashCommand`，source = extension | skill | prompt），选中后一律「填入输入框当 prompt 发给 LLM」。本特性引入 harness 级的「内置命令」，与 agent 命令并列合流到前端 `PiCommandPalette`，但执行 harness 逻辑、不进 LLM。

### 核心概念划界
- **plugin = 分发单元**（可装/卸/有版本，来源 npm·git·local 的包），**以 extension 为主体内容物**，可再含 skill / prompt / theme / web-ext bundle。即 **plugin 包含 extension**。
- **extension = 运行时能力**（5 层 web 扩展）语义不变。
- 二分关系照搬 Claude Code 的 plugin（package）vs skill（capability）。

### 核心抽象：BuiltinCommandSpec（放 packages/tool-kit）
复刻 `ToolSpec` 的「纯声明 + runtime handler」双层。声明含 `name / description / argumentHint / aliases`、`target`（`client` | `server-action` | `ui-surface{slot}`）、`subcommands`。声明放 `tool-kit/index.ts` 纯数据导出（像 `AIGC_TOOLS`），client / server 各按 name 绑定 handler。

### /plugin 命令形态
- `/plugin`（无参）→ target = ui-surface，开浏览/管理面板（Installed / Errors；Discover 留 Phase 2）
- `/plugin install <source>` → server-action，user-only，来源信任门，装后触发 runner reload
- `/plugin uninstall <name>` → server-action，user-only
- `/plugin list [--enabled]`、`/plugin enable|disable <name>`、`/plugin update [name]`
- 底层包 pi 的 `DefaultPackageManager`（install / remove / update / resolve / list），写 `~/.pi/agent/settings.json`
- scope 默认 project，`--user` 显式
- source 自描述：resolver 读 manifest 推断 kind，用户不用区分 pi / pi-web 目标

### 执行分派（核心改动）
`PiCommandPalette` 选中命令后按 source 分派：source = builtin 的不再填输入框发模型，而是按 target 走：
- `client` → 本地 handler
- `server-action` → 新增 `POST /sessions/:id/commands/execute` 端点 → server handler
- `ui-surface` → 开 slot 表面（复用 5 层扩展 slot / artifact）

source = extension | skill | prompt 走现状 prompt 注入路径，**不变**。

### 协议改动（向后兼容）
- packages/protocol `RpcSlashCommand.source` 枚举增加 `"builtin"`
- `GET /sessions/:id/commands` 合流：内置命令 prepend 到 agent 命令前；同名冲突内置优先
- `RpcSlashCommand` 结构不变
- **不新建通用 `POST /commands/execute` 端点**（Phase 1）：`/plugin` 的 server-action 直接复用 `extension-management` 已实现的端点（见下）。通用 execute 端点列为后续可选。

### 路线决策：X（服务端执行 + 复用 extension-management）
经代码核实，已在 `X（harness 内置命令层，服务端执行）` 与 `Y（独立命令，ui-rpc + pi 原生 DefaultPackageManager）` 之间选定 **X**。理由：保留 pi-web 自有的安装治理（白名单 / 信任门 / 管理员门控 / 审计），且 `/plugin` 永远可用（不依赖某个默认扩展加载）。代价：需要 pi-web 核心改动（source 枚举 / 合流 / palette 分派 / 面板）。

### 复用 extension-management（关键：重活已实现，只差接线）
`extension-management` spec 状态 `implemented`，tasks 全 `[x]`，已具备可直接复用的真实代码：
- 子进程跑 `pi install/remove/list`（`--ignore-scripts`、非交互 env、超时、凭据脱敏）— `packages/server/src/extensions/cli/pi-cli.ts`
- 来源白名单 `install/source-allowlist.ts`、信任落地 `install/trust-landing.ts`、管理员门控 `security/admin-policy.ts`、审计+脱敏 `security/audit.ts`
- 4 个 HTTP 端点 handler：`GET /extensions`、`POST /extensions`、`DELETE /extensions/:extId`、`POST /sessions/:id/reload` — `extensions/routes/*.ts`，工厂 `createExtensionRoutes()`（`extensions/routes.ts`）

`/plugin` 的 server-action 直接打这 4 个端点（install→POST /extensions，uninstall→DELETE，list→GET，装后→POST /sessions/:id/reload），**不重写安装治理**。

**两个必须补的接线缺口（本 spec 的真实工作量）：**
1. `lib/app/pi-handler.ts` 的 `routes:[...]` 数组**未调用 `createExtensionRoutes()`** → 4 端点当前不可达，需挂载。
2. `extensions/routes/reload-session.ts` 的 `SessionReloader` 默认实现直接 reject，宿主未注入真正 runner 重启逻辑，需实现（见下硬约束 2）。

### 必须钉为显式约束的非功能需求
1. **信任门**：`/plugin install` 会把任意 npm / git 代码拉进 runner 子进程执行，必须有来源确认 / 信任模型，不可零摩擦。
2. **runner 热重载**（本 spec 唯一没有现成实现的硬骨头）：装 / 卸后正在跑的 runner 子进程看不到变化。复用 `extension-management` 的 `POST /sessions/:id/reload` + `SessionReloader` 接缝，但其默认实现直接 reject——必须在宿主注入真正的重启逻辑（接 `SessionManager` 重建 / `PiRpcProcess.requestRestart`）。**实施前先实测确认 `requestRestart` / `PI_RUNNER_HOT_RELOAD` 能力是否存在**（调查 agent 在 extensions 范围内未搜到，但记忆中存在于 `hot-reload.ts`，可能是不同机制，需核实其能否驱动会话级 reload）。
3. **绝不可 model-invocable**：install / uninstall / enable / disable 等价 `disable-model-invocation = true`，模型不能自己装包。
4. **改协议域 / 注入路由后 dev 需重启**（handler 单例 pin 在 globalThis，dev 端口 3010）。
5. **e2e 在 `NEXT_DIST_DIR=.next-e2e` external server 模式验证**，A/B 验 builtin vs agent 两条分派路径。

### 范围与分波
- **Phase 1（本 spec）**：内置命令层 + `/plugin` 对 **pi 资源（extension/skill/prompt/theme）** 的安装 / 卸载 / 管理闭环 + 执行分派 + runner reload。
- **不在本 spec（另立）**：**webext（5 层 web 扩展）扩展包的安装/动态加载** —— 见独立 spec `webext-package-install`。webext 代码在浏览器同源执行、需 import map + 签名白名单 gate，与 pi 资源安装机制（node runner + pi DefaultPackageManager）不同，单独成 spec。
- **Phase 2（不在本 spec）**：marketplace（来源目录 + Discover 推荐）—— **明确排除**。

### 与 webext-package-install 的接缝
一个包可能同时含 pi 资源 + webext 产物（`.pi/web/dist/`）。`/plugin install` 负责落盘（复用 pi install）与 pi 资源 reload；webext 产物的**浏览器侧动态加载**由 `webext-package-install` 负责。两 spec 的接缝：`/plugin` 的「装后生效反馈」需覆盖双路（runner reload + webext load），具体 webext 加载实现归 `webext-package-install`，本 spec 仅在 UI 反馈上预留挂点，不实现 webext 加载。

### 涉及包
- `packages/tool-kit`：声明层 + 默认集
- `packages/protocol`：合流 + execute 端点 DTO + source 枚举
- `packages/server`：execute 端点 + server handler + `DefaultPackageManager` 接线 + runner reload
- `packages/react`：`executeCommand` transport + client handler 注册表
- `packages/ui`：`pi-command-palette` 分派 + 徽标 + `/plugin` 面板

### 已存在的相关 spec（requirements 阶段需对齐复用）
- `extension-management`：扩展安装 / 管理机制，可能是本特性 `/plugin install|uninstall` 的底座。
- `slash-command-palette`：命令面板本体，本特性在其上增加 builtin 分派维度。

## Requirements

### Requirement 1: 内置命令层与合流

**Objective:** 作为 pi-web 用户，我希望 harness 自带的内置命令与 agent 注册的命令一并出现在斜杠命令面板里，这样我能用统一入口发现并使用 `/plugin` 等内置命令。

#### Acceptance Criteria
1. When 前端请求会话命令列表，the 命令服务 shall 返回内置命令与 agent 命令的合流结果，内置命令前置。
2. The 命令服务 shall 以 `builtin` 标识内置命令来源，与 agent 命令的来源区分。
3. If 内置命令与 agent 命令同名，the 命令服务 shall 以内置命令优先。
4. The 命令面板 shall 对内置命令呈现可区分的视觉标识。
5. The 命令服务 shall 保持既有命令数据结构向后兼容，使旧前端仍能正常展示命令。

### Requirement 2: 执行分派（内置命令不进 LLM）

**Objective:** 作为用户，我希望内置命令执行 harness 逻辑而非被当作提示发给模型，这样 `/plugin`、`/clear` 等命令有确定性行为。

#### Acceptance Criteria
1. When 用户在面板选中一个内置命令，the 命令面板 shall 按其执行落点分派（客户端执行 / 服务端动作 / 打开 UI 表面），不把该命令作为提示发送给模型。
2. When 用户选中一个 agent 命令，the 命令面板 shall 维持既有「填入输入框作为提示」的行为不变。
3. The 内置命令 shall 不以任何路径进入模型消息流。
4. If 某内置命令的执行失败，the 命令面板 shall 向用户呈现失败反馈与原因。

### Requirement 3: `/plugin` 命令形态

**Objective:** 作为用户，我希望用 `/plugin` 及其子命令安装与管理 plugin，这样我能在对话界面内完成扩展的获取与启停。

#### Acceptance Criteria
1. When 用户执行无参 `/plugin`，the 系统 shall 打开 plugin 浏览/管理面板（呈现已安装项与错误项）。
2. When 用户执行 `/plugin install <source>`，the 系统 shall 以 `<source>` 安装 plugin。
3. When 用户执行 `/plugin uninstall <name>`，the 系统 shall 卸载该 plugin。
4. Where 用户执行 `/plugin list`、`/plugin enable`、`/plugin disable`、`/plugin update`，the 系统 shall 执行对应的列出/启用/禁用/更新动作。
5. The `/plugin` 命令 shall 提供子命令与参数的补全提示。
6. The 安装 shall 默认作用于项目作用域，并允许显式指定用户作用域。

### Requirement 4: 复用既有安装机制

**Objective:** 作为维护者，我希望 `/plugin` 的安装/卸载复用既有的扩展安装机制，这样不重复实现安装治理。

#### Acceptance Criteria
1. The 系统 shall 经既有扩展安装能力执行 plugin 的安装、卸载与列出，不重建安装器。
2. The 系统 shall 由来源自身的清单推断其类型，使用户无需手工区分被安装对象的种类。
3. While 安装来自 npm、git 或本地路径的来源，the 系统 shall 一致地完成落盘与记录。

### Requirement 5: 安装信任门

**Objective:** 作为运营者，我希望安装会执行代码的 plugin 必须经过来源/信任校验，这样 `/plugin install` 不是零摩擦地拉取并执行任意代码。

#### Acceptance Criteria
1. When 用户发起 `/plugin install`，the 系统 shall 先经来源信任校验通过后方可安装。
2. If 来源未通过信任校验，the 系统 shall 拒绝安装并呈现原因。
3. Where 部署为多用户/托管形态，the 系统 shall 仅允许经授权的管理员执行安装/卸载，并记录审计。
4. The 安装 shall 默认禁用被装包的生命周期脚本，降低安装期代码执行风险。

### Requirement 6: 安装后 runner 生效

**Objective:** 作为用户，我希望装/卸 plugin 后正在进行的会话能看到变化，这样不会出现「装了但没生效」的困惑。

#### Acceptance Criteria
1. When 一个 plugin 安装或卸载完成，the 系统 shall 触发当前会话的资源重载，使新增/移除的能力对运行中的会话生效。
2. If 资源重载未配置或失败，the 系统 shall 向用户呈现明确反馈，而非静默无变化。
3. While 包内含 webext 产物，the 系统 shall 触发 webext 加载生效路径（实现归 `webext-package-install`），与资源重载共同构成双路生效。

### Requirement 7: 内置命令绝不可模型触发

**Objective:** 作为运营者，我希望模型不能自行调用安装/卸载等内置命令，这样模型无法擅自变更系统状态。

#### Acceptance Criteria
1. The 安装/卸载/启用/禁用 内置命令 shall 仅可由用户触发，模型不可调用。
2. The 系统 shall 不向模型暴露这些内置命令为可调用工具。

### Requirement 8: plugin 管理面板

**Objective:** 作为用户，我希望有一个面板浏览已安装 plugin 与其错误，这样我能集中管理而不必逐条命令操作。

#### Acceptance Criteria
1. When plugin 面板打开，the 面板 shall 列出已安装 plugin 及其作用域。
2. Where 存在加载/安装错误的 plugin，the 面板 shall 呈现错误项与原因。
3. When 用户在面板执行启用/禁用/卸载，the 系统 shall 执行对应动作并刷新面板。

### Requirement 9: 失败回退与可观测

**Objective:** 作为运营者，我希望命令执行与安装的失败可诊断、不破坏会话，这样问题可追查且界面保持可用。

#### Acceptance Criteria
1. If 内置命令执行或安装失败，the 系统 shall 记录含命令/来源/阶段/原因的可诊断信息。
2. When 任一内置命令失败，the 系统 shall 使会话与其余命令保持可用。
3. The 系统 shall 在记录中对凭据等敏感信息脱敏。

### 范围边界
- **不含**：marketplace / 来源目录 / Discover 推荐（Phase 2）。
- **不含**：webext 浏览器侧加载实现（属 `webext-package-install`；本 spec 仅触发其生效路径）。
- **复用**：`extension-management` 的安装治理与端点；`slash-command-palette` 的面板。
