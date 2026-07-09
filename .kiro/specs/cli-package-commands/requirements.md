# Requirements Document

## Project Description (Input)

为 pi-web 全局 CLI（`bin/pi-web.mjs`，现为无子命令的薄启动器）新增**子命令分发层**与一组包管理子命令：`create` / `install` / `uninstall` / `list` / `update` / `publish`。

### 谁有问题

- **agent / plugin 作者**：没有骨架生成器，新建包要手抄 example；写完之后**无法发布**——pi-web 与 pi SDK 均无 publish 能力。
- **pi-web 使用者**：安装 plugin 只能经 Web UI 的 `/plugin install` 内置斜杠命令，命令行里没有对应入口；而 CLI 恰恰是安装场景最自然的位置。

### 现状（已查实）

- `bin/pi-web.mjs` 用 `parseArgs({ allowPositionals: true })`，第一个位置参数直接当 `source`，**没有子命令概念**，全部职责是把选项翻译成 env 再 spawn `dist/server.mjs`。纯函数 `parseCliArgs` / `buildEnv` 已有单测（`test/cli/cli-args.test.ts`）。
- 安装链路**已完整**，只是出口只有 Web UI：`/plugin install <source>`（spec `builtin-plugin-command`，18/18）→ `POST /extensions`（`packages/server/src/extensions/routes.ts:66`）→ `PiCli` 适配点。既有实现是 **shell out `pi install`**（`ChildProcessPiCli`，`extensions/cli/pi-cli.ts`），带来源白名单（`checkAllowlist`，纯函数）、版本固定、`--ignore-scripts`、`--no-approve`，`adminPolicy` 默认拒绝。
- pi SDK 0.80.3 导出 `DefaultPackageManager`（`install / removeAndPersist / update / listConfiguredPackages / checkForAvailableUpdates`），**但没有 publish**。全仓 grep `publish` 只命中各包 `package.json` 的 `publishConfig`。
- 统一包清单已于本轮实现落地：`pi-web.json`（原 `pi-plugin.json`）+ `kind: "agent" | "plugin"` 判别式（`packages/protocol/src/plugin/plugin-manifest.ts`）。
- agent source 默认扫描根已于本轮实现落地：`~/.pi-web/agents`（`lib/app/pi-handler.ts`），已真实端点验证（空根→0 源、植入→1 源）。

### 应该变成什么

一条闭环：`create` → 开发 → `publish` → `install`，由 `kind` 字段贯穿。

- **`create <name> [--kind agent|plugin] [--template <name>] [--list]`**：从随包分发的 `dist/examples` 拷贝骨架（29 个候选模板，零 `workspace:` 依赖）。按 `kind` 写出 `pi-web.json`，补齐 `pi-package` keyword。
- **`install` / `uninstall` / `list` / `update`**：复用既有来源白名单与 `pi` 子进程装配。`kind` 决定落盘目标：`agent` → `~/.pi-web/agents/<name>`；`plugin` → 交 pi 的包管理落 `~/.pi/agent/`（user）或 `.pi/`（project）。
- **`publish [--dry-run]`**：把手写的 `pi-web.json` **编译**为 pi-clouds registry 权威定义的 `pi-web.manifest.json`（展开 glob、逐文件算 sha384、Ed25519 签名），投影 `pi` 字段与 `pi-package` keyword 进 `package.json`，校验 pi 的打包硬约束，再经 registry 客户端发布。

### 关键结构约束

`bin/pi-web.mjs` 是纯 `.mjs` 薄壳，只 import `node:` 内置。要复用 server / protocol 的 TS 校验逻辑，须给 `scripts/build-server.mjs`（现单入口）**增加第二个 esbuild 产物** `dist/cli-commands.mjs`，由 CLI 动态 `import()`。该产物**必须落在产物根**（`packages/server` 的路径解析在 `import.meta.url` 被内联后回退 `process.cwd()`），并确保随包分发。

替代方案「CLI 临时起 server 再打 HTTP `POST /extensions`」已否决：为装一个包启一个 web 服务器不合理，且 `adminPolicy` 默认拒绝，CLI 场景需绕过它（那是 Web 多用户面的策略，本地 CLI 用户本就是 admin）。

### 已知坑（已实证）

- **软链进 `~/.pi-web/agents` 会被静默剔除**。`scan-provider.ts` 的 realpath 门控要求候选目录 realpath 后仍落在 `realpath(root)+sep` 之内。实测 `ln -s <repo>/examples/hello-agent ~/.pi-web/agents/linked-agent` 后端点仍只返回另一个真实目录，**无任何诊断输出**。
- **project scope 触发 pi 的 project trust 门控**（`assertProjectTrustedForScope`），CLI 无交互式 trust 流程，未信任目录会直接抛错。
- 默认扫描根让**后端**能扫出源，但前端仍受 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER`（构建期内联）门控。

---

## Introduction

本特性给 pi-web 全局 CLI 引入子命令分发层，并交付六个包管理子命令，使 agent 与 plugin 的**创建、安装、卸载、列出、更新、发布**在命令行内闭环。核心抽象是包清单 `pi-web.json` 中的 `kind` 字段（`agent` | `plugin`）：它在 `create` 时写下，决定 `publish` 编译出何种发布清单，也决定 `install` 的落盘目标。

安装能力在 pi-web 中已经存在，但出口仅有 Web UI 的斜杠命令；发布能力在 pi-web 与 pi SDK 中均不存在。本特性补齐命令行出口与发布链路，且不重造安装逻辑——复用既有的来源白名单、版本固定与 `pi` 子进程装配，保持与 Web UI 侧同一套信任判据。

## Boundary Context

- **In scope**：
  - CLI 子命令分发层，以及 `create` / `install` / `uninstall` / `list` / `update` / `publish` 六个子命令的用户可观测行为。
  - `pi-web.json` 到发布清单的编译（glob 展开、逐文件完整性摘要、签名）。
  - 发布前对包结构与依赖声明的校验。
  - 安装时的来源校验、签名校验与安装后完整性复核。
  - 无子命令时的既有启动行为保持不变。

- **Out of scope**：
  - 注册表**服务端**的任何行为（登记、验证、版本状态机、channel、yank）——归 pi-clouds 仓，见「Adjacent expectations」。
  - Web UI 侧 `/plugin` 斜杠命令的行为变更。
  - `pi-web.json` 清单格式与 `kind` 判别式本身（已于本轮实现落地，本特性只消费）。
  - `~/.pi-web/agents` 默认扫描根的解析逻辑（已落地，本特性只作为安装目标写入）。
  - agent 源的运行时载入、会话编排、路由解析。
  - 前端源列表的门控开关。
  - **发布者身份的创建与密钥对的生成**：登记发布者及其公钥是注册表侧的管理动作（需管理员权限）。本特性只**消费**一把已存在的私钥来签名，不生成密钥、不登记发布者。
  - **注册表中包身份（source）的创建**：`publish` 只提交新版本并移动发布通道，不创建包身份。包身份不存在时 `publish` 失败并指引用户先创建。

- **Adjacent expectations**：
  - **依赖 pi-clouds 仓的 `specs/registry-package-kind/`**：`publish` 提交 plugin 清单需要注册表接受 `kind` 判别式（放宽当前必需的入口字段）、接受 npm 形态的来源、支持公开可见性。这些是注册表侧的加法，本特性不拥有。
  - 两侧 `kind` 缺省相反（本仓清单缺省 `plugin`，注册表缺省 `agent`），故编译产出的发布清单**必须显式写出 `kind`**，不依赖任一侧缺省。
  - 注册表当前未部署。`publish` 与「经注册表安装」在注册表不可达时不可用，但**直连来源的安装必须照常工作**。
  - 依赖 pi 的包管理行为（安装目录约定、project 信任门控）。本特性不改变 pi 的这些行为，只在其之上做命令行封装与错误呈现。

---

## Requirements

### Requirement 1: 子命令分发与向后兼容

**Objective:** 作为既有 pi-web CLI 用户，我希望新增子命令不破坏我现有的启动命令，以便升级后无需修改任何脚本。

#### Acceptance Criteria

1. When 用户执行 `pi-web` 且首个位置参数不是已知子命令名，the pi-web CLI shall 按既有启动行为处理该参数（作为 agent source 启动本地实例），行为与本特性引入前逐字节一致。
2. When 用户执行 `pi-web` 且首个位置参数是已知子命令名，the pi-web CLI shall 将其后的参数交由该子命令解析，且不启动本地实例。
3. When 用户执行 `pi-web --help`，the pi-web CLI shall 在帮助文本中列出全部可用子命令及其一句话说明。
4. When 用户执行 `pi-web <subcommand> --help`，the pi-web CLI shall 输出该子命令专属的用法与选项说明，并以退出码 0 结束。
5. If 用户向某子命令传入该子命令不接受的选项，then the pi-web CLI shall 输出指明该选项名的错误信息、提示查看该子命令帮助，并以非零退出码结束，且不产生任何文件系统或网络副作用。
6. The pi-web CLI shall 使各子命令的选项集彼此独立，一个子命令的专属选项不得被其他子命令接受。
7. When 任一子命令成功完成，the pi-web CLI shall 以退出码 0 结束；when 任一子命令失败，the pi-web CLI shall 以非零退出码结束。

### Requirement 2: 骨架创建（create）

**Objective:** 作为 agent 或 plugin 作者，我希望用一条命令生成可直接运行的包骨架，以便不必手抄示例代码。

#### Acceptance Criteria

1. When 用户执行 `pi-web create <name>` 且未指定 `--kind`，the pi-web CLI shall 以 `agent` 作为包类型生成骨架。
2. When 用户执行 `pi-web create <name> --kind plugin`，the pi-web CLI shall 生成 plugin 形态的骨架，其中包含 `pi-web.json` 清单且清单的包类型字段显式为 `plugin`。
3. The pi-web CLI shall 在生成的 `pi-web.json` 中**显式写出**包类型字段，不依赖清单格式的缺省值。
4. When 用户执行 `pi-web create --list`，the pi-web CLI shall 列出全部可用模板的名称、标题与一句话描述，并以退出码 0 结束，且不创建任何文件。
5. When 用户执行 `pi-web create <name> --template <template>` 且该模板存在，the pi-web CLI shall 以该模板为骨架来源。
6. If 用户指定的模板名不存在，then the pi-web CLI shall 输出该模板名不存在的错误、列出可用模板名，并以非零退出码结束，且不创建任何文件。
7. If 目标目录已存在且非空，then the pi-web CLI shall 拒绝写入、输出目标路径已被占用的错误，并以非零退出码结束，且不修改该目录内任何既有文件。
8. When 骨架生成完成，the pi-web CLI shall 使生成物的包名与用户提供的 `<name>` 一致，且不残留模板自身的包名或"私有包"标记。
9. When 骨架生成完成，the pi-web CLI shall 使生成物的包关键字包含 pi 生态用于发现包的关键字（`pi-package`）。
10. When 用户以 `pi-web <生成的目录>` 启动该骨架，the pi-web CLI shall 成功拉起本地实例并进入会话，无需用户在骨架内额外安装依赖。
11. When 骨架生成完成，the pi-web CLI shall 输出生成物的绝对路径与下一步可执行的命令提示。

### Requirement 3: 安装与卸载（install / uninstall）

**Objective:** 作为 pi-web 使用者，我希望在命令行安装和卸载 agent 与 plugin，以便不必打开 Web UI。

#### Acceptance Criteria

1. When 用户执行 `pi-web install <source>` 且未指定作用域选项，the pi-web CLI shall 以用户级作用域安装。
   > **裁定与理由**：Web UI 侧 `/plugin install` 约定默认 project 作用域，而 pi 自身 `pi install` 默认 user。CLI 取 **user** 作为默认，因为 CLI 常在任意目录被调用，project 默认会污染当前工作目录并触发 pi 的 project 信任门控（CLI 无交互式信任流程，将直接失败）。此裁定使 `pi-web install` 与 `pi install` 的用户心智一致。
2. When 用户执行 `pi-web install <source> --project`，the pi-web CLI shall 以项目级作用域安装。
3. If 以项目级作用域安装且当前项目未被信任，then the pi-web CLI shall 输出「项目未信任」的可操作错误（含如何信任该项目的指引），并以非零退出码结束，且不安装任何内容。
4. If `<source>` 未通过来源校验（来源类型不被允许，或版本 / 引用未被固定），then the pi-web CLI shall 输出被拒绝的具体原因，并以非零退出码结束，且不下载或执行任何第三方代码。
5. The pi-web CLI shall 以非交互方式执行安装：不向用户提示确认，且不自动信任项目本地的配置文件。
   > **裁定与理由**：R3.5 原拟要求「禁止执行第三方包自带的安装脚本」。核查实现后发现 pi 的 `install` 子命令**不提供 `--ignore-scripts`**（`packages/server/src/extensions/install/install-args.ts:43`），其实际参数仅为 `[-l] [--approve|--no-approve]`。故本条改为陈述 `--no-approve` 的真实语义。包脚本的执行与否由 pi 及其底层包管理器决定，本特性不拥有该行为；仅 `agent` 通道（见 3.12）因自建落盘而天然不执行任何包脚本。
6. When 安装的包类型为 `agent`，the pi-web CLI shall 将其落盘到 agent 源的默认根目录之下，使其可被本地实例的源列表发现。
7. When 安装的包类型为 `plugin`，the pi-web CLI shall 将其交由 pi 的包管理落盘到 pi 的资源目录，并使其被记入 pi 的来源台账。
8. When 用户执行 `pi-web uninstall <name>` 且该包已安装，the pi-web CLI shall 移除该包并将其从来源台账中除名，随后输出被移除的包标识。
9. If 用户执行 `pi-web uninstall <name>` 而该包未安装，then the pi-web CLI shall 输出该包未安装的提示，并以非零退出码结束。
10. While 安装或卸载正在进行，the pi-web CLI shall 向用户输出可读的阶段性进度（开始 / 完成 / 失败）。
11. The pi-web CLI shall 在任何错误信息中不包含凭据、令牌或完整的环境变量内容。
12. When 安装的包类型为 `agent`，the pi-web CLI shall 仅获取并解包其发布产物，不执行该包内的任何安装脚本。

### Requirement 4: 列出与更新（list / update）

**Objective:** 作为 pi-web 使用者，我希望查看已安装了什么、有什么可更新，以便掌握本地状态。

#### Acceptance Criteria

1. When 用户执行 `pi-web list`，the pi-web CLI shall 输出已安装包的标识、版本或引用、作用域与包类型。
2. When 用户执行 `pi-web list` 且没有任何已安装包，the pi-web CLI shall 输出「无已安装包」的明确提示，并以退出码 0 结束。
3. When 用户执行 `pi-web list --outdated`，the pi-web CLI shall 仅列出存在可用更新的包，并对每一项标明当前版本与可用版本。
4. When 用户执行 `pi-web update` 且未指定包名，the pi-web CLI shall 更新全部可更新的包。
5. When 用户执行 `pi-web update <name>`，the pi-web CLI shall 仅更新该包。
6. The pi-web CLI shall 不更新被固定到精确版本或不可变引用的包，并在输出中标明这些包被跳过的原因。
7. If 更新过程中某个包失败，then the pi-web CLI shall 继续处理其余包、在结束时汇总列出失败项及其原因，并以非零退出码结束。

### Requirement 5: 发布清单编译（publish 的编译阶段）

**Objective:** 作为包作者，我希望发布时由工具把我手写的清单编译成可签名的发布清单，以便我不必手工维护文件摘要。

#### Acceptance Criteria

1. When 用户执行 `pi-web publish`，the pi-web CLI shall 读取包根的手写清单 `pi-web.json` 作为唯一事实来源。
2. If 包根不存在 `pi-web.json`，then the pi-web CLI shall 输出清单缺失的错误并指明期望路径，并以非零退出码结束。
3. If `pi-web.json` 不是合法 JSON 或不满足清单格式，then the pi-web CLI shall 逐条输出校验失败的字段路径与原因，并以非零退出码结束。
4. When 编译发布清单，the pi-web CLI shall 展开手写清单中的通配模式与排除模式，使发布清单中只包含确定的文件列表，不含任何通配语法。
5. When 编译发布清单，the pi-web CLI shall 为每一个被声明的产物文件计算内容完整性摘要，并写入发布清单。
6. If 手写清单声明的某个资源路径在磁盘上不存在，then the pi-web CLI shall 输出该缺失路径，并以非零退出码结束，且不生成发布清单。
7. When 编译发布清单，the pi-web CLI shall **显式写出**包类型字段，不依赖手写清单或注册表任一侧的缺省值。
8. When 编译发布清单，the pi-web CLI shall 以作者提供的私钥对发布清单签名，签名覆盖除签名字段自身之外的全部规范化内容。
9. The pi-web CLI shall 从用户显式指定的位置读取签名私钥，且不在任何输出中回显私钥内容。
10. If 未指定签名私钥，或指定的私钥不存在、不可读、格式非法，then the pi-web CLI shall 输出如何提供私钥的指引，并以非零退出码结束，且不生成发布清单、不发起任何外部写操作。
11. The pi-web CLI shall 不将编译产出的发布清单写入包的源码目录，以免其被误当作手写清单再次编译。

### Requirement 6: 发布前校验与投影（publish 的校验阶段）

**Objective:** 作为包作者，我希望发布前就发现包结构错误，而不是等别人安装失败才知道。

#### Acceptance Criteria

1. When 用户执行 `pi-web publish`，the pi-web CLI shall 将手写清单中声明的 pi 资源入口投影进包的 `package.json`，使 pi 的包管理无需读取本仓专属清单即可发现这些资源。
2. When 用户执行 `pi-web publish`，the pi-web CLI shall 确保包的关键字包含 pi 生态用于发现包的关键字（`pi-package`）。
3. If 包引用了 pi 运行时自带的核心包，且这些包未被声明为对等依赖或其版本范围不是任意版本，then the pi-web CLI shall 输出违规的包名与期望声明方式，并以非零退出码结束。
4. If 包引用了 pi 运行时自带的核心包且将其列入了随包分发的依赖，then the pi-web CLI shall 输出该冲突并以非零退出码结束。
5. If 包引用了其他 pi 生态包却未将其声明为随包分发的依赖，then the pi-web CLI shall 输出该缺失并以非零退出码结束。
6. If 手写清单声明了 web 扩展产物目录而该目录不存在或为空，then the pi-web CLI shall 输出该产物未构建的错误，并以非零退出码结束。
7. When 用户执行 `pi-web publish --dry-run`，the pi-web CLI shall 执行全部校验与编译、输出将被发布的清单内容与文件列表，且**不向任何外部服务发起写操作**，并以退出码 0 结束（当且仅当全部校验通过）。
8. If 任一校验失败，then the pi-web CLI shall 在发起任何外部写操作之前终止，且不留下部分完成的发布状态。

### Requirement 7: 发布提交与注册表集成

**Objective:** 作为包作者，我希望校验通过后包被登记到注册表，以便他人能按名字安装它。

#### Acceptance Criteria

1. When 全部校验与编译通过，the pi-web CLI shall 向注册表提交该版本的来源与已签名的发布清单。
2. When 版本提交成功，the pi-web CLI shall 将该包的发布通道指向新版本，使其对新的安装生效；发布通道的名称可由用户指定，未指定时使用稳定通道。
3. Where 用户指定了「仅提交版本、不移动发布通道」，the pi-web CLI shall 在版本提交成功后停止，不改变任何发布通道的指向。
4. If 注册表中不存在该包的身份，then the pi-web CLI shall 输出包身份不存在的错误与创建它的指引，并以非零退出码结束。
5. If 注册表拒绝该版本（校验失败、签名不被任何启用公钥验证、或回源核验不一致），then the pi-web CLI shall 输出注册表返回的失败原因，并以非零退出码结束。
6. If 同一包的同一版本已存在于注册表，then the pi-web CLI shall 输出该版本已存在的提示，并以非零退出码结束，且不产生任何副作用。
7. If 注册表不可达或响应超时，then the pi-web CLI shall 输出连接失败的原因与所用注册表地址，并以非零退出码结束。
8. If 待提交的来源引用是可变的（如分支名或浮动版本范围），then the pi-web CLI shall 拒绝提交并说明须使用不可变引用。

### Requirement 8: 经注册表安装与直连降级

**Objective:** 作为 pi-web 使用者，我希望按名字安装注册表里的包并确信它未被篡改，同时在注册表不可用时仍能按来源直接安装。

#### Acceptance Criteria

1. The pi-web CLI shall 依据实参的形态判别其为「直接来源」还是「注册表包标识」：带来源类型前缀、协议头、SSH 简写、文件系统路径形态、或首段形似主机名的实参视为直接来源，其余视为注册表包标识；该判别规则 shall 在子命令帮助中说明。
   > **形态清单（实现于任务 4.2，据其复核结论补全至此）**：来源类型前缀（`npm:` / `git:` / `local:`）、
   > 协议头（`https://` / `ssh://` / …）、SSH 简写（`git@host:path`）、文件系统路径（`./` / `../` / `/` / `~` / `C:\`）、
   > 首段含 `.` 的主机名简写（`github.com/u/r`）→ **直接来源**；其余（`org/name`、`org/name@channel`、`bare-name`）→ **注册表包标识**。
   >
   > 首段含 `.` 这一条用于区分 `github.com/u/r`（git 简写）与 `org/name`（注册表标识），二者都含 `/`。
   > 注意：无前缀的主机名简写虽被判为直接来源，但会被来源白名单拒绝——这与 pi 的语义一致
   > （`pi` 的 `docs/packages.md`：无 `git:` 前缀时只接受协议 URL）。
2. When 用户执行 `pi-web install <source>` 且 `<source>` 被判别为直接来源，the pi-web CLI shall 直接安装该来源，**不联系注册表**。
3. When 用户执行 `pi-web install <name>` 且 `<name>` 被判别为注册表包标识，the pi-web CLI shall 先向注册表解析该标识，得到其来源与已签名的发布清单。
4. When 从注册表解析到发布清单，the pi-web CLI shall 用该包发布者的启用公钥在本地验证清单签名，验证通过后方可继续安装。
5. If 本地签名验证失败，then the pi-web CLI shall 拒绝安装、输出签名不可信的错误，并以非零退出码结束，且不下载或执行任何第三方代码。
6. When 签名验证通过，the pi-web CLI shall 将注册表返回的来源转换为安装所需的来源表示，交由既有安装路径完成落盘。
7. When 落盘完成，the pi-web CLI shall 按发布清单逐项复核已安装文件的内容完整性摘要。
8. If 安装后完整性复核发现任一文件与发布清单不一致，then the pi-web CLI shall 输出不一致的文件路径、移除本次安装的落盘内容，并以非零退出码结束。
9. While 注册表不可达，the pi-web CLI shall 使直接来源形态的安装、卸载、列出与更新保持可用。

### Requirement 9: 本地开发的骨架接入

**Objective:** 作为 agent 作者，我希望在任意目录开发的 agent 能出现在本地实例的源列表里，以便边改边试。

#### Acceptance Criteria

1. If 用户将一个位于默认扫描根之外的目录以符号链接方式放入默认扫描根，then the 本地实例 shall 不会将其列为可用源（既有安全门控行为）。
2. Where 用户需要让扫描根之外的目录出现在源列表，the pi-web CLI shall 提供一条不削弱既有安全门控的登记途径。
3. When 用户以该途径登记一个本地目录，the 本地实例的源列表 shall 包含该目录，且其展示信息取自该目录的包元数据。
4. When 用户以该途径撤销登记，the 本地实例的源列表 shall 不再包含该目录。
5. If 用户以该途径登记的目录不存在或不是一个有效的包目录，then the pi-web CLI shall 输出具体原因并以非零退出码结束。

### Requirement 10: 可观测性、安全与验证证据

**Objective:** 作为 pi-web 的维护者，我希望这组命令的行为可被自动化验证且不泄漏敏感信息，以便安全地演进它。

#### Acceptance Criteria

1. The pi-web CLI shall 使全部子命令的参数解析为无副作用的纯函数，可在不触碰文件系统与网络的前提下被单元测试覆盖。
2. The pi-web CLI shall 在向子进程传递环境变量时，仅传递该子进程所需的变量，不透传调用者的完整环境。
3. When 任一子命令因外部工具失败而失败，the pi-web CLI shall 输出脱敏后的失败摘要，不包含凭据或令牌。
4. The pi-web CLI shall 使 `create`、`install`、`uninstall`、`list`、`update` 的端到端行为可在**无真实注册表服务、无真实网络**的条件下被自动化验证。
5. The pi-web CLI shall 使 `publish` 的端到端行为可在**无真实注册表服务**的条件下被自动化验证（借助注册表侧交付的进程内契约夹具）。
6. Where 子命令需要复用后端的校验与编译逻辑，the pi-web CLI shall 通过随包分发的产物获得这些逻辑，且该产物在包被安装到任意路径后仍可被解析。
