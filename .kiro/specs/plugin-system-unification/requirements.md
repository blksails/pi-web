# Requirements Document

## Project Description (Input)

pi-web 已经分散实现了"插件"所需的大部分能力，但它们散落在 ~10 个既有 spec
里，且分成**两套互不统一的机制**：

- **pi 原生 extension**（CLI 标准，`registerTool`/`registerCommand`）：runner 子进程内发现执行，
  经 `get_commands` RPC → `GET /sessions/:id/commands` 暴露给前端做 slash 补全。
- **webext**（5 层 web UI 扩展）：浏览器同源加载，`.pi/web/dist` 经 `/api/webext/resolve`
  服务端验签 + 浏览器 SRI 后动态 import。

二者在**底层落盘**已统一（都复用 pi `DefaultPackageManager`），但在**包标准、发现入口、
安装生效、补全暴露面**上仍是两条路。结果是：一个想同时提供"agent 能力 + 定制 UI"的插件
作者，必须维护两套目录约定与手工桥接；而运营者即便装好插件，UI 也常常"装了不变"。

本特性做一次**收口统一**（不重建已稳的底层）：定义一个**扁平于两层的 pi-web 插件包标准**，
让一个包同时携带 pi 原生资源（零改动）与可选 webext；接通生产安装入口（沿用既有管理员门控）；
实现"装完即时双路生效"；并交付**可发布的独立插件示例**与"agent source 兼作插件提供源"的样板。

### 受影响干系人与现状

- **插件作者**：想发布"代码检视""部署助手"这类既给 agent 加工具/命令、又定制 web 卡片/补全的
  插件。现状要分别照顾 `extensions/` 顶层目录（origin: package）与 `.pi/web/dist`，且 agent
  自用与对外发布两种场景的目录约定不一致，需符号链接/薄转发手工桥接。
- **运营者 / 自托管部署方**：`createExtensionRoutes()` 已实现但未在 `apps/web` 接线挂载，
  安装入口"能力在、门没开"。
- **终端用户**：装插件后 pi 资源需 reload、webext 需客户端重触发，二者不联动时体验割裂
  （"装了 UI 没变"）。

### 期望改变

1. 一份**统一插件包清单/约定**描述两层入口，agent-source 与可发布包共用同一声明。
2. 一个 pi 原生 extension **一字不改**即可在 pi-web 被发现、执行、并自动出现在 slash 补全。
3. 安装入口在生产装配处接通，沿用现有 `adminPolicy` + 来源白名单 + 版本固定 + 审计。
4. `/plugin install <source>` 完成后**自动双路生效**（runner reload + webext reloadNonce），无需手动刷新。
5. 交付可直接 `pnpm dev` 跑通的参考示例：一个独立可发布插件包、一个 consumer agent、以及 agent 兼作插件源的样板。

## Requirements

### Requirement 1: 统一插件包标准（清单 + 布局约定）

**Objective:** 作为插件作者，我希望用一份统一的包清单声明 pi 资源入口与 webext，
这样我无需为"agent 自用"与"对外发布"两种场景维护两套目录约定与手工桥接。

#### Acceptance Criteria
1. The 插件包标准 shall 定义一个统一清单（工作名 `pi-plugin.json`），可在单一文件中声明该包提供的 pi 原生资源（extensions/skills/prompts/themes）入口与可选 webext（`.pi/web/dist`）入口。
2. When 一个包同时声明 pi 资源与 webext，the 系统 shall 把两者识别为**同一个逻辑插件**（同一标识、同一版本、同一启停单元），而非两个互不相关的资源。
3. The 插件包标准 shall **向后兼容**既有约定：未提供统一清单的包仍按 pi `DefaultPackageManager` 既有目录约定（origin: package → 包根 `extensions/`/`skills/`；webext → `.pi/web/dist`）被发现，不破坏现有已装包。
4. If 统一清单字段非法或与实际产物不一致（如声明了 webext 但 `.pi/web/dist` 缺失），the 系统 shall 拒绝把该字段并入插件描述并记录可诊断原因，但不使整包失败（合法部分仍生效）。
5. The 插件包标准 shall 以文档（`docs/product/` 章节）+ 类型/schema 形式落地，作为作者与宿主的单一事实来源。

### Requirement 2: pi 原生 extension 零改动复用

**Objective:** 作为插件作者，我希望我的 pi 原生 extension（`registerTool`/`registerCommand`）
在 pi-web 中一字不改即可被发现、执行、并出现在 slash 命令补全，这样我无需为 web 端做任何适配。

#### Acceptance Criteria
1. When 一个仅含 pi 原生 extension（无任何 web 适配代码）的包被安装并在会话中加载，the 系统 shall 发现其注册的工具与命令并使之可用，无需修改扩展源码。
2. The 系统 shall 将 pi extension 注册的 slash 命令（`source: "extension"`）经 `get_commands` 通道暴露，并出现在前端命令补全候选中。
3. When 用户在前端选中一个 pi extension 注册的命令，the 系统 shall 正确发起其执行且**不使会话永久 busy**（修复扩展命令本地执行不发 `agent_end` 导致的卡死）。
4. The 系统 shall 不要求 pi extension 依赖任何 pi-web 专属包或 API 即可被复用（保持其在纯 CLI pi 下同样可运行）。

### Requirement 3: 单包扁平双层（同一能力跨两层咬合）

**Objective:** 作为插件作者，我希望同一份能力的"数据层"（pi 工具）与"呈现层"（webext 渲染器/补全）
在一个包内以明确契约咬合，这样我写两个文件、零胶水即可让工具输出获得定制 UI。

#### Acceptance Criteria
1. The 系统 shall 以**工具名/数据-part 名**作为两层契约锚点：pi 侧 `registerTool(name)` 产出的 part 由 webext `renderers.tools[name]` 接管渲染。
2. When 一个插件同时提供 pi 工具与对应 webext 渲染器，the 系统 shall 在该工具产出时调用插件的自定义渲染器替代默认工具卡。
3. The 系统 shall 允许 webext 经 Tier3 贡献点（`contributions.slash` 等）补充命令/补全，且这些贡献与 pi extension 命令在用户视角呈现为统一候选面（见 Requirement 6）。
4. The 系统 shall 以扩展标识命名空间化 webext 贡献（per-session registry），避免多插件互相覆盖。

### Requirement 4: agent source 兼作插件提供源（双角色）

**Objective:** 作为 agent 作者，我希望同一个仓库既能作为 agent source 自己运行、又能被发布为插件供他人安装，
这样我无需把能力代码维护两份。

#### Acceptance Criteria
1. The 插件包标准 shall 支持一个仓库**同时满足**两种发现场景：自运行时（origin: top-level → `<cwd>/.pi/`）与被安装时（origin: package → 包根资源目录），共用同一份能力实现。
2. The 标准 shall 提供一种**免重复**的桥接方式（统一清单指向单一真身），消除当前需要符号链接或薄转发文件维护两份扩展入口的样板代价。
3. When 该仓库被当作 agent source 自运行，the 系统 shall 走 top-level 发现并加载其 `.pi/` 资源与 webext（构建期车道）。
4. When 该仓库被当作插件安装到他处 agent，the 系统 shall 走 package 发现并加载其包根资源与 `.pi/web/dist`（运行时车道）。

### Requirement 5: 生产安装入口接通（沿用管理员门控）

**Objective:** 作为自托管运营者，我希望安装/卸载/重载入口在生产装配处真正可用，
这样用户能从 UI/命令安装插件，而安全姿态沿用既有治理。

#### Acceptance Criteria
1. The 系统 shall 在生产装配处（`apps/web` 装配 `createPiWebHandler` 之处）挂载 `createExtensionRoutes()`，使安装/卸载/列表/reload 端点在生产可达。
2. The 安装入口 shall 沿用既有 `adminPolicy`（默认拒绝匿名）+ 来源白名单 + 版本固定 + `--ignore-scripts` + 审计，不放松安全约束。
3. When 一个非管理员发起安装/卸载/reload，the 系统 shall 拒绝（403/401）并产出"被拒绝"审计记录。
4. When 来源不在白名单或未固定版本，the 系统 shall 在执行 `pi install` 之前拒绝（422）并记录原因。
5. The 系统 shall 注入真实的 `reloadSession` 实现（替代默认 501），使 reload 端点在生产可成功重建运行时。
6. Where 处于本地开发环境，the 系统 may 经显式配置放宽（如 `allowLocal`），但生产默认保持严格。

### Requirement 6: 统一 slash 命令补全暴露面

**Objective:** 作为终端用户，我希望 pi extension/skill/prompt、内置命令、以及 webext 贡献的命令
在同一个命令补全面里呈现为一致体验，这样我不必区分"这是哪种插件的命令"。

#### Acceptance Criteria
1. The 命令补全面 shall 合流四类来源（`extension`/`prompt`/`skill`/`builtin`）与 webext Tier3 `contributions.slash` 贡献，呈现为单一候选流。
2. The 命令补全面 shall 对不同来源呈现可辨识的来源标识（徽标/`data-*` 属性），但不要求用户感知底层机制差异。
3. When 候选来源含同名命令，the 系统 shall 以确定的优先级规则去重合并，保留既有"输入 `/` 默认选中"行为不变。
4. The 系统 shall 在会话空闲时按既有约定开启 webext 贡献所需的空闲控制流（`hasContributions && !isBusy`），不破坏 prompt 流回归。

### Requirement 7: 装完即时双路生效

**Objective:** 作为终端用户，我希望安装一个插件后其 agent 能力与 web UI 同时即时生效，
这样我不必手动刷新或新建会话才能看到变化。

#### Acceptance Criteria
1. When `/plugin install <source>`（或等价 REST 安装）成功完成，the 系统 shall 自动触发**两路生效**：① pi 资源经 `SessionReloader`（runner reload）；② webext 经客户端 `reloadNonce` 重触发加载路径。
2. The 系统 shall 使两路生效**并行且互不阻塞**：任一路失败不阻断另一路，且各自的失败以可诊断方式反馈，不使会话崩溃。
3. When 安装的包**仅含** pi 资源（无 webext），the 系统 shall 仅触发 runner reload 路径，webext 路径安全空转不报错。
4. When 安装的包**仅含** webext（无 pi 资源），the 系统 shall 仅触发 webext 重加载路径，reload 路径安全空转不报错。
5. The 系统 shall 在双路生效期间/完成后，经既有 ambient UI（通知/状态）向用户反馈安装与生效进度。
6. The 即时生效 shall 限定于**当前会话**；对其他会话与新建会话的生效遵循既有约定（新建会话自动加载）。

### Requirement 8: 参考示例交付

**Objective:** 作为采用本标准的作者/维护者，我希望有可直接运行的端到端示例，
这样我能照着写自己的插件，且这些示例可作为本特性的 e2e fixture。

#### Acceptance Criteria
1. The 特性 shall 交付一个**独立可发布插件包**示例（工作名 `examples/plugin-code-review/`），含统一清单、pi 原生 extension（`code_review` 工具 + `/review` 命令）、可选 skill、与构建好的 `.pi/web/dist`（含富卡渲染器 + Tier3 slash 贡献）。
2. The 特性 shall 交付一个**最小 consumer agent** 示例，演示安装该插件后 `/review` 命令补全与 `code_review` 富卡在同一会话即时生效。
3. The 特性 shall 交付或在文档中明确**"agent source 兼作插件提供源"**的双角色样板，演示同一仓库自运行与被安装两种路径。
4. The 示例 shall 可在隔离构建/离线 stub 下被 e2e 覆盖（不依赖真实 LLM），并在 `examples/README.md` 注册条目。
5. The 示例 shall 遵循仓库既有示例风格（README、目录约定、`data-testid` 验收锚点）。

### Requirement 9: 统一插件声明 web 可见 slash 命令（增量）

**Objective:** 作为插件作者，我希望用 `pi-plugin.json` 显式声明哪些 slash 命令在 web 补全中默认可见，
这样用户无需平台级 env 放行即可使用我的命令，同时保留平台对未知扩展命令的默认隐藏安全网。

> 背景：平台默认隐藏 `source:"extension"` 命令（防 busy 卡死的历史安全网）。busy 卡死已由
> fire-and-forget 修复（sha `36c82fc`），故统一插件应能让其命令默认可见——但不应粗暴翻转全局默认
> （会破坏"默认隐藏"不变量及其单测），而是让插件**显式 opt-in**。

#### Acceptance Criteria
1. The 插件包标准 shall 支持在 `pi-plugin.json` 的 `web.commands` 声明一组 slash 命令名。
2. When 会话加载了声明 `web.commands` 的插件，the 系统 shall 在 `GET /sessions/:id/commands` 对这些命令回填 `webVisible: true`（据命令 `sourceInfo` 解析其所属插件清单）。
3. The 命令补全面 shall 对 `webVisible === true` 的扩展命令**默认放行**，无需 `NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST`/`COMMANDS` 配置。
4. The 系统 shall 保留对**未声明**的 `source:"extension"` 命令的默认隐藏（安全网不变），既有 `enabled`/`allowlist` 策略仍生效。
5. If 命令所属插件无 `pi-plugin.json` 或解析失败，the 系统 shall 安全降级（不打 `webVisible`），不影响命令本身可用。

### Requirement 10: fire-and-forget 扩展命令的 ctx.ui 反馈可见（增量）

**Objective:** 作为用户，我希望经斜杠补全触发的扩展命令（如 `/review`）的 `ctx.ui` 反馈在 web 上可见、
且重要级别不会太快消失，这样我能看到命令的执行结果。

> 背景：插件命令经 fire-and-forget（`client.prompt`）投递、不开 per-prompt 流；其 `ctx.ui`
> （notify/status/widget）帧此前因空闲控制流以 `applyAmbient:false` 打开而被丢弃 → "命令没反映"。

#### Acceptance Criteria
1. When 一个 fire-and-forget 扩展命令经 `ctx.ui` 发出 notify/status/widget，the 系统 shall 在 web UI 呈现该反馈（即使该命令不开 per-prompt 流）。
2. The 空闲控制流 shall 应用 `extension-ui`（ambient）帧到 controlStore，使无 per-prompt 流的命令反馈有消费者；且不引入与 per-prompt 流的重复应用。
3. The 通知浮层 shall 按级别管理自动消失：`info` 默认 5s 自动消失；`error`/`warning` 不自动消失、需手动关闭（避免重要信息太快消失）。
4. The 示例插件的 `/review` 命令 shall 经 `ctx.ui` 即时反馈本地检视 findings，不触发 LLM turn（fire-and-forget 命令不订阅 turn 输出；富卡走自然语言提问的正常 prompt 流）。

## Boundary Context

- **In scope**：
  - 统一插件包标准（清单 + 布局约定 + 文档 + schema/类型）。
  - 接通生产安装入口（挂载 `createExtensionRoutes` + 注入 `reloadSession`），沿用既有治理。
  - 装完即时双路生效编排（runner reload + webext reloadNonce 联动）。
  - 统一 slash 命令补全暴露面（pi 命令 + 内置 + webext Tier3 合流）。
  - pi extension 命令"web 端 busy 卡死"修复的合入。
  - 参考示例：独立插件包 + consumer agent + 双角色样板，及其 e2e。
- **Out of scope**：
  - 重建 webext 加载器 / 安全门 / 协议契约（属 `agent-web-extension`，复用）。
  - 重建 `extension-management` 安装治理（白名单/版本固定/审计/管理员门控，复用）。
  - 重建 webext 发现/验签/中心可信发布者列表（属 `webext-package-install`，复用）。
  - 重建命令补全框架（属 `completion-provider-framework`，复用）。
  - marketplace / 扩展目录 / 发现推荐 / 评分（明确排除，Phase 2）。
  - 发布工具链的独立标准化（签名/可信发布者注册中心的"发布侧"形态，作为后续；本特性沿用既有 `pi-web build --sign`）。
  - 把安装暴露为模型可调用工具（安装恒为 `userOnly`，非本特性目标）。
- **Adjacent expectations**：
  - 依赖 `extension-management` 的 REST 路由、来源白名单、`adminPolicy`、`SessionReloader` 接缝。
  - 依赖 `webext-package-install` 的 `/api/webext/resolve`、`locateDist`、信任服务、`useRuntimeWebext` 的 `reloadNonce`。
  - 依赖 `builtin-plugin-command` 的 `/plugin` 命令本体与"装后生效反馈"挂点。
  - 依赖 `extension-install-agent-tools`（相邻 spec）的扩展命令 fire-and-forget 修复；本特性合入该修复以满足 Requirement 2.3。
  - 依赖 pi `DefaultPackageManager`（origin: package / top-level 发现约定）。
