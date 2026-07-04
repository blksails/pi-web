# Research & Design Decisions

## Summary
- **Feature**: `canvas-kit-m1`
- **Discovery Scope**: Extension + 新包抽取(集成型发现;考古代理全量盘点 + 手势区源码精读)
- **Key Findings**:
  - **依赖方向死结实证**(触发范围修订,用户裁决 2026-07-05):canvas 组件深度依赖 ui 包 Radix 共享件(Button/Card/Textarea/Popover/cn),而兼容层要求 ui→canvas-kit;组件全迁出在 M1 不可行 → M1 只迁纯逻辑层。
  - **8 工具是硬编码分支族**:`StageTool` union(canvas-workbench.tsx:105)+ 四处散点(工具轨 toolBtn :1364-1404 / 指针分支 :1120-1209 / overlay 光栅化 :615-650 / 选项条 :1406-1453),新工具需改核心 4 处——注册表驱动的收益点明确。
  - **手势模式同构**:mask/erase(MaskStroke draft)与 line/arrow/draw(Annotation draft)共享「pointer capture → draft ref+state 双写 → up 时 commit 进 ops + 清 redo」骨架(:1120-1209);text 有 up 时挂编辑器的特例(down 挂载会被焦点转移 blur 掉,:1190-1196);move=舞台平移、expand=边框手柄拖拽,不走 overlay 手势。
  - **双事件 bug 族的补丁点**:层/手柄的 `onMouseDown` stopPropagation 阻断(:1604/:1662,M3 拖层 2 倍位移坑注解)——指针唯一路由的根治对象。
  - **client-image-ops 已是纯函数**(567 行 30 导出,零 ui 依赖)可原样迁包;ui index 有 `export * from client-image-ops`(:207)→ 兼容层只需改 re-export 源。
  - **测试耦合**:canvas-workbench.test 与 channel/golden 测试深路径 import client-image-ops 与 buildSurfaceOp——迁移后深路径必须继续可解析(re-export 不够,深路径是 `../../src/canvas/client-image-ops.js`!)→ 兼容策略须保留 ui 包内同名模块转发文件,否则「测试零改动」破产。

## Research Log

### 工具手势与 draft 生命周期(defineCanvasTool 接口依据)
- **Sources**: canvas-workbench.tsx:1120-1209(onOverlayPointerDown/Move/Up 全文精读)。
- **Findings**: draft 用 ref+state 双写(ref 供 move 高频读,state 供渲染);pointer capture 在 down 时设;up 时 commit `{kind:"stroke"|"anno", item}` 进 ops 并清 redoOps;text 工具 down 只记位置、up 才开编辑器;笔刷直径=短边×ratio 钳 ≥1px(:1127)。
- **Implications**: L1 ToolRuntime 必须内建「draft 槽位 + ref/state 双写 + capture 管理」,L2 工具只写纯 reducer 式回调(拿 natural 坐标与 draft,返回新 draft/commit 指令)——复杂性不可见化的核心证明点。

### 双事件路由(pointer 模块依据)
- **Sources**: canvas-workbench.tsx:1604/:1662(stopPropagation 补丁)、:1257-1290(舞台平移 drag ref)、:991(onLayerPointerDown)、:1661(onExpandHandleDown)。
- **Findings**: 舞台 mousedown 平移监听与层/手柄 pointerdown 并存,靠散点 onMouseDown 阻断苟活;命中源有四类:overlay(工具画布)、layer(图层)、expand-handle(扩图手柄)、stage(空白平移)。
- **Implications**: PointerRouter 以「命中描述符 + 当前工具」单点分派;层/手柄仍可保留自身 DOM 但事件统一上交路由;设计须给 move(舞台平移)与 expand(手柄拖拽)非 overlay 手势的路由通道。

### 历史栈泛化(history 模块依据)
- **Findings**: `EditOp = {kind:"stroke"|"anno", item}`(:145-147),ops/redoOps 两栈(:540-541);overlay 光栅化按 kind 过滤回放(:615-650)。
- **Implications**: 泛化为 `{kind: string, item: unknown}` + OpKind 注册表(kind→rasterize 回调);undo/redo 语义(入栈清 redo)原样;两内置 kind 由 mask/erase 与标注家族工具注册——「开放注册」由内置自举证明。

### 兼容层的深路径陷阱
- **Findings**: canvas-workbench.test.tsx:13 `import ... from "../../src/canvas/client-image-ops.js"`;golden 测试 :4 import buildSurfaceOp(留在 workbench,不迁)。
- **Implications**: client-image-ops 迁包后,`packages/ui/src/canvas/client-image-ops.ts` 必须保留为**转发模块**(`export * from "@blksails/pi-web-canvas-kit"` 的对应子集),深路径与包入口双兼容;不然 7.1「单测零改动」直接破。

### 包脚手架先例
- **Findings**: logger(零依赖库,exports "."→src/index.ts)与 web-kit(带 workspace 依赖 + peer react)两先例;react 包 vitest 布局 test/ 独立目录。
- **Implications**: canvas-kit 照 web-kit 形:deps=`@blksails/pi-web-tool-kit`(仅 aigc-canvas-schema 子入口类型?——**否**,GalleryAsset 由组件层消费,kernel 不需要;canvas-kit 零 workspace 依赖)+ peer `react`(hooks/ReactNode)+ dep `lucide-react`(内置工具图标)。root tsconfig paths 需同步加包别名(memory:tool-kit 子路径 alias 坑)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 注册表+ToolRuntime(选定) | per-instance registry,L1 ToolRuntime 持 draft/capture/分派,L2 工具纯声明 | 复杂性不可见化可证;内置自举即扩展点验收;行为字节级复刻可控 | ToolRuntime 是新抽象,需精确复刻 draft 双写时序 | 与设计稿 §2.2 双层架构一致 |
| 工具=React 组件(each tool a component) | 每工具一个组件自挂事件 | 组件模型熟悉 | 事件散点回潮,双事件 bug 族无法根治;draft 时序难复刻 | 否决:违背指针唯一路由 |
| 仅析出纯函数不做注册表 | 只迁 bitmap-io + 坐标换算 | 风险最小 | ③ 工具插件化验收不达,M1 核心价值缺失 | 否决:范围不符 |

## Design Decisions

### Decision: canvas-kit 依赖面 = react(peer)+ lucide-react,零 workspace 依赖
- **Context**: 内置工具带图标(现用 lucide),L2 hooks 需 react;kernel 纯逻辑。
- **Selected Approach**: peerDependencies: react;dependencies: lucide-react;不依赖任何 @blksails/* 包(类型自持:Annotation/MaskStroke/ExpandEdges/WorkLayer 随 bitmap-io/kernel 迁入 canvas-kit 成为 canonical 家,ui 组件从 canvas-kit 导入)。
- **Trade-offs**: 类型从 ui 迁 canonical 家需 ui 侧改 import(组件层内部改动,非公开破坏);换取新包完全独立可测。

### Decision: 深路径兼容 = ui 包保留转发模块
- **Selected Approach**: `packages/ui/src/canvas/client-image-ops.ts` 改写为 `export * from "@blksails/pi-web-canvas-kit"`(bitmap-io 子集)+ ui index 的 `export *` 链保持;既有深路径 import 与包入口 import 双零改动。转发模块标 @deprecated 注释一个大版本。
- **Rationale**: 7.1/5.3 的「零改动」是硬线;转发文件成本一行。

### Decision: ToolRuntime 承载 draft 槽位与 capture(L1),工具回调纯化(L2)
- **Selected Approach**: L1 提供 per-tool draft 槽(ref+state 双写封装)、pointer capture、commit(op)→history(自动清 redo);L2 手势回调签名 `(ev: ToolGestureEvent, ctx: CanvasToolContext) => void`,ev 含 natural 坐标(已换算)、命中描述符、draft 读写句柄;text 的「up 时才挂编辑器”特例由工具声明 `overlayReact`(React 叠层贡献)+ ctx 的 defer 原语承载。
- **Follow-up**: 行为复刻单测锚:draft 双写时序(move 高频读 ref)、capture 设置点、commit 清 redo。

### Decision: move/expand 的非 overlay 手势经命中路由通道
- **Context**: move=舞台平移、expand=边框手柄,不产生 draft/op。
- **Selected Approach**: PointerRouter 的 ToolGestureEvent 带 `hit: "overlay"|"layer"|"expand-handle"|"stage"` 与附加载荷(层 id/手柄边);move 工具消费 stage 命中执行 ctx.stage.panBy;expand 工具消费 expand-handle 命中(手柄 DOM 仍由 workbench 渲染,事件上交路由);层拖拽/缩放为**工具无关的内核手势**(任何工具下都可拖层,与现状一致——现状 onLayerPointerDown 不看 tool),归 layers 命中的内核级处理而非工具回调。
- **Rationale**: 忠于现状行为(回归零改动),同时保住「指针唯一路由」。

## Risks & Mitigations
- draft 双写/capture 时序复刻失真 → 行为回归线(既有 545 行 workbench 测试)+ 手势单测逐场景锚定;实现任务要求逐分支对照旧代码迁移。
- 深路径兼容遗漏(除 client-image-ops 外还有 buildSurfaceOp/decideGenerate 深路径消费)→ buildSurfaceOp/decideGenerate 留在 workbench 不迁,golden 测试不受影响;实现前 grep 全部深路径 import 清单核对。
- 新包 tsconfig paths/vitest alias 漏配(memory 坑)→ 脚手架任务显式含 root tsconfig paths + 消费包 vitest 检查。
- workbench 2077 行重构与并发 WIP 冲突 → **实施前提:拖放/粘贴 WIP 合入 main**(用户裁决,写入 requirements Adjacent);开工时以合入后基线重新 grep 校准行号。
- StrictMode 双执行(memory: settleWindow/双跑坑)→ ToolRuntime 的 ref 状态与 effect 注册幂等设计,单测覆盖。

## References
- docs/canvas-extension-mechanism-design.md §2.2(双层架构 L1/L2 六推论)、§8(M1 里程碑)
- docs/surface-app-runtime-contract-v1.md(上位契约;本 spec 为应用面私有件)
- .kiro/specs/surface-runtime-facade/(M-A,已合 main——workbench 现状含 bridge/buildSurfaceOp/三态)
- packages/web-kit(包脚手架先例)、packages/react/test(vitest 布局先例)
