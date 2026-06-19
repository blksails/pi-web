# Requirements Document

## Introduction

本特性为每个 agent source 引入一套**「UI 控制层」**:agent source 在自身目录 `.pi/web` 下声明并携带一个**前端扩展(WebExtension)**,用以自定义 pi-web 聊天宿主的布局、渲染与交互,而**不触碰宿主的 document、session、transport 与安全边界**。它与现有 `.pi/agents`(pi agent 行为载入层)**解耦并存**:`.pi/agents` 管行为,`.pi/web` 管 UI。

宿主采用**模型 A(宿主为主、agent 为客)**:宿主永远拥有页面根、会话与传输,agent 扩展只能填入宿主**让出的具名插槽**、注册**贡献点**、或在**隔离表面(iframe)**内自由渲染。扩展以 agent source 侧**独立预构建**的 ESM bundle + manifest 形式交付,宿主**运行时经 import map 动态加载**(per-session 懒加载)。

因允许 git source 加载 UI bundle(同源不透明代码),安全围栏从技术边界转为**运营边界**:作者签名 + 白名单 + CSP + artifact iframe 为强制要求。

## Boundary Context

- **In scope**:
  - `.pi/web` 目录契约与声明式 manifest(`web.config`)的发现、校验与加载。
  - Tier 1 区域插槽、Tier 2 渲染插槽(registry,per-session 作用域)、Tier 3 贡献点 + UI↔agent RPC 总线、Tier 4 artifact iframe 隔离表面、Tier 5 纯声明配置。
  - `@pi-web/web-kit` 包(`defineWebExtension` + RPC client + 复用组件 + 类型)与 `pi-web build` 工具(强制 externals、CSS scoping、剥全局样式、产出 manifest + SRI)。
  - 运行时 import-map 加载、per-session 懒加载、能力(targetApiVersion)协商。
  - 安全围栏:签名 + 白名单 + CSP;以及对 git source bundle 的加载门控。
  - 一组示例 agent source(携带 `.pi/web`)与覆盖 Tier 1~5 的单元/集成/浏览器 e2e 验证。
- **Out of scope**:
  - runner 子进程内的 pi SDK 导入与 agent 行为载入(已有 `.pi/agents` 机制,不在本特性变更)。
  - module federation 运行时;Shadow DOM 隔离方案。
  - agent 掌管整页 / 自带 `index.html` / 接管 React 根。
- **Adjacent expectations**:
  - 宿主既有 `@pi-web/protocol` 契约为 RPC/传输根;本特性新增的 UI↔agent 消息须沿用其版本化与校验约定。
  - 现有 `PiChat` 四维定制(slots/components/registry/presets)由本特性从「宿主 props 喂入」演进为「agent source 声明 + 运行时加载」,既有宿主直接装配方式须保持可用(向后兼容)。

## Requirements

### Requirement 1: WebExtension 目录契约与声明式配置(Tier 5)

**Objective:** 作为 agent source 作者,我想在 `.pi/web` 下用声明式配置描述 UI 扩展,以便在不写任意代码的前提下完成大部分定制。

#### Acceptance Criteria
1. When 宿主解析一个 agent source,the WebExtension 加载器 shall 探测其 `.pi/web` 目录并读取 `web.config`(manifest)声明。
2. While agent source 不含 `.pi/web`,the 宿主 shall 以现有默认 UI 正常运行且不报错。
3. The WebExtension manifest shall 至少声明 `id`、`targetApiVersion`、`entry`、`css`、`integrity`,并允许声明 `signature`。
4. Where manifest 仅含声明式字段(theme token、layout 预设、slot→已有组件映射、贡献注册)且无自定义代码,the 宿主 shall 不加载任何 bundle 即应用该配置(零代码路径)。
5. If manifest 缺少必填字段或格式非法,the WebExtension 加载器 shall 拒绝加载该扩展并以可诊断的错误说明缺失项,同时宿主回退默认 UI。

### Requirement 2: 区域插槽(Tier 1)

**Objective:** 作为 agent source 作者,我想把内容填入宿主让出的具名区域插槽,以便控制布局与版面而不接管整页。

#### Acceptance Criteria
1. The 宿主 shall 暴露一组具名区域插槽:Background、Header(left/center/right)、SidebarLeft、PanelRight(Inspector)、MessageList 容器、Empty、Footer、PromptInput 区域、PromptInputAccessory(aboveEditor/belowEditor/inlineLeft/inlineRight/toolbar)、Notifications、StatusBar、ArtifactSurface、DialogLayer。
2. When 扩展声明填充某区域插槽,the 宿主 shall 在对应位置渲染扩展提供的内容。
3. While 扩展未声明某区域插槽,the 宿主 shall 使用该插槽的既有默认或不渲染该区域(不报错)。
4. The 宿主 shall 始终保留 PromptInput 的提交契约(文本/附件如何送达 agent),即使其外观与内联控件被扩展替换。
5. If 扩展尝试渲染到未公开的位置或接管宿主根布局,the 宿主 shall 拒绝该渲染并保持内核区域不受影响。

### Requirement 3: 渲染插槽与 per-session registry(Tier 2)

**Objective:** 作为 agent source 作者,我想为特定消息/部件/工具类型注册渲染器,以便领域内容获得贴合的展示,且不与其他扩展互相污染。

#### Acceptance Criteria
1. The 渲染注册表 shall 支持按类型键控注册:MessageRenderer[role]、PartRenderer[type]、ToolRenderer[toolName]、DataPartRenderer[data-type]、Markdown、Source、Attachment。
2. The 渲染注册表 shall 以 per-session 作用域实例化,且对注册 key 施加扩展级命名空间,使不同会话/扩展的注册互不覆盖。
3. While 渲染器位于内联消息流中(与宿主内容及 LLM 输出交织),the 宿主 shall 仅允许声明式白名单渲染(复用受限节点树),不允许任意 CSS/JS。
4. When 同一类型存在多个候选渲染器,the 渲染注册表 shall 以确定且文档化的优先级解析(扩展声明 > 宿主默认)。
5. When 会话结束,the 宿主 shall 释放该会话的渲染注册表及其注册项,不残留全局状态。

### Requirement 4: 贡献点与 UI↔agent RPC 总线(Tier 3 + Tier 0)

**Objective:** 作为 agent source 作者,我想注册 slash 命令、@mention、自动补全、内联补全等交互能力,并让它们回到 agent 取数据/执行,以便构建领域交互。

#### Acceptance Criteria
1. The 宿主 shall 暴露一条版本化的 UI↔agent RPC 总线,供扩展发起请求并接收来自 agent 的响应。
2. The 宿主 shall 支持注册贡献点:SlashCommands、Mentions(@)、Autocomplete、InlineComplete、Suggestions、CommandPalette 条目、Keybindings。
3. When 用户触发某贡献点(如输入 `/` 或 `@`),the 宿主 shall 经 RPC 总线向 agent 请求候选/执行,并渲染返回结果。
4. While 等待 RPC 响应,the 宿主 shall 不阻塞输入,并在响应到达或超时后给出可观察的状态。
5. If RPC 请求失败或超时,the 宿主 shall 向用户呈现可恢复的错误状态且不崩溃当前会话。
6. The UI↔agent RPC 消息 shall 携带协议版本,且与 `@pi-web/protocol` 的校验约定一致。

### Requirement 5: Artifact 隔离表面(Tier 4)

**Objective:** 作为平台维护者,我想让渲染 LLM 输出或需自由前端的内容运行在隔离表面,以便恶意/出错内容无法触及宿主同源能力。

#### Acceptance Criteria
1. The 宿主 shall 在独立 origin 的沙箱 iframe 中运行 artifact,并经 postMessage 与宿主通信。
2. The artifact iframe shall 无法访问宿主的 cookie、同源存储、DOM 与 `/api` 凭证。
3. When 内容来源为 LLM 输出(模型生成的代码/HTML),the 宿主 shall 强制将其渲染于 artifact iframe 而非同源 bundle。
4. The artifact postMessage 契约 shall 校验消息来源与结构,丢弃不符合契约的消息。

### Requirement 6: 独立预构建打包与运行时加载

**Objective:** 作为 agent source 作者,我想把 `.pi/web` 独立预构建为可移植的 WebExtension 产物,以便随 agent source(含 git)分发,宿主无需重新部署即可加载。

#### Acceptance Criteria
1. The WebExtension 产物 shall 为自包含 ESM bundle,且将 `react`、`react-dom`、`@pi-web/web-kit`、设计系统标记为 external。
2. When 宿主加载扩展,the WebExtension 加载器 shall 经 import map 将这些裸 specifier 解析到宿主已加载的单例实例,再以动态 `import()` 加载入口。
3. The 宿主 shall 仅在某 agent source 的会话激活时加载其 WebExtension(per-session 懒加载),不在首屏加载全部扩展。
4. If 扩展 bundle 内打入了应被 external 的 React/web-kit 副本,the WebExtension 加载器 shall 检测并拒绝加载以避免运行时 hook 冲突。
5. When `manifest.targetApiVersion` 与宿主提供的 web-kit 主版本不兼容,the WebExtension 加载器 shall 拒绝加载并报告版本不匹配。
6. While clone 一个携带预构建 `.pi/web` 的 git agent source,the 宿主 shall 能加载其 agent 与 UI 扩展而无需重新构建宿主。

### Requirement 7: 安全围栏(签名 + 白名单 + CSP)

**Objective:** 作为平台维护者,我想在加载同源 UI bundle 时强制签名、白名单与 CSP,以便把允许 git source 加载代码带来的风险限制在可控的运营边界内。

#### Acceptance Criteria
1. While 配置启用白名单,the WebExtension 加载器 shall 仅加载其签名 key 在白名单内的扩展 bundle。
2. When 加载 bundle,the WebExtension 加载器 shall 校验 manifest 的 `integrity`(SRI)与签名,任一不通过则拒绝加载。
3. The 宿主 shall 应用收紧的内容安全策略(CSP):限制 `connect-src` 并禁用 `unsafe-eval`。
4. If 扩展未签名或签名不在白名单内,the WebExtension 加载器 shall 拒绝加载其代码 bundle,并可回退到该扩展的声明式配置(若有)。
5. The 宿主 shall 记录被拒绝加载的扩展及拒绝原因,以供审计。

### Requirement 8: 构建期 CSS scoping

**Objective:** 作为 agent source 作者,我想由构建工具自动隔离我的样式,以便多个扩展共存时样式互不冲突。

#### Acceptance Criteria
1. The `pi-web build` 工具 shall 为扩展所有 class 自动加 `pw-<extId>-<hash>` 前缀。
2. When 扩展样式包含全局选择器(`*`、`html`、`body`、`:root`、顶层标签、`@layer base`),the `pi-web build` 工具 shall 拒绝或剥离这些规则。
3. The `pi-web build` 工具 shall 对 `@keyframes` 与 `@font-face` 名称施加扩展命名空间。
4. If 扩展样式包含 Tailwind preflight,the `pi-web build` 工具 shall 阻止其进入 bundle。
5. The `pi-web build` 工具 shall 要求扩展自定义 CSS 变量使用 `--pw-<extId>-*` 前缀,允许读取宿主 token 但禁止覆写。
6. The `pi-web build` 工具 shall 将扩展资源 URL 改写为经 `import.meta.url` 解析的相对引用。

### Requirement 9: `@pi-web/web-kit` 包与 `pi-web build` 工具

**Objective:** 作为 agent source 作者,我想用一个独立的作者侧 SDK 与构建命令编写并打包 `.pi/web`,以便有稳定、类型安全的扩展编写契约。

#### Acceptance Criteria
1. The `@pi-web/web-kit` 包 shall 导出 `defineWebExtension()`、回 agent 的 RPC client、可复用设计原语/组件、类型定义与 `targetApiVersion`。
2. The `@pi-web/web-kit` 公共 API shall 遵循语义化版本,并标注稳定核与 experimental 区。
3. The `pi-web build` 工具 shall 强制 externals(打入自有 React/web-kit 副本则拒绝出包)、执行 CSS scoping(见 Requirement 8)、产出 manifest 与 SRI。
4. The `@pi-web/web-kit` shall 与后端解耦,仅经 `@pi-web/protocol` 契约/RPC 与 agent 通信,不依赖 server 内部实现。
5. The `@pi-web/web-kit` 的扩展定义入口 shall 与现有 `@pi-web/agent-kit` 的 `defineAgent()` 在使用范式上保持对称。

### Requirement 10: 内核不可变边界(模型 A)

**Objective:** 作为平台维护者,我想保证 session/transport/安全边界等内核恒定且宿主独占,以便扩展无法破坏会话与安全的根。

#### Acceptance Criteria
1. The 宿主 shall 独占并永远拥有页面根、session、transport、生命周期与安全边界,扩展不可替换之。
2. While 扩展被加载或卸载,the 宿主 shall 维持既有会话与传输不中断。
3. If 扩展崩溃或抛错,the 宿主 shall 隔离该错误,保持内核区域与其它会话可用。
4. The 宿主 shall 保证消息数据模型与 PromptInput 提交契约不被扩展更改其语义。

### Requirement 11: 示例 agent source 测试清单与 e2e 验证

**Objective:** 作为平台维护者,我想用一组携带 `.pi/web` 的示例 agent source 覆盖 Tier 1~5 能力并以新鲜运行证据验证,以便确保框架真实可用。

#### Acceptance Criteria
1. The 项目 shall 在 `examples/` 下提供一组示例 agent source,各自携带 `.pi/web`,分别演示 Tier 1(区域插槽)、Tier 2(渲染器)、Tier 3(贡献点+RPC)、Tier 4(artifact)、Tier 5(纯声明配置)。
2. The 每个被实现的能力 shall 具备单元/集成测试,并以实际运行输出为证据。
3. When 浏览器 e2e 运行,the 测试 shall 跑通闭环:选该示例 source → 加载其 WebExtension → 自定义 UI 生效 → 贡献点经 RPC 回到 agent 并返回结果。
4. The e2e 验证 shall 在隔离的构建产物上运行,不污染开发态 `.next` 缓存。
5. If 任一示例的 WebExtension 加载或 RPC 闭环失败,the e2e 套件 shall 失败并给出可定位的诊断。
