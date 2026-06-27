# Requirements Document

## Introduction

为命令面板（`PiCommandPalette`）的 `/plugin` 命令补齐**子命令与参数的分阶段自动补全**。当前命令面板只补全命令名（如 `/plugin`），选中 `/plugin` 后即直接执行；用户无法在面板里得到 `install`/`uninstall`/`list` 子命令提示，也无法补全 `uninstall <已装扩展>` 的扩展名或 `install <本地目录>` 的源路径，只能凭记忆手输。

`/plugin` 来自「扩展管理扩展」（`extension-manager.ts`，`pi.registerCommand("plugin", …)`，pi 原生扩展命令，`source==="extension"`），子命令为 `install <npm:|git:|local: 源> [-l]` / `uninstall <名>` / `list`。本功能在命令面板内做**前缀上下文相关**的分阶段补全，不改 `@` 通用补全框架、不改 pi SDK、不改 runner 协议。参数候选数据复用 server 端**现成的** `GET /extensions`（`PiCli.listExtensions()` → 结构化 `InstalledExtension[]`）与一个新增的、按会话 cwd 扫目录的轻量端点；补全候选直接渲染进命令面板既有浮层，自动获得已统一的 caret 锚定与键盘导航。

## Boundary Context

- **In scope**:
  - 命令面板按当前输入分阶段：命令名 → 子命令 → 参数。
  - `/plugin ` 后补子命令 `install` / `uninstall` / `list`（含别名）。
  - `/plugin uninstall ` / `enable ` / `disable ` / `update ` 后补**已安装扩展标识**（复用 `GET /extensions` 的 `InstalledExtension.id`）。
  - `/plugin install ` 后补**会话 cwd 下可作为 source 的本地目录**（返回 `local:<相对路径>`）。
  - 命令参数补全注册表：以命令名声明 argSpec（子命令集 + 每个子命令的参数类型），可扩展到其它命令。
  - 选中语义：选中"有子命令的命令"或"非终态子命令"时只填充输入、进入下一阶段、**不提交执行**；选中参数候选填 `… <值> ` 并就位光标。
  - 复用命令面板既有 caret 锚定、键盘导航（↑↓/Enter/Esc）、捕获让位（`onCaptureChange`/`suppressEnterSubmit`）。
- **Out of scope**:
  - 改动 `@` 通用补全框架（`packages/*/completion/`：extractors/use-completion/provider 注册/协议 DTO）。
  - 改 pi SDK / pi runner 协议 / 新增 runner 代理 RPC。
  - 为 `/plugin` 之外的命令实际声明参数补全（仅保证注册表可扩展）。
  - 安装/卸载本身的执行逻辑（沿用 `extension-manager`/REST 既有实现与门控）。
  - `install` 的 `npm:` / `git:` 远端 source 补全（开放形态、无可靠候选源，仅本地目录补全 + `argumentHint` 提示）。
- **Adjacent expectations**:
  - 依赖 server 端现成 `GET /extensions`（`extensions/routes.ts`、`PiCli.listExtensions()`）返回 `{ extensions: InstalledExtension[] }`。
  - 依赖 `/plugin` 命令经 `extensionCommands` 策略放行、在命令面板可见（extension-install-agent-tools 既有）。
  - 新增的 install-source 端点复用 `CompletionCtx.cwd` 同源的"按会话 cwd 扫目录"能力，受同样的 realpath/越界安全约束。
  - 不改变 `/plugin` 的执行语义与门控（`PI_WEB_EXT_ADMIN_ALLOW_ANY`）。

## Requirements

### Requirement 1: 子命令补全
**Objective:** 作为用户，我希望在 `/plugin ` 后看到可用子命令，以便无需记忆即可选择操作。

#### Acceptance Criteria
1. When 用户输入到 `/plugin ` 且尚未输入子命令, the 命令面板 shall 展示子命令候选 `install` / `uninstall` / `list`。
2. When 用户在 `/plugin ` 后继续输入子命令前缀（如 `/plugin un`）, the 命令面板 shall 按前缀过滤子命令候选。
3. When 用户选中一个**非终态**子命令（`install` / `uninstall`，其后还需参数）, the 命令面板 shall 把输入填为 `/plugin <子命令> ` 并进入参数补全阶段，且**不**提交执行。
4. When 用户选中**终态**子命令（`list`）, the 命令面板 shall 执行该命令（沿用既有 extension 命令执行路径）。
5. The 子命令集 shall 来自前端命令参数补全注册表（按命令名声明），不依赖修改 pi SDK 或 `pi.registerCommand`。

### Requirement 2: 已安装扩展名补全
**Objective:** 作为用户，我希望在 `/plugin uninstall ` 后看到已安装扩展列表，以便准确选中要卸载的扩展。

#### Acceptance Criteria
1. When 用户输入到 `/plugin uninstall `（或 `enable`/`disable`/`update`）, the 命令面板 shall 经 `GET /extensions` 取已安装扩展并以 `InstalledExtension.id` 为候选展示。
2. When 用户在子命令后输入查询串, the 命令面板 shall 按该串过滤已安装扩展候选。
3. When 用户选中一个扩展候选, the 命令面板 shall 把输入填为 `/plugin <子命令> <扩展id> ` 并就位光标于其后。
4. When `GET /extensions` 返回空或失败, the 命令面板 shall 展示空态/收敛（不崩溃、不阻塞输入）。

### Requirement 3: install 本地目录补全
**Objective:** 作为用户，我希望在 `/plugin install ` 后补全本地可安装目录，以便快速引用本地源。

#### Acceptance Criteria
1. The server shall 提供一个按当前会话 cwd 列出"可作为 install source 的本地目录"的只读端点，候选为相对路径。
2. When 用户输入到 `/plugin install `, the 命令面板 shall 经该端点取本地目录候选并以 `local:<相对路径>` 形式可选。
3. When 用户在 `install ` 后输入查询串, the server/命令面板 shall 按该串过滤目录候选。
4. The install-source 端点 shall 受与文件补全相同的 cwd 越界/realpath 安全约束，不泄露 cwd 之外路径。
5. When 候选为空或端点失败, the 命令面板 shall 收敛（不崩溃、允许用户继续手输 `npm:`/`git:` 源）。

### Requirement 4: 分阶段判定与填充语义
**Objective:** 作为用户，我希望补全阶段随输入自然推进、选中行为符合预期，以获得连贯的命令构造体验。

#### Acceptance Criteria
1. The 命令面板 shall 依据当前输入解析所处阶段：命令名 / 子命令 / 参数（按已输入的 token 段与命令的 argSpec 判定）。
2. The 阶段解析 shall 正确跳过标志位（如 `-l`/`--local`）以定位"参数段"。
3. When 处于参数阶段, the 选中填充 shall 只替换"最后一段 token"，保留命令与子命令前缀，并把光标置于插入值之后。
4. While 任一补全阶段有候选且浮层开启, the 命令面板 shall 维持既有 Enter 让位（不误触发提交）与 Esc 关闭语义。

### Requirement 5: 复用既有浮层与不回归
**Objective:** 作为维护者，我希望参数补全复用命令面板既有呈现与交互，且不破坏既有补全/命令/`@` 框架。

#### Acceptance Criteria
1. The 子命令/参数候选 shall 渲染进命令面板既有浮层，复用其 caret 锚定（`useCaretAnchor`）与键盘导航（↑↓/Enter/Esc）。
2. The 本功能 shall 不修改 `@` 通用补全框架、不修改 pi SDK、不新增/修改 runner 协议命令。
3. The 命令面板 shall 维持既有命令名补全、内置/扩展命令合流、`extensionCommands` 策略与让位语义不变。
4. When 命令无 argSpec（注册表未声明）, the 命令面板 shall 退回既有命令名补全行为（选中即按原路径填充/执行），不受本功能影响。
5. The 参数候选取数 shall 经装配层注入的窄接口（provider），命令面板自身不直接持有 HTTP/transport。
