# Requirements Document

## Project Description (Input)
Component 安装器 v1（pi-web add）：shadcn 式源码组件车道。设计稿 docs/component-installer-design.md 已定稿，本 spec 实现其 §8 v1 范围：(1) pi-web add 子命令——挂进既有 CLI 子命令分发层（cli-package-commands task 2.1 已落地），支持本地目录与 git 直连来源 + --dry-run + --target，把组件包清单声明的源码文件拷进目标 agent source 的 `.pi/web/components/<id>/`，写 `.component.json` 溯源（来源/版本/逐文件 sha256），打印接线指引（v1 不做 codemod）；(2) 更新三态——落盘哈希与溯源一致则覆盖新版、有本地改动则打印上游 unified diff 不覆盖、无新版 no-op；(3) pi-web.json schema 增加 kind:"component" 判别式与 component 字段组（files/target/wiring/peer/registryDeps）；peer semver 校验硬失败 + --force 逃生门；target 固定 `.pi/web/components/<id>/` 且防路径逃逸；add 纯文件写入不执行组件包任何代码；(4) demo（自举验收）——新增一个组件包 example（canvas 水印组件：图层/工具/动作三件套，含单测）+ 演示把它 add 进一个干净 agent source 后 pi-web build 成功、组件单测通过。明确不做：registry 远端解析、接线 codemod、registryDeps 递归、marketplace、运行时签名。

## Introduction

本特性给 pi-web CLI 增加 `add` 子命令，交付第四条组件分发车道：**以源码交付、拷入即归使用者所有**（对标 shadcn/ui 的安装机制）。组件作者用 `pi-web.json` 的新 `kind:"component"` 声明要分发的源文件、落点、接线点与 peer 基线；使用者一条命令把组件源码装进自己 agent source 的 `.pi/web/components/<id>/`，按打印的接线指引挂上插件点，`pi-web build` 后生效。安装留有溯源记录，重复 `add` 具备幂等更新语义（未改覆盖 / 已改出 diff / 无新版 no-op）。随特性交付一个 canvas 水印组件范例包与端到端 demo 作自举验收。

**与设计稿的一处偏差（已查实的命名冲突）**：设计稿 §4.5 拟独立 `pi-web update <id>` 子命令；但 `update` 已被既有子命令表占用（source 级更新，归 cli-package-commands）。故 v1 将更新三态并入 `add` 的幂等语义，不新增 `update` 子命令。

## Boundary Context

- **In scope**：
  - `pi-web add` 子命令的用户可观测行为：本地目录与 git 直连来源、`--dry-run`、`--target`、`--force`、幂等更新三态。
  - `pi-web.json` 清单的 `kind:"component"` 判别式与 `component` 字段组的校验规则。
  - 安装落点约定、溯源记录（`.component.json`）、接线指引输出。
  - canvas 水印组件范例包（examples 下）及其单测。
  - demo 自举验收的端到端验证。
  - 为 `add` 铺通 CLI 子命令分发的最小接缝（现为占位）。
- **Out of scope**：
  - registry 远端解析与经注册表安装（v1 只本地/git 直连；registry 形态归 v2）。
  - 接线 codemod（v1 只打印指引）。
  - `registryDeps` 递归安装（schema 预留字段，v1 要求为空）。
  - 组件列表（`list --components`）、marketplace、发现推荐。
  - 运行时签名 / 验签（源码车道的信任模型是安装时人审，见设计稿 §5）。
  - 其余六个子命令（create/install/uninstall/list/update/publish）的分发接线与行为变更（归 cli-package-commands）。
  - `pi-web build` 编译行为本身（归 web-kit，已存在，本特性只消费）。
- **Adjacent expectations**：
  - CLI 子命令的「名称→实现」真正分发（cli-package-commands 任务 6.1）目前是占位。本特性只为 `add` 接通所需最小路径，**不得改变其它子命令的现有占位行为**。
  - 既有逐文件完整性摘要工具是 sha384（publish 编译阶段用）；本特性溯源用 sha256，为独立实现，互不影响。
  - 仓内无 semver 依赖；peer 范围校验为本特性自带的极简实现，支持写法以 Requirement 4 为准。
  - git 直连来源的允许清单与拉取行为复用既有机制（与 `install` 同一套信任判据），本特性不放宽也不收紧。

## Requirements

### Requirement 1: 组件清单判别与校验

**Objective:** 作为组件作者，我希望用 `pi-web.json` 声明组件的文件、落点、接线与依赖基线，使安装器能机器校验并安装我的组件，而无需附带任何构建产物。

#### Acceptance Criteria
1. The CLI shall 接受 `kind:"component"` 的 `pi-web.json` 清单，并在该 kind 下要求 `component` 字段组（`files`、`wiring`、`peer`；`target` 与 `registryDeps` 可缺省）。
2. If 清单 `kind` 为 `component` 但缺少 `component` 字段组或必需子字段，the CLI shall 拒绝安装并输出稳定错误码与缺失字段名。
3. If `component.files` 为空、包含绝对路径、或包含解析后逃出组件包根的相对路径，the CLI shall 拒绝安装并输出稳定错误码。
4. If `component.files` 不含任何测试文件（文件名含 `.test.`），the CLI shall 拒绝安装并说明组件包必须随源分发测试。
5. If `component.wiring.point` 不是 `canvasPlugins`，the CLI shall 拒绝安装并说明 v1 仅支持 `canvasPlugins`（清单格式预留 `renderers`、`slots` 枚举值）。
6. If `component.registryDeps` 声明为非空数组，the CLI shall 拒绝安装并说明 v1 不支持组件间依赖。
7. If `component.target` 有声明且不等于 `.pi/web/components/<清单 id>`，the CLI shall 拒绝安装；缺省时落点即该约定值。

### Requirement 2: 来源解析

**Objective:** 作为 agent source 维护者，我希望从本地目录或 git 直连地址安装组件，使我在 registry 不可用时也能集成第三方组件。

#### Acceptance Criteria
1. When 用户执行 `pi-web add <本地目录路径>`，the CLI shall 将该目录作为组件包根，读取其中的 `pi-web.json` 并按 Requirement 1 校验。
2. When 用户执行 `pi-web add <git 直连来源>`，the CLI shall 经既有的直连来源信任判据校验后拉取仓库，并以仓库根（或来源标注的子目录）作为组件包根。
3. Where git 直连来源带子目录标注（`#<路径>` 片段），the CLI shall 以该子目录为组件包根；子目录不存在时拒绝并输出稳定错误码。
4. If 来源实参既不是存在的本地目录也不是可识别的 git 直连形态，the CLI shall 拒绝并说明 v1 不支持 registry 名称解析，给出本地/git 直连的用法示例。
5. If 组件包根不含 `pi-web.json`，或其 `kind` 不是 `component`，the CLI shall 拒绝安装并输出稳定错误码与实际 kind。

### Requirement 3: 目标 source 定位与落点安全

**Objective:** 作为 agent source 维护者，我希望安装器准确定位我的 source 并把文件只写进约定落点，使安装不会破坏 source 内其它文件或写到 source 之外。

#### Acceptance Criteria
1. When 用户以 `--target <目录>` 指定目标，the CLI shall 以该目录为目标 agent source；未指定时以当前工作目录为目标。
2. If 目标目录不含 `.pi/web/` 子目录，the CLI shall 拒绝安装并说明目标不是可接线的 agent source。
3. The CLI shall 仅在目标 source 的 `.pi/web/components/<组件 id>/` 之内写入文件；任一待写路径在解析符号链接后落在该目录之外时，shall 拒绝安装并输出稳定错误码。
4. While 执行安装（含校验、拷贝、溯源写入），the CLI shall 不执行组件包内的任何代码，也不触发任何安装钩子。

### Requirement 4: peer 基线校验

**Objective:** 作为 agent source 维护者，我希望安装前就知道组件要求的基线包版本是否满足，使编译失败不会成为我发现不兼容的第一现场。

#### Acceptance Criteria
1. When 清单声明 `component.peer`，the CLI shall 从目标 source 目录出发解析每个 peer 包的实际安装版本，并按声明范围校验。
2. If 任一 peer 包无法解析或版本不满足范围，the CLI shall 拒绝安装，并一次性列出全部不满足项（包名、要求范围、实际版本或「未找到」）。
3. Where 用户传入 `--force`，the CLI shall 将 peer 校验失败降级为警告并继续安装。
4. The CLI shall 支持精确版本、`>=`、`^`、`~` 四种范围写法；遇到其它写法时 shall 拒绝并输出稳定错误码与该写法原文。

### Requirement 5: 安装执行与溯源

**Objective:** 作为 agent source 维护者，我希望安装动作原子且留有溯源记录，使我随时能查明每个组件从哪来、装了什么、有没有被改过。

#### Acceptance Criteria
1. When 全部校验通过，the CLI shall 把 `component.files` 声明的文件按包内相对结构拷贝到 `.pi/web/components/<组件 id>/`。
2. When 拷贝完成，the CLI shall 在同目录写入 `.component.json` 溯源记录，含组件 id、版本、来源标识、安装时间与逐文件 sha256 摘要。
3. If 安装过程中任一文件写入失败，the CLI shall 不在落点留下部分写入的文件集（要么全量成功，要么落点恢复到安装前状态），并输出稳定错误码。
4. When 安装成功，the CLI shall 打印接线指引：依据 `component.wiring` 生成的 import 语句、插件点数组项，以及运行 `pi-web build` 的提示。
5. When 安装成功，the CLI shall 以步骤化进度输出各阶段结果（来源解析、校验、拷贝、溯源），敏感信息（如 git 凭据）不得出现在输出中。

### Requirement 6: dry-run 预演

**Objective:** 作为 agent source 维护者，我希望安装前能完整预演，使我在人审源码车道下先看清将落盘什么、接什么线，再决定是否安装。

#### Acceptance Criteria
1. When 用户传入 `--dry-run`，the CLI shall 执行与真实安装完全相同的来源解析与全部校验，但不写入任何文件。
2. When dry-run 通过校验，the CLI shall 列出将写入的每个文件的目标相对路径，并打印与真实安装一致的接线指引。
3. If dry-run 中任一校验失败，the CLI shall 以与真实安装一致的稳定错误码与非零退出码结束。

### Requirement 7: 幂等更新三态

**Objective:** 作为 agent source 维护者，我希望对已装组件重复执行 `add` 时得到可预期的更新行为，使上游更新与我的本地修改不会互相覆盖。

#### Acceptance Criteria
1. When 落点已存在 `.component.json` 且落盘文件的 sha256 与溯源记录全部一致，且来源版本不同于已装版本，the CLI shall 覆盖为来源新内容并刷新溯源记录。
2. When 落点已存在 `.component.json` 且落盘文件与溯源记录全部一致，且来源版本等于已装版本，the CLI shall 不做任何写入并提示已是该版本。
3. If 落盘文件与溯源记录的 sha256 不一致（组件被本地修改过），the CLI shall 拒绝覆盖，逐文件打印来源新内容与本地内容的 unified diff，并提示手动合并；`--force` 不改变此行为。
4. If 落点目录存在但无 `.component.json`，the CLI shall 拒绝安装并说明落点被非本安装器管理的内容占用。

### Requirement 8: 组件包范例（canvas 水印）

**Objective:** 作为组件作者，我希望仓库自带一个符合全部清单与源码约定的组件包范例，使我能照抄它发布自己的组件。

#### Acceptance Criteria
1. The 仓库 shall 在 examples 下提供一个 `kind:"component"` 的水印组件包范例，含清单、canvas 插件捆源码（图层、工具、动作三件套）与其测试文件。
2. The 范例组件源码 shall 只 import 清单 `peer` 声明过的包与包内相对路径。
3. Where 范例的动作声明经命令通道执行，the 动作 shall 依能力白名单避让：会话能力清单未含对应命令时不参与决策。
4. The 范例组件的测试 shall 纳入仓库测试套件并通过。

### Requirement 9: demo 自举验收

**Objective:** 作为本仓维护者，我希望用范例组件走通「add → 接线 → 构建」全链路的自动化验证，使这条车道的回归有明确的守门测试。

#### Acceptance Criteria
1. The 端到端验证 shall 在临时目录中复制一个干净 agent source，把范例组件 `add` 进去，按打印的接线指引完成接线后执行 `pi-web build`，构建成功且产物中含该组件的可识别标记。
2. The 端到端验证 shall 覆盖 dry-run（列出文件与指引、零写入）与至少一条拒绝路径（如对非 component 包执行 add）。
3. The 端到端验证 shall 不修改仓库工作树内的任何文件。

### Requirement 10: 错误呈现与退出约定

**Objective:** 作为 CLI 使用者，我希望每种失败都有稳定可脚本化的错误码与可读信息，使我能在自动化脚本与人工排障两种场景下都用得上。

#### Acceptance Criteria
1. If 任一校验或执行步骤失败，the CLI shall 输出稳定错误码、人类可读的原因与（适用时）修复建议，并以非零退出码结束。
2. When `add` 执行成功，the CLI shall 以零退出码结束。
3. The CLI shall 在无子命令时保持既有启动行为不变，且不改变其它子命令的现有行为。
