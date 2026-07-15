# Requirements Document

## Project Description (Input)
sandbox-baked-agent-image — pi-web 沙盒模式改走「agent 镜像烘焙」路线:每个 agent source 从基础镜像 + agent source files(dist)构建出专属 image:tag,沙箱启动即直接运行烘焙好的源(首次构建期编译,后续容器直接加载,镜像层缓存使加载最快)。核心目标:沙盒模式与 pi-web 独立(非沙盒)模式**最大化兼容**——同一 runner-bootstrap、同一装配面(工具/webext/布局/completion/state/surface/routes 全套)。**不改动 pi-clouds 仓任何代码**。

### 背景(已调研坐实)
- 现状三症状(工具不可用/webext 不生效/布局不对)根因=沙箱里跑的是裸 `pi --mode rpc`(builtin 兜底),pi-web custom runner(runner-bootstrap.mjs)从未启动,装配帧全缺。
- 现有基础镜像(pi-clouds demo/cloud-e2e/Dockerfile.pi)已具备全部前提:装了 @blksails/pi-web-server@0.3.0 + agent-kit + tool-kit,校验了 runner-bootstrap.mjs 存在,设了 ENV PI_WEB_RUNNER_ENTRY;runner-entry.mjs 的 builtin 兜底路径消费 AGENT_CMD(Pod spec env,无 envd 竞态,parseCmd 支持空格分隔/JSON argv)。
- 故 agent 镜像只需:FROM 基础镜像 + COPY agent dist 到固定路径(如 /agent) + ENV AGENT_CMD="node <PI_WEB_RUNNER_ENTRY 路径> --agent /agent/index.js --cwd /agent --agent-dir /root/.pi/agent" → 沙箱起来即走 pi-web custom runner,沙箱内零新组件、pi-clouds 零改动。
- pi-web 侧 SandboxWsTransport(packages/server/src/rpc-channel/sandbox-ws-transport.ts)现有 configure 帧只发 env 白名单——对烘焙路线正好够用(不需要 sourceRef/install)。

## Introduction

pi-web 的 e2b/ws-runner 沙盒传输(spec `e2b-sandbox-transport`)一期完成了「传输通道」:沙箱内跑通用 `pi --mode rpc`,前端与协议零改动。但一期的沙箱内进程**不是** pi-web 的 custom runner,agent 的装配面(自定义工具、webext 贡献、布局、slash 补全、state/surface/routes、附件目录声明)全部缺失——用户在沙盒会话里看到的是「工具不可用、webext 不生效、布局不对」。

本 spec 引入「agent 镜像烘焙」:每个 agent source 在**构建期**编译并烘焙进一个专属沙箱镜像(基础镜像 + 源产物 → image:tag),会话创建时按 source 解析对应镜像模板,沙箱启动即直接以 pi-web custom runner 运行该源——**运行时零编译、零下载**,加载最快;装配面与非沙盒模式同源一致。

三点价值:
1. **能力对齐**:沙盒会话与非沙盒会话的用户可见能力(工具/webext/布局等)逐项一致,沙盒化不再损失产品能力。
2. **加载最快**:编译发生在构建期,镜像层缓存使重复加载接近瞬时;会话创建不再包含安装/编译等待。
3. **产线可复用**:「基础镜像 + 源产物 → image:tag」的构建形态同时服务本地开发闭环与线上发布产线。

### 范围界定(PoC 延续)
- 本 spec 全部改动落在 pi-web 仓;**不修改 pi-clouds 仓任何代码**,只消费其既有基础镜像能力(内置的 pi-web runner 引导入口与沙箱内常驻 runner)。
- 验收路径为 ws-runner 数据面(agent-sandbox/ACS,本地 kind 闭环);envd 数据面(真实 e2b 云)不在本 spec 验收范围。
- 线上 registry 发布产线的**编排**(何时构建、推送到哪、版本策略)不在范围;本 spec 只保证构建工具的输入输出形态可被产线复用。
- 沙箱多会话复用、保活重连沿用既有语义,不在本 spec 扩展。

### 术语
- **agent source(源)**:含 `index.[js|ts]` 入口(custom 模式)或纯 `.pi/` 配置(cli 模式)的 agent 目录;本 spec 聚焦 custom 模式源。
- **烘焙镜像(baked image)**:从基础镜像 + 某个 agent source 的构建产物制成的专属容器镜像(image:tag)。
- **沙箱模板(template)**:沙盒后端里注册的、指向某镜像的模板标识;会话创建时按模板起沙箱。
- **装配面**:pi-web custom runner 在装配期向前端声明/建立的全部能力:自定义工具、webext 贡献(布局/渲染器/贡献点)、slash 补全、state/surface 桥、agent 声明路由、附件目录。

## Boundary Context

- **In scope**:agent 镜像构建工具(源 → 编译产物 → 专属镜像);会话创建按 source 解析沙箱模板;沙盒会话装配面与非沙盒对齐;附件在沙盒下的传递与降级语义;本地开发闭环(构建→加载→注册→起 dev)与文档;测试与验证。
- **Out of scope**:pi-clouds 仓任何代码改动;线上发布产线编排;envd 数据面对齐;沙箱复用/保活扩展;非 custom 模式源(纯 `.pi/` 配置源)的镜像烘焙(沿用既有通用镜像行为)。
- **Adjacent expectations**:依赖既有基础镜像已内置 pi-web runner 引导能力与沙箱内常驻 runner(本 spec 不拥有、不修改);依赖 `e2b-sandbox-transport` spec 的传输通道与会话核心;附件跨机器语义依赖已落地的可插拔附件后端拓扑(含 cloud-http 类后端)。

## Requirements

### Requirement 1: 沙盒会话以烘焙镜像运行完整装配面
**Objective:** 作为 agent 使用者,我希望沙盒会话与非沙盒会话具有一致的工具、webext 与布局体验,以便把会话放进沙盒不损失任何产品能力。

#### Acceptance Criteria
1. When 用户以「已烘焙镜像的 agent source」创建沙盒会话并发送 prompt, the pi-web 系统 shall 在沙箱内以 pi-web custom runner 运行该源并完成流式回复。
2. While 沙盒会话运行, the pi-web 系统 shall 使该 agent 声明的自定义工具在会话中可被调用,且调用过程与结果的前端呈现与非沙盒模式一致。
3. While 沙盒会话运行, the pi-web 系统 shall 使该 agent 声明的 webext 贡献(布局、渲染器、贡献点)在前端生效,呈现与非沙盒模式一致。
4. While 沙盒会话运行, the pi-web 系统 shall 使该 agent 的 slash 补全、state/surface 双向桥、agent 声明路由与非沙盒模式行为一致。
5. The 沙盒会话 shall 在启动时直接加载烘焙进镜像的源,不在会话创建路径执行源下载或安装。

### Requirement 2: agent 镜像构建工具
**Objective:** 作为 agent 开发者,我希望用一条命令把 agent source 目录构建成专属沙箱镜像,以便源的编译与打包发生在构建期而非会话运行期。

#### Acceptance Criteria
1. When 开发者对一个含入口文件(`index.[js|ts]`)的 agent source 目录执行镜像构建, the 构建工具 shall 产出一个专属镜像(image:tag),内含该源运行所需的全部内容(编译产物、`.pi/` 配置目录、skills、web 扩展静态产物)。
2. The 构建工具 shall 在构建期完成源的编译,使沙箱容器启动时无需任何编译步骤即可加载运行。
3. When 对内容未变更的同一 source 重复构建, the 构建工具 shall 复用未变更的镜像层,仅重建发生变更的部分。
4. If source 目录缺少入口文件或构建所需产物, the 构建工具 shall 以明确错误终止并指出缺失项。
5. The 构建工具 shall 按明确的排除规则跳过与运行无关的内容(如依赖安装目录、版本控制目录、本地缓存),排除规则可被开发者查知。
6. The 构建工具 shall 以「基础镜像 + 源产物 → image:tag」的输入输出形态工作,使同一形态可被线上发布产线复用。
7. When 构建完成, the 构建工具 shall 输出镜像标识(image:tag)与后续步骤指引(如何加载进本地集群并注册为模板)。

### Requirement 3: 按 source 解析沙箱模板
**Objective:** 作为部署运维者,我希望会话创建时系统按 agent source 自动选择对应的沙箱模板,以便多个 agent 可以各自以专属镜像运行而非共用单一全局模板。

#### Acceptance Criteria
1. When 沙盒模式下创建会话, the pi-web 系统 shall 按该会话的 agent source 解析出对应的沙箱模板,而非仅使用单一全局模板。
2. The pi-web 系统 shall 支持显式的「source → 模板」映射配置,并提供从 source 标识派生默认模板名的稳定约定(同一 source 每次派生结果一致)。
3. When 解析模板时, the pi-web 系统 shall 按「显式映射 → 派生约定 → 既有全局模板配置」的顺序取第一个可用者(保持对既有单模板部署的向后兼容)。
4. If 上述顺序全部解析失败, the pi-web 系统 shall 使会话创建以携带修复指引的清晰错误失败,不静默回退到本地执行。
5. While 未启用沙盒模式, the pi-web 系统 shall 保持既有本地执行行为零变化。

### Requirement 4: 沙箱运行环境与非沙盒对齐
**Objective:** 作为 agent 开发者,我希望沙箱内 agent 进程的运行环境与非沙盒 custom 模式等价,以便同一份源无需感知自己运行在哪种模式。

#### Acceptance Criteria
1. The 沙箱内 agent 进程 shall 以与非沙盒 custom 模式相同的引导方式与参数语义启动(同一入口约定:源入口文件、工作目录、agent 配置目录)。
2. When 主进程持有会话所需的 provider 凭据等环境变量, the pi-web 系统 shall 按白名单将其传递至沙箱内 agent 进程,使模型调用能力与非沙盒一致。
3. When 沙箱内 agent 进程输出诊断日志, the pi-web 系统 shall 将其与协议数据流分流并汇入主进程日志,不污染会话数据面。
4. When 沙盒会话建立, the pi-web 系统 shall 执行与非沙盒一致的就绪握手,冷启动期间前端呈现连接中状态而非错误。
5. If 沙箱内 agent 进程启动失败或中途退出, the pi-web 系统 shall 将失败原因作为会话错误传播给操作者,不静默挂起。

### Requirement 5: 附件系统的沙盒语义
**Objective:** 作为 agent 使用者,我希望沙盒会话下附件行为有明确语义——配好跨机器后端就全功能,没配就明确降级——以便不会遇到静默失败或崩溃。

#### Acceptance Criteria
1. Where 主进程配置了含跨机器后端(如 cloud-http 类)的附件拓扑, the pi-web 系统 shall 将附件拓扑及其引用的凭据传递至沙箱内 agent 进程,使附件上传、工具消费与产出回流与非沙盒模式一致。
2. Where 主进程未配置跨机器附件后端, the pi-web 系统 shall 使沙盒会话的附件能力明确降级为不可用(fail-closed):相关操作返回清晰的不可用提示,进程不崩溃。
3. While 附件能力处于降级状态, the 沙盒会话 shall 保持其余能力(对话、工具、webext、布局)不受影响。

### Requirement 6: 本地开发闭环
**Objective:** 作为 pi-web 开发者,我希望在本地一条龙完成「构建镜像 → 加载集群 → 注册模板 → 起 dev 验证」,以便无需线上环境即可开发与验证沙盒能力。

#### Acceptance Criteria
1. The 项目 shall 提供本地闭环的脚本化流程与配套文档:从 agent source 构建镜像、加载进本地集群、注册沙箱模板、以沙盒模式启动 dev。
2. When 开发者按文档完成本地闭环并从网页创建沙盒会话发送 prompt, the pi-web 系统 shall 完成流式回复,且该 agent 的工具、webext 贡献与布局与非沙盒 dev 模式一致。
3. If 本地集群未就绪、镜像未加载或模板未注册, the 闭环流程 shall 在对应步骤给出可操作的错误指引而非晦涩失败。

### Requirement 7: 测试与验证
**Objective:** 作为项目维护者,我希望本特性附带完整测试与新鲜验证证据,以便合入不引入回归且能力主张可复核。

#### Acceptance Criteria
1. The 实现 shall 附带单元测试,覆盖镜像构建工具的关键决策(文件收集与排除规则、错误路径)与模板解析(显式映射、派生约定、向后兼容回退、解析失败错误)。
2. The 实现 shall 附带集成或端到端验证:沙盒会话的装配面与非沙盒模式逐项一致(工具调用、webext 生效、布局呈现)。
3. When 实现完成, the 全部既有测试 shall 保持通过(本地执行模式零回归)。
