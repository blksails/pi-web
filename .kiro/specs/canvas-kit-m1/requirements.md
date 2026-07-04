# Requirements Document

## Project Description (Input)
CanvasKit M1:Canvas 内核抽取与工具插件化。依据设计稿 docs/canvas-extension-mechanism-design.md(第 8 节 M1)与 docs/surface-extension-standard.md(SES v0.1)。

> **定位修订(2026-07-04)**:经 docs/surface-app-runtime-contract-v1.md(Surface App Runtime 契约 v1)裁决,本 spec 的 "kernel" 是 **Canvas 应用面的私有交互件**(pointer/gesture/history),不是框架内核;框架内核为契约 C1-C7。本 spec 与契约 M-A(门面收口)并行不冲突,但 requirements/design 须引用契约,且不得与三平面法则、状态归置法(C4)冲突;canvas livePreview 的作业协议迁移(契约 C5-4)不在本 spec 范围。

范围:

① 新建独立包 `@blksails/pi-web-canvas-kit`(packages/canvas-kit),把 packages/ui/src/canvas/ 的 Canvas 领域组件(canvas-workbench / canvas-gallery / canvas-launcher / lineage-view / aigc-quick-settings / aigc-model-meta / client-image-ops)迁出宿主 ui 包,恢复宿主中立性(SES-H1:grep packages/ui 无 canvas 领域词);`@blksails/pi-web-ui` 保留 re-export 兼容一个大版本。

② 从 2033 行单体 canvas-workbench.tsx 析出领域无关内核 kernel:stage(视口/缩放平移/底图像素坐标换算 toNatural)、pointer(指针管线唯一路由,根治「层内 stopPropagation 挡不住 stage mousedown」类双事件 bug 族)、history(统一 undo/redo 栈,EditOp 泛化为开放注册的 CanvasOpKind)、layers(图层树)、bitmap-io(client-image-ops 迁入)。

③ 8 个内置舞台工具(move / expand / draw / line / arrow / text / mask / erase)改写为 defineCanvasTool 插件(id 带 `builtin:` 前缀),经 per-instance CanvasRegistry 注册,工具轨 / overlay / 选项条由注册表驱动——内置自举即扩展点验收。

④ 明确非目标:动作链插件化(decideGenerate 评分制)与能力清单下发属 M2;canvasPlugins webext 车道属 M3;本期不改 surface 协议、不改 agent 侧 canvas extension(tool-kit 的 canvas/ 目录零改动)。

⑤ **设计标准(第一架构纪律,见设计稿 §2.2「双层架构」)**:canvas-kit 由两层构成——**L1 集成核**收容系统集成的全部复杂性(surface 桥接/退化、附件上传编排、syncSignal 收敛与叠层自愈、settleWindow、快照式消费、坐标换算、指针唯一路由、undo 栈、StrictMode/双事件安全),质量标准是「正确」;**L2 开发者体验层**(define* API + hooks + 类型)面向插件作者,质量标准是「稳定不出错」——遵循 React 与仓库既有惯例、pit of success、声明式优先、纯函数可单测。硬性推论:L2→L1 单向依赖;kernel 内部模块不进 package exports(作者物理上碰不到复杂性);L2 回调抛错由 L1 边界捕获(禁用插件 + diagnostics,画布不崩);L2 是 semver 承诺面,L1 可自由重构。requirements 与 design 阶段的验收准则须体现「复杂性不可见化」:L1 的每项复杂性给出「L2 看不见它」的证明(如 onPointerDown 拿到的是已换算的底图像素坐标、buildArgs 拿到的 att_id 已就绪)。

核心验收线:现有 canvas 全部单测(packages/ui/test/canvas/*)与浏览器 e2e canvas 闭环在迁移后零改动全绿(行为回归线),外加 kernel 与注册表的新增单测。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
