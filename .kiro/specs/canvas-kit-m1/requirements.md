# Requirements Document

## Project Description (Input)
CanvasKit M1:Canvas 内核抽取与工具插件化。依据设计稿 docs/canvas-extension-mechanism-design.md(第 8 节 M1)与 docs/surface-extension-standard.md(SES v0.1)。

> **定位修订(2026-07-04)**:经 docs/surface-app-runtime-contract-v1.md(Surface App Runtime 契约 v1)裁决,本 spec 的 "kernel" 是 **Canvas 应用面的私有交互件**(pointer/gesture/history),不是框架内核;框架内核为契约 C1-C7。本 spec 与契约 M-A(门面收口)并行不冲突,但 requirements/design 须引用契约,且不得与三平面法则、状态归置法(C4)冲突;canvas livePreview 的作业协议迁移(契约 C5-4)不在本 spec 范围。

> **范围修订(2026-07-05,用户裁决)**:考古实证 canvas 组件深度依赖 ui 包 Radix 共享件(Button/Card/Textarea/Popover/cn),「组件全迁出 + ui re-export」构成依赖方向死结(ui→canvas-kit 兼容层与 canvas-kit→ui 共享件互斥)。裁决:**M1 只迁纯逻辑内核层**——新包收 kernel(stage/pointer/history/layers)+ bitmap-io(client-image-ops)+ 工具插件化注册表;**组件(workbench/gallery/launcher/lineage-view/aigc-*)留在 ui 包消费内核**;组件迁出与 SES-H1 宿主中立推 M1.5/M2。另裁:**实现阶段以「拖放/粘贴导入 WIP 合入 main」为开工前提**(该 WIP 与 workbench 重构重叠,基线须干净)。原 ① 相应作废,② ③ ⑤ 保留,④ 非目标扩充。

范围(修订后):

② 从 canvas-workbench.tsx(现 2077 行,M-A 后)析出领域无关交互内核 kernel 进新包 `@blksails/pi-web-canvas-kit`(packages/canvas-kit):stage(视口/缩放平移/底图像素坐标换算 toNatural)、pointer(指针管线唯一路由,根治「层内 stopPropagation 挡不住 stage mousedown」类双事件 bug 族)、history(统一 undo/redo 栈,EditOp 泛化为开放注册的 CanvasOpKind)、layers(图层树操作)、bitmap-io(client-image-ops 迁入);ui 包对 client-image-ops 既有全量 re-export 保留兼容一个大版本。

③ 8 个内置舞台工具(move / expand / draw / line / arrow / text / mask / erase)改写为 defineCanvasTool 插件(id 带 `builtin:` 前缀),经 per-instance CanvasRegistry 注册,工具轨 / overlay / 选项条 / 指针分派由注册表驱动——内置自举即扩展点验收。

④ 非目标:canvas 组件迁出 ui 包与 SES-H1 宿主中立(M1.5);动作链插件化(decideGenerate 评分制)与能力清单下发(M2);canvasPlugins webext 车道(M3);不改 surface 协议、不改 agent 侧 canvas extension(tool-kit 的 canvas/ 目录零改动);不改 use-canvas-view / aigc-quick-settings / lineage-view / gallery 等非工具面组件的行为。

⑤ **设计标准(第一架构纪律,见设计稿 §2.2「双层架构」)**:canvas-kit 由两层构成——**L1 集成核**收容系统集成的全部复杂性(坐标换算、指针唯一路由、undo 栈、StrictMode/双事件安全等),质量标准是「正确」;**L2 开发者体验层**(define* API + hooks + 类型)面向插件作者,质量标准是「稳定不出错」。硬性推论:L2→L1 单向依赖;kernel 内部模块不进 package exports;L2 回调抛错由 L1 边界捕获(禁用插件 + diagnostics,画布不崩);L2 是 semver 承诺面,L1 可自由重构。验收准则须体现「复杂性不可见化」:L1 的每项复杂性给出「L2 看不见它」的证明(如 onPointerDown 拿到的是已换算的底图像素坐标)。

核心验收线:现有 canvas 全部单测(packages/ui/test/canvas/*)与浏览器 e2e canvas 相关用例在改造后零改动全绿(行为回归线),外加 kernel 与注册表的新增单测。

## Introduction

本 spec 把 CanvasWorkbench 中与领域无关的交互复杂性(视口与坐标、指针路由、历史栈、图层操作、位图运算)析出为独立包 `@blksails/pi-web-canvas-kit` 的 L1 集成核,并把 8 个内置舞台工具改造为经注册表驱动的 defineCanvasTool 插件(L2 开发者面)。目标读者是 Canvas 工具插件作者(L2 使用方)与 canvas 组件维护者(L1 消费方);对最终用户零可见变化(行为回归零改动是硬验收)。本 spec 是 SAR 契约(docs/surface-app-runtime-contract-v1.md)下位的应用面私有件规范,不触碰契约三平面与状态归置法。

## Boundary Context

- **In scope**:新包 canvas-kit(纯逻辑,零 ui 包依赖);kernel 四模块(stage/pointer/history/layers)+ bitmap-io;defineCanvasTool + per-instance CanvasRegistry;8 内置工具插件化改写;workbench 改为消费内核与注册表;ui 包 client-image-ops re-export 兼容层。
- **Out of scope**:canvas 组件文件迁出 ui 包、SES-H1 宿主中立 grep 线(M1.5);decideGenerate 动作链插件化、能力清单下发(M2);webext canvasPlugins 车道(M3);surface 协议、agent 侧 canvas extension(tool-kit canvas/ 零改动);gallery/launcher/lineage-view/aigc-* 组件的行为变更;对话桥门面(surface-runtime-facade 已定,本 spec 只消费)。
- **Adjacent expectations**:上游 SAR 契约与 surface-runtime-facade 已在 main(bridge/buildSurfaceOp/三态呈现是 workbench 现状的一部分,改造须保持);**实施前提(用户裁决)**:拖放/粘贴导入 WIP 合入 main 后方可开工实现阶段(spec 三阶段文档不受此限);tool-kit 的 `aigc-canvas-schema` 子入口类型继续作为双端共享 schema 来源。

## Requirements

### Requirement 1: 独立交互内核包
**Objective:** As a Canvas 应用面维护者, I want 领域无关的交互内核独立成包, so that 交互复杂性有单一归属、可独立测试,且不被宿主 ui 包的组件层拖拽

#### Acceptance Criteria
1. The 仓库 shall 提供独立 workspace 包 `@blksails/pi-web-canvas-kit`(packages/canvas-kit),含独立构建、typecheck 与测试脚本。
2. The canvas-kit 包 shall 不依赖 `@blksails/pi-web-ui`(依赖方向:ui 消费 canvas-kit,反向禁止)。
3. The canvas-kit 公开入口 shall 只导出 L2 开发者面(define* API、hooks、类型)与 bitmap-io 函数;kernel 内部模块(L1 实现件)shall 不出现在公开入口。
4. While canvas-kit 演进, the L2 公开面 shall 作为 semver 承诺面维护;L1 内部实现 shall 可自由重构而不构成破坏性变更。

### Requirement 2: 舞台与坐标内核(stage)
**Objective:** As a 工具插件作者, I want 视口缩放/平移与坐标换算由内核统一承担, so that 我在回调中拿到的坐标恒为底图像素坐标,无需理解视口数学

#### Acceptance Criteria
1. The kernel shall 提供舞台视口状态(缩放/平移)与「客户端坐标 → 底图像素坐标」换算的唯一实现,工具插件不自行实施坐标换算。
2. When 工具插件的指针回调被调用, the kernel shall 传入已换算的底图像素坐标(复杂性不可见化证明点:插件代码零出现视口数学)。
3. When 视口缩放或平移变化, the 既有舞台交互行为(含缩放平移本身)shall 与改造前一致(行为回归)。

### Requirement 3: 指针唯一路由(pointer)
**Objective:** As a Canvas 维护者, I want 全部舞台指针事件经单一路由分派, so that 「层内 stopPropagation 挡不住 stage mousedown」类双事件 bug 族被结构性根治

#### Acceptance Criteria
1. The kernel shall 提供舞台指针事件的唯一入口与分派(按当前激活工具/命中目标路由),舞台交互不再依赖散点 stopPropagation/onMouseDown 阻断补丁。
2. When 指针按下发生在图层或手柄上, the 路由 shall 保证平移等舞台级手势不与层级手势同时触发(双事件族回归守卫)。
3. The 工具插件 shall 只接收语义化手势回调(如按下/拖动/抬起),不直接挂载 DOM 事件监听。
4. When 改造完成, 既有全部指针交互(平移/画笔/掩码/箭头/文字/扩图手柄/层拖拽缩放)shall 行为与改造前一致。

### Requirement 4: 历史栈内核(history)
**Objective:** As a 工具插件作者, I want 统一的 undo/redo 栈与开放的操作类型注册, so that 新工具的可撤销操作无需修改内核代码

#### Acceptance Criteria
1. The kernel shall 提供统一 undo/redo 栈,操作类型(CanvasOpKind)为开放注册而非封闭 union。
2. When 工具插件产生可撤销操作, the 插件 shall 经内核接口提交操作,不自行维护栈状态。
3. When 用户执行撤销/重做, 既有 stroke 与 anno 两类操作的行为 shall 与改造前一致(含清空重做栈的时机)。
4. Where 插件注册了自定义操作类型, the undo/redo shall 对其与内置类型一视同仁。

### Requirement 5: 图层与位图内核(layers / bitmap-io)
**Objective:** As a Canvas 维护者, I want 图层树操作与位图运算收进内核, so that 组件层只剩装配与领域策略

#### Acceptance Criteria
1. The kernel shall 承载图层树的增删改与命中语义,工具插件与组件经内核接口操作图层,不直接改组件私有状态。
2. The canvas-kit shall 收纳既有 client-image-ops 全部位图函数(旋转/裁剪/拍平/掩码/合成/扩图),函数语义零变化。
3. The `@blksails/pi-web-ui` 包 shall 保留 client-image-ops 的全量 re-export 至少一个大版本,既有导入路径零破坏。
4. When 拍平/合成输出被生成, 其结果 shall 与改造前逐语义一致(既有单测零改动通过)。

### Requirement 6: 工具插件化与注册表
**Objective:** As a 工具插件作者, I want 以 defineCanvasTool 声明式定义工具并经注册表挂载, so that 新增舞台工具无需修改核心代码(内置自举即扩展点验收)

#### Acceptance Criteria
1. The canvas-kit shall 提供 defineCanvasTool API 与 per-instance CanvasRegistry:工具声明含标识、图标/标签、手势回调、overlay 渲染与选项条贡献。
2. The 8 个内置舞台工具(move/expand/draw/line/arrow/text/mask/erase)shall 全部以 defineCanvasTool 插件形态实现,id 带 `builtin:` 前缀。
3. The 工具轨、overlay 渲染、选项条与指针分派 shall 由注册表驱动;When 新工具注册, 上述四处 shall 自动纳入而无需修改核心逻辑(内置自举证明)。
4. If 工具插件回调抛出异常, the L1 边界 shall 捕获并禁用该插件、记录诊断信息,画布整体 shall 不崩溃。
5. The 注册表 shall 为 per-instance(同页多画布实例互不串扰)。

### Requirement 7: 行为回归与质量线
**Objective:** As a Canvas 维护者, I want 改造以行为回归零改动为硬线, so that 用户与既有测试完全无感

#### Acceptance Criteria
1. When 改造完成, packages/ui/test/canvas/ 全部既有单测 shall 零改动通过(导入路径兼容由 5.3 保证)。
2. When 改造完成, 浏览器 e2e 的 canvas 相关用例(闭环/粘性回放/auto-sync/B 档/降级)shall 零改动通过。
3. The canvas-kit shall 附带 kernel 四模块与注册表的新增单测,含:坐标换算纯函数、指针路由分派、undo/redo 开放注册、插件抛错禁用不崩、per-instance 隔离。
4. The workspace typecheck shall 全绿,且 canvas-kit 包 shall 遵循 TS strict 禁 any。
5. The 交付 shall 附带「复杂性不可见化」证明点清单(每项 L1 复杂性给出 L2 看不见它的 grep/测试证据)。
