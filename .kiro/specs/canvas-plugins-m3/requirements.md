# Requirements Document

## Project Description (Input)
M3:canvas 插件车道与贴纸范例(canvasPlugins 车道①② + 图层插件契约 + 命名空间注册)。依据 docs/canvas-extension-mechanism-design.md §3.4/§5/§6/§8(M3 行)与 canvas-kit-m1/canvas-actions-m2 先例。工作目录=隔离 worktree .claude/worktrees/canvas-plugins-m3(基线 main 560af8b)。范围:①canvas-kit L2 图层插件契约;②插件依赖拓扑校验(已拍板);③车道① defineWebExtension({canvasPlugins});④车道② pi-plugin.json web.canvasPlugins;⑤<extId>: 命名空间+同 id 拒绝语义(已拍板);⑥examples/canvas-plugin-stickers 完整双端范例(含图层契约,已拍板);⑦新浏览器 e2e。非目标:车道③自动长按钮/多实例分桶/protocol 改动/M2 契约行为变更/插件市场安装器 UI。

## Introduction

M1/M2 已把 Canvas 的舞台工具与生成动作插件化,但插件只能由内置代码注册——第三方无法把自己的工具、图层、动作带进 Canvas。本特性打通两条挂载车道(source 自带 / 第三方插件包),补齐图层插件契约(贴纸=可选中、可调参数、可拍平的图层),以命名空间与依赖拓扑校验保证多来源插件共存安全,并交付一个完整双端范例(贴纸工具+风格迁移动作)作为插件作者的 canonical 参照与回归线。三项关键语义已拍板(2026-07-06 用户确认):插件依赖缺失→整插件禁用进诊断(非运行时报错);同 id 重复注册维持「拒绝后注册者」(设计文档 §5「后装覆盖」句随本 spec 修正);贴纸范例含完整图层契约。

## Boundary Context

- **In scope**:图层插件声明契约(类型化图层:渲染/拍平/检查器)与既有图像图层的共存;插件包声明依赖与注册期拓扑校验;车道①(source 的 web 扩展声明 canvasPlugins)与车道②(第三方插件包清单键 + 既有验签装载链);注册命名空间与冲突诊断;贴纸+风格迁移双端范例(examples);新增浏览器 e2e。
- **Out of scope**:车道③动作自动长按钮(M2 拍板保守);多 Canvas 实例分桶;`@blksails/pi-web-protocol` 改动;M1/M2 已落契约(defineCanvasTool/defineCanvasAction/resolveAction/capability 下发)的行为变更;插件市场/安装器 UI;插件热更新。
- **Adjacent expectations**:webext 五层装载与验签链(agent-web-extension/webext-package-install 既有机制)按现契约可用,本特性只加清单键与消费点,不改装载安全模型;M2 的 capability.actions 白名单继续作为 command 动作可见性的权威(agent 不支持的动作不出现);canvas 既有 6 条 e2e 与全部既有单测是不可回归的行为基线。
- **已拍板决策(2026-07-06 用户确认)**:①插件依赖拓扑校验——缺依赖整插件禁用进 diagnostics(工具轨置灰+tooltip 原因,复用 M2 机制);②同 id 语义维持「拒绝后注册者+diagnostics」(M1/M2 零变;设计文档 §5 相应句随 spec 修正);③贴纸范例含完整图层契约(Render/bake/Inspector)。

## Requirements

### Requirement 1: 图层插件契约(类型化图层)

**Objective:** As a canvas 插件作者, I want 用一个对象字面量声明一种图层类型(如何渲染、如何拍平进位图、如何在检查器里编辑参数), so that 我的工具能创建有自定义数据与交互的图层而无需修改宿主代码。

#### Acceptance Criteria

1. The canvas-kit 包 shall 提供图层类型的声明与注册能力:声明含唯一类型名、渲染组件、拍平函数(把图层内容烤进位图)、可选检查器组件(编辑图层数据)。
2. When 工具向画布添加一个已注册类型的图层, the 舞台 shall 按该类型声明的渲染组件在图层位置呈现内容,并随视口缩放平移。
3. When 用户选中一个带检查器的插件图层, the 工作台 shall 呈现该类型的检查器,编辑即更新图层数据与舞台呈现。
4. When 画布拍平(生成前的合成或显式拍平), the 系统 shall 依图层声明的拍平函数把插件图层内容烤进位图,产物与既有拍平链路一致地参与后续流程。
5. The 既有图像图层(基于附件的 WorkLayer)行为 shall 零变化:未注册类型声明的图层照现状渲染与拍平。
6. If 图层数据更新, then the 撤销/重做 shall 与既有编辑历史一致地工作(图层操作进统一 undo 栈)。

### Requirement 2: 注册命名空间与冲突语义

**Objective:** As a pi-web 维护者, I want 多来源插件在同一 Canvas 实例共存时 id 不互撞、冲突可诊断, so that 第三方插件不会意外顶替内置或彼此覆盖。

#### Acceptance Criteria

1. The 插件注册 shall 以来源标识为前缀构成命名空间化 id(内置维持 builtin: 前缀既有形态),不同来源的同名插件互不冲突。
2. When 同一命名空间化 id 被重复注册, the 注册表 shall 拒绝后注册者(先注册者保持)并记录诊断信息——与 M1/M2 工具/动作注册语义一致。
3. The 注册 shall 按 Canvas 实例隔离,注册可退订(既有语义延伸到图层与外部插件)。
4. The 设计文档 §5 中「同 id 后装覆盖先装」的表述 shall 随本特性修正为拒绝语义(文档与实现一致)。

### Requirement 3: 插件依赖拓扑校验

**Objective:** As a canvas 插件作者与使用者, I want 插件声明它依赖的图层类型/操作种类,缺依赖时整插件被禁用并可见原因, so that 不完整安装不会在首次手势时才运行时报错。

#### Acceptance Criteria

1. The 插件声明 shall 支持列出其依赖(如工具依赖的图层类型)。
2. When 注册时存在未满足的依赖, the 系统 shall 禁用该插件整体(其工具不可用、其动作不参与决策)并记录含缺失项的诊断信息。
3. While 插件因缺依赖被禁用, the 工具轨 shall 以置灰+悬停提示呈现禁用原因(复用既有禁用工具 tooltip 机制)。
4. When 依赖齐备, the 插件 shall 正常注册与工作,无额外提示。

### Requirement 4: 车道① — source 自带插件

**Objective:** As a agent source 作者, I want 在 source 的 web 扩展声明里带上 canvas 插件, so that 该 source 的 Canvas 实例自动获得这些工具/图层/动作。

#### Acceptance Criteria

1. The web 扩展声明 shall 新增 canvas 插件声明键,作者可列出该 source 提供的插件。
2. When 用户打开声明了插件的 source 的 Canvas, the 工具轨/动作链 shall 出现这些插件(带来源命名空间)。
3. When source 未声明任何 canvas 插件, the Canvas 行为 shall 与现状逐点一致(零影响)。
4. The 声明键 shall 与既有 web 扩展声明键(slots/renderers 等)同形共存,互不干扰。

### Requirement 5: 车道② — 第三方插件包

**Objective:** As a 第三方插件作者, I want 发布一个带浏览器代码的插件包(清单声明 canvas 插件), so that 安装后对声明消费它的 Canvas 生效。

#### Acceptance Criteria

1. The 插件包 shall 能经其 web 扩展声明携带 canvas 插件(与既有 web 声明键同族;pi-plugin.json 清单级声明键因 protocol 零改动边界推迟,设计档案化)。
2. When 插件包安装且被 source 消费, the 其 canvas 插件 shall 经既有 web 扩展验签装载链进入 Canvas(浏览器代码安全模型不弱化)。
3. If 插件包未安装或验签失败, then the Canvas shall 照常工作且不出现该插件(装载失败可诊断,不崩)。

### Requirement 6: 贴纸与风格迁移双端范例

**Objective:** As a 插件作者, I want 一个覆盖「工具+图层+动作+agent 命令」全接缝的可运行范例, so that 照抄即可写出自己的插件。

#### Acceptance Criteria

1. The examples shall 含一个 canvas 插件范例包:贴纸工具(点击置层,默认 emoji;检查器内换 emoji——实现期修正:createLayer 为静态声明 seam,运行时选项条选中值无法带入放置,emoji 选择归位 Inspector 调色板,design §范例 已同步简化)+ 贴纸图层(检查器调尺寸、拍平烤入位图)+ 风格迁移动作(命令通道)。
2. When 用户以贴纸工具点击舞台, the 画布 shall 在点击处生成贴纸图层,可选中、可经检查器调尺寸、拍平后进入位图。
3. The 风格迁移动作 shall 声明命令通道执行,且仅当 agent 下发的能力清单包含对应命令时参与决策(M2 门控语义的第一个外部消费者)。
4. When 风格迁移动作执行, the 结果 shall 经命令通道回流画廊(agent 侧命令处理器产出新资产)。
5. The 范例 shall 双端齐备:前端插件声明 + agent 侧命令注册,一个 source 目录即可运行。

### Requirement 7: 回归与验收线

**Objective:** As a pi-web 维护者, I want 全量回归与端到端证据, so that 插件车道不破坏既有行为。

#### Acceptance Criteria

1. The packages/ui、canvas-ui、canvas-kit、tool-kit、web-kit 的既有单元测试 shall 零改动全绿(仅出口快照测试允许随新增导出联动更新)。
2. The canvas 既有 6 条浏览器 e2e shall 零改动全绿。
3. The workspace typecheck shall 全绿。
4. The 新增行为(图层契约/命名空间与冲突/拓扑校验/两车道装载/范例) shall 具备新增单元/集成测试并全绿。
5. The 新增浏览器 e2e shall 覆盖:装插件 source→工具轨出现贴纸工具→画贴纸→选中调尺寸→拍平;风格迁移经命令通道回流画廊。
